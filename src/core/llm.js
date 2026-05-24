/**
 * LLM 统一入口 — 封装 DeepSeek API
 * 支持 Tool Calls（含 strict 模式）+ JSON Output
 */
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', '..', 'activity.log');

function logError(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${ts}] ❌ LLM: ${msg}`;
  console.error(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

class LLM {
  constructor(config) {
    // strict 模式用 beta endpoint，否则用标准 endpoint
    const baseURL = config.useStrictTools
      ? (config.betaBaseUrl || 'https://api.deepseek.com/beta')
      : config.baseUrl;

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL,
    });
    this.model = config.model || 'deepseek-chat';
    this.useStrictTools = config.useStrictTools || false;
    this.maxTokens = config.maxTokens || 300;
    this.temperature = config.temperature || 0.7;

    /** Tool Calls 交互历史（assistant tool_calls + tool results） */
    this.history = [];
    this.maxHistory = config.maxHistory || 16;

    /** 多轮对话历史（user + assistant，不含 tool_calls） */
    this.chatHistory = [];
    this.maxChatHistory = config.maxChatHistory || 20;

    // 思考模式：disabled 时关闭，否则默认 enabled
    this.thinkingMode = config.thinkingMode || 'enabled';
  }

  /**
   * 获取 extra_body（思考模式控制）
   */
  _extraBody() {
    if (this.thinkingMode === 'disabled') {
      return { thinking: { type: 'disabled' } };
    }
    return {};
  }

  /**
   * 添加对话消息到多轮历史
   * @param {string} role - 'user' | 'assistant'
   * @param {string} content - 消息内容
   * @param {string} [name] - 用户名（role='user' 时）
   */
  addChatMessage(role, content, name) {
    const entry = { role, content };
    if (name) entry.name = name;
    this.chatHistory.push(entry);
    if (this.chatHistory.length > this.maxChatHistory) {
      this.chatHistory = this.chatHistory.slice(-this.maxChatHistory);
    }
  }

  /**
   * 获取多轮对话历史（用于拼接到 messages）
   * @returns {array} [{role, content, name?}]
   */
  getChatHistory() {
    return [...this.chatHistory];
  }

  /** 记录对话历史 */
  remember(role, content, toolCalls, reasoningContent) {
    const entry = { role, content };
    if (toolCalls) entry.tool_calls = toolCalls;
    if (reasoningContent) entry.reasoning_content = reasoningContent;
    this.history.push(entry);
    this._trimHistory();
  }

  /**
   * 裁剪历史
   *
   * DeepSeek 思考模式规则：
   * - 有 tool_calls 的 assistant 消息，其 reasoning_content 必须在后续所有请求中回传
   * - 不能切断 tool_calls ↔ tool 配对
   * - 策略：从前面裁剪，但保证不拆散任何 tool_calls → tool 链路
   */
  _trimHistory() {
    if (this.history.length <= this.maxHistory) return;

    const excess = this.history.length - this.maxHistory;
    let cutAt = excess;

    // 从 cutAt 往后扫描，确保不切断 tool 配对
    for (let i = cutAt; i < this.history.length; i++) {
      const msg = this.history[i];
      if (msg.role === 'tool') {
        // 往前找对应的 assistant tool_calls
        for (let j = i - 1; j >= 0; j--) {
          if (this.history[j].role === 'assistant' && this.history[j].tool_calls) {
            if (j < cutAt) cutAt = j;
            break;
          }
        }
      }
    }

    // 如果 cutAt 处是一个 assistant 带 tool_calls，需要保留它
    // （因为它的 reasoning_content 必须在后续请求中回传）
    if (cutAt > 0 && cutAt < this.history.length) {
      const atCut = this.history[cutAt];
      if (atCut.role === 'assistant' && atCut.tool_calls) {
        // 再往前找对应的 user 消息
        for (let j = cutAt - 1; j >= 0; j--) {
          if (this.history[j].role === 'user') {
            cutAt = j;
            break;
          }
        }
      }
    }

    this.history = this.history.slice(cutAt);
  }

  /**
   * 清理历史中所有未配对的 tool_calls
   * 确保每个 assistant tool_calls 后面都有对应的 tool 响应
   * 保留 reasoning_content（DeepSeek 思考模式要求）
   */
  _cleanOrphanToolCalls() {
    const cleaned = [];
    let pendingToolCalls = false;
    let removedCount = 0;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const msg = this.history[i];

      if (msg.role === 'tool') {
        pendingToolCalls = true;
        cleaned.unshift(msg);
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        if (pendingToolCalls) {
          cleaned.unshift(msg);
          pendingToolCalls = false;
        } else {
          removedCount++;
        }
      } else {
        cleaned.unshift(msg);
      }
    }

    if (removedCount > 0) {
      console.log(`[LLM] 🧹 Cleaned ${removedCount} orphan tool_calls from history`);
    }
    this.history = cleaned;
  }

  /**
   * 🧠 决策（Tool Calls 版）— 心跳用
   * @param {object} context — 环境快照
   * @param {array} tools — 可用工具定义
   * @param {string} lastResult — 上次执行结果
   * @returns {{ reply?: string, tool_calls?: array }}
   */
  async decideWithTools(context, tools, lastResult = '') {
    const system = `You are an autonomous AI companion in Minecraft. Observe your surroundings and decide what to do.

**🔧 Tool Tiers:**
- Wood Pickaxe (tier1): stone, coal_ore, cobblestone, dirt, sand, gravel
- Stone Pickaxe (tier2): iron_ore, lapis_ore, copper_ore
- Iron Pickaxe (tier3): diamond_ore, gold_ore, redstone_ore, emerald_ore
- Diamond Pickaxe (tier4): obsidian, ancient_debris

**How to call tools (MUST follow exact format):**
- follow: {"player":"<name>"} — follow a player by name
- wander: {} — explore randomly
- goto: {"x":<num>,"y":<num>,"z":<num>} — navigate to coordinates
- stop: {} — stop all movement
- left_click: {"target":"<entity|coords>","action":"attack|dig|click","item":"<tool>"} — attack entity or dig block
- use: {"action":"eat"} or {"block":"<name>","action":"smelt","input":"<item>","fuel":"<fuel>","count":<num>}
- craft: {"item":"<name>","count":<num>} — craft items
- place: {"block":"<name>","x":<num>,"y":<num>,"z":<num>} — place a block
- sleep: {} — sleep in nearest bed
- chat: {"message":"<text>"} — send chat message
- give: {"item":"<name>","count":<num>,"player":"<name>"} — give items to player
- search_wiki: {"query":"<text>"} — search Minecraft knowledge

**Priority (use common sense, not rigid order):**
- Under attack / low HP → dodge or fight
- Hungry → eat
- Night → sleep if possible
- Items on ground → collect
- Missing basic tools → gather & craft
- Ores / trees nearby → mine / chop (check tool tier!)
- Otherwise → wander and explore

**Tips:**
- Don't repeat the same action if it's already in progress
- Don't repeat failed actions; try something different
- Check your inventory and equipped tool before acting
- If nothing needs doing, return no tool_calls`;

    const prompt = `📊 Perception:
🩸 HP:${context.health}/20 | 🍖 Food:${context.food}
📍 Pos:${context.position} | 🗡️ Holding:${context.equipped || '?'}
🎒 Inv:${context.inventory || 'empty'}
⚠️ Missing:${context.gaps?.join(',') || 'none'}
${context.underAttack ? `⚔️ UNDER ATTACK! Attacker:${context.lastAttacker || '?'} | Hits/30s:${context.hits30s || 0}` : ''}

🔍 Entities: ${context.entities || 'none'}
👤 Players:${context.players || 'none'}
📦 Drops:${context.drops || 'none'}
🧱 Blocks: ${context.blocks || 'empty'}
🗺️ Far:${context.farEntities || 'none'}
🌍 ${context.dayPhase || '?'} | ${context.isUnderground ? 'underground' : 'surface'} | ${context.biome || '?'}
${context.lastAction ? `📋 Last:${context.lastAction}` : ''}
${lastResult ? `⚠️ Result:${lastResult}` : ''}
${context.recentFacts ? `💭 Recent:${context.recentFacts}` : ''}
${context.longTermSummary ? `🧠 Memory:${context.longTermSummary}` : ''}`;

    return this._callWithTools(system, prompt, tools);
  }

  /**
   * 💬 理解玩家消息（Tool Calls 版）
   * @returns {{ reply?: string, tool_calls?: array }}
   */
  async understandWithTools(message, context, tools) {
    const system = `You are an AI companion in Minecraft. Understand the player's intent and call appropriate tools.

**🔧 Tool Tiers (strictly follow!):**
- Wood Pickaxe (tier1): stone, coal_ore, cobblestone
- Stone Pickaxe (tier2): iron_ore, lapis_ore, copper_ore
- Iron Pickaxe (tier3): diamond_ore, gold_ore, redstone_ore, emerald_ore
- Diamond Pickaxe (tier4): obsidian, ancient_debris

**Rules:**
- You MUST call at least one action tool (mine/chop/craft/attack/follow/etc). Never just chat.
- If the player asks you to do something → call chat (brief reply) + the action tool (TWO tool_calls!)
- If it's just conversation → call chat only
- Check your current state before acting — the info is in the prompt`;

    const prompt = `Player says: "${message}"

Current state:
Holding:${context.equipped || '?'} | Inv:${context.inventory || 'empty'}
Missing:${context.gaps?.join(',') || 'none'}
Blocks: ${context.blocks || 'empty'}
Entities: ${context.entities || 'none'}`;

    return this._callWithTools(system, prompt, tools, 'auto');
  }

  /**
   * 底层 Tool Calls 调用
   *
   * DeepSeek 规则：
   * - tool_calls 后必须紧跟对应的 tool 响应消息
   * - 本方法不修改 history，调用方负责在拿到 tool_calls 后调用 addToolResults()
   */
  async _callWithTools(system, prompt, tools, toolChoice = 'auto') {
    // 清理孤立的 tool_calls（防止上次未正确追加 tool 结果）
    this._cleanOrphanToolCalls();

    try {
      const finalTools = this.useStrictTools
        ? tools.map(t => ({
            ...t,
            function: { ...t.function, strict: true },
          }))
        : tools;

      // 构建消息：system + 历史 + 当前 prompt
      const messages = [
        { role: 'system', content: system },
        ...this.history,
        { role: 'user', content: prompt },
      ];

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: finalTools,
        tool_choice: toolChoice,
        max_tokens: this.maxTokens,
        extra_body: this._extraBody(),
      });

      const msg = response.choices[0].message;

      console.log(`[LLM] Response: content="${(msg.content||'').substring(0,50)}", tool_calls=${msg.tool_calls?.length || 0}, reasoning=${msg.reasoning_content ? 'yes' : 'no'}`);

      // 把当前 user prompt 和 assistant 回复 push 到 history
      this.history.push({ role: 'user', content: prompt });
      this.history.push(msg);
      this._trimHistory();

      return {
        reply: msg.content || null,
        tool_calls: msg.tool_calls || null,
      };
    } catch (err) {
      logError(`[LLM Tools] ${err.message} status:${err.status}`);
      if (err.status === 400) {
        console.log('[LLM Tools] Clearing history and retrying...');
        this.history = [];
        try {
          const messages = [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ];
          const response = await this.client.chat.completions.create({
            model: this.model,
            messages,
            tools: this.useStrictTools ? tools.map(t => ({ ...t, function: { ...t.function, strict: true } })) : tools,
            tool_choice: toolChoice,
            max_tokens: this.maxTokens,
            extra_body: this._extraBody(),
          });
          const msg = response.choices[0].message;
          this.history.push({ role: 'user', content: prompt });
          this.history.push(msg);
          return { reply: msg.content || null, tool_calls: msg.tool_calls || null };
        } catch (retryErr) {
          logError(`[LLM Tools Retry] ${retryErr.message}`);
          this.history = [];
        }
      }
      return { reply: null, tool_calls: null };
    }
  }

  /**
   * 追加 tool 执行结果到历史（OpenAI 要求 tool_calls 后必须有 tool 消息）
   */
  addToolResults(toolCalls, results) {
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      this.history.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(results[i] ?? 'ok'),
      });
    }
    this._trimHistory();
  }

  // ===== 保留旧方法（向后兼容） =====

  async decide(context) {
    return this._callLegacy('decide', context);
  }

  async understand(message, context) {
    return this._callLegacy('understand', { message, ...context });
  }

  async _callLegacy(mode, ctx) {
    // 旧方法不再使用，返回空
    return mode === 'understand'
      ? { reply: '嗯？', actions: [] }
      : { action: 'idle' };
  }
}

module.exports = { LLM };

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
    this.history = [];
    this.maxHistory = config.maxHistory || 16;
  }

  /** 记录对话历史 */
  remember(role, content, toolCalls) {
    const entry = { role, content };
    if (toolCalls) entry.tool_calls = toolCalls;
    this.history.push(entry);
    this._trimHistory();
  }

  /** 裁剪历史，保证不拆散 tool_calls + tool 配对 */
  _trimHistory() {
    if (this.history.length <= this.maxHistory) return;

    // 从后往前找，确保不切断 tool_calls ↔ tool 配对
    // 策略：从前面裁剪，但遇到 tool 消息时，把对应的 assistant tool_calls 也保留
    const excess = this.history.length - this.maxHistory;
    let cutAt = excess;

    for (let i = cutAt; i < this.history.length; i++) {
      if (this.history[i].role === 'tool') {
        // 往前找对应的 assistant tool_calls
        for (let j = i - 1; j >= 0; j--) {
          if (this.history[j].role === 'assistant' && this.history[j].tool_calls) {
            if (j < cutAt) cutAt = j;
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
   */
  _cleanOrphanToolCalls() {
    // 从后往前扫描，移除所有孤立的 assistant tool_calls
    const cleaned = [];
    let pendingToolCalls = false;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const msg = this.history[i];

      if (msg.role === 'tool') {
        // tool 响应 → 标记前面的 assistant tool_calls 是合法的
        pendingToolCalls = true;
        cleaned.unshift(msg);
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        if (pendingToolCalls) {
          // 有对应的 tool 响应，保留
          cleaned.unshift(msg);
          pendingToolCalls = false;
        }
        // 否则丢弃（孤立的 tool_calls）
      } else {
        // user / system / 普通 assistant → 保留
        cleaned.unshift(msg);
      }
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

**Priority (use common sense, not rigid order):**
- Under attack / low HP → dodge or fight
- Hungry → eat
- Night → sleep if possible
- Items on ground → collect
- Missing basic tools → gather & craft
- Ores / trees nearby → mine / chop (check tool tier!)
- Otherwise → wander and explore

**Tips:**
- Don't repeat failed actions; try something different
- Check your inventory and equipped tool before acting`;

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
- Understand what the player wants, then call the right tool(s) to do it
- If the player asks you to do something actionable → call chat (brief reply) + the action tool
- If it's just conversation → only call chat
- If you're unsure → chat a reply asking for clarification
- Check your current state before acting — the info is in the prompt`;

    const prompt = `Player says: "${message}"

Current state:
Holding:${context.equipped || '?'} | Inventory:${context.inventory || 'empty'}
Missing:${context.gaps?.join(',') || 'none'}
Nearby ores:${context.ores || 'none'} | Nearby trees:${context.trees || 'none'}`;

    return this._callWithTools(system, prompt, tools);
  }

  /**
   * 底层 Tool Calls 调用
   */
  async _callWithTools(system, prompt, tools) {
    try {
      // 清理孤立的 tool_calls
      this._cleanOrphanToolCalls();

      // strict 模式：给每个 tool 注入 strict: true
      const finalTools = this.useStrictTools
        ? tools.map(t => ({
            ...t,
            function: { ...t.function, strict: true },
          }))
        : tools;

      const messages = [
        { role: 'system', content: system },
        ...this.history.slice(-12),
        { role: 'user', content: prompt },
      ];

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: finalTools,
        tool_choice: 'auto',
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      });

      const msg = response.choices[0].message;

      console.log(`[LLM] Response: content="${(msg.content||'').substring(0,50)}", tool_calls=${msg.tool_calls?.length || 0}`);

      // 记录历史
      this.remember('user', prompt);
      if (msg.tool_calls) {
        this.remember('assistant', msg.content || '', msg.tool_calls);
      } else {
        this.remember('assistant', msg.content || '');
      }

      return {
        reply: msg.content || null,
        tool_calls: msg.tool_calls || null,
      };
    } catch (err) {
      logError(`[LLM Tools] ${err.message} status:${err.status}`);
      // 400 错误通常是 history 污染 → 清空重试一次
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
            tool_choice: 'auto',
            temperature: this.temperature,
            max_tokens: this.maxTokens,
          });
          const msg = response.choices[0].message;
          this.remember('user', prompt);
          if (msg.tool_calls) {
            this.remember('assistant', msg.content || '', msg.tool_calls);
          } else {
            this.remember('assistant', msg.content || '');
          }
          return { reply: msg.content || null, tool_calls: msg.tool_calls || null };
        } catch (retryErr) {
          logError(`[LLM Tools Retry] ${retryErr.message}`);
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

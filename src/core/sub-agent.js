/**
 * 🤖 SubAgent — 子代理基类
 * 每个子代理有独立的目标、tools 子集、LLM 上下文
 * 可并行运行多个子代理
 */
const logger = require('./logger');

class SubAgent {
  /**
   * @param {string} name - 代理名称
   * @param {string} goal - 当前目标描述
   * @param {object} bot - Mineflayer bot 实例
   * @param {object} deps - { llm, memory, config, plugins }
   * @param {string[]} toolNames - 该代理可用的 tool 名称列表
   */
  constructor(name, goal, bot, deps, toolNames = []) {
    this.name = name;
    this.goal = goal;
    this.bot = bot;
    this.deps = deps;
    this.status = 'idle';     // idle | running | done | failed
    this.result = null;
    this.steps = [];          // 执行步骤记录
    this.maxSteps = 8;        // 最大步数（减少避免死循环）
    this._ownHistory = [];    // 子代理独立的 LLM 历史，不和主 LLM 共享

    // 筛选该代理可用的 tools（空数组 = 使用全部工具）
    this.tools = [];
    if (toolNames.length > 0) {
      for (const plugin of deps.plugins) {
        if (plugin.tools) {
          for (const t of plugin.tools) {
            if (toolNames.includes(t.function.name)) {
              this.tools.push(t);
            }
          }
        }
      }
    } else {
      // 使用全部工具
      for (const plugin of deps.plugins) {
        if (plugin.tools?.length) this.tools.push(...plugin.tools);
      }
    }
  }

  /** 执行一步：LLM 决策 → 执行 tool */
  async step() {
    if (this.status === 'done' || this.status === 'failed') return;
    if (this.steps.length >= this.maxSteps) {
      this.status = 'failed';
      this.result = 'max steps reached';
      return;
    }

    this.status = 'running';

    try {
      const ctx = this.deps.memory.getContext(this.bot);
      const result = await this._callLLM(ctx);

      if (result.reply) {
        console.log(`[SubAgent:${this.name}] ${result.reply.substring(0, 80)}`);
        // 保存最后的回复，完成时发送
        this._lastReply = result.reply;
      }

      if (result.tool_calls) {
        for (const tc of result.tool_calls) {
          const r = await this._executeTool(tc);
          this.steps.push({ tool: tc.function.name, args: tc.function.arguments, result: r });
          this._ownHistory.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(r ?? 'ok') });
        }

        if (this._isGoalAchieved()) {
          this._finish('done', 'success');
        }
      } else {
        this._finish('done', 'completed');
      }
    } catch (err) {
      this._finish('failed', err.message);
      logger.error(`agent:${this.name}`, err);
    }
  }

  _finish(status, result) {
    this.status = status;
    this.result = result;
    // 完成时把最后的回复发到游戏里（截断防止乱码）
    if (this._lastReply) {
      const clean = this._lastReply.replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '').substring(0, 80);
      if (clean) this.bot.chat(clean);
    }
  }

  /** 子代理独立 LLM 调用，不污染主 LLM history */
  async _callLLM(ctx) {
    const system = `你是 Minecraft 中的子代理。目标：${this.goal}
用中文简短回复。只使用提供的工具，高效完成任务。`;

    const prompt = `Step ${this.steps.length + 1}/${this.maxSteps}. Goal: ${this.goal}
HP:${ctx.health} Food:${ctx.food} Pos:${ctx.position} Holding:${ctx.equipped || '?'}
Nearby: ${ctx.ores || 'none'} | ${ctx.trees || 'none'}`;

    const messages = [
      { role: 'system', content: system },
      ...this._ownHistory.slice(-6),
      { role: 'user', content: prompt },
    ];

    const response = await this.deps.llm.client.chat.completions.create({
      model: this.deps.llm.model,
      messages,
      tools: this.tools,
      tool_choice: 'auto',
      temperature: 0.5,
      max_tokens: 200,
    });

    const msg = response.choices[0].message;
    if (msg.tool_calls) {
      this._ownHistory.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
    }
    return { reply: msg.content || null, tool_calls: msg.tool_calls || null };
  }

  /** 执行单个 tool */
  async _executeTool(tc) {
    const name = tc.function.name;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { logger.error('sub-agent/parseArgs', e); }

    for (const plugin of this.deps.plugins) {
      if (plugin.actions?.[name]) {
        try {
          return await plugin.actions[name](args);
        } catch (err) {
          logger.error(`sub-agent/${name}`, err);
          return false;
        }
      }
    }
    return false;
  }

  /** 上次执行结果摘要 */
  _lastResult() {
    if (this.steps.length === 0) return '';
    const last = this.steps[this.steps.length - 1];
    const status = last.result === true ? '✅' : last.result === false ? '❌' : last.result === 0 ? '⚠️0' : `${last.result}`;
    return `${last.tool} → ${status}`;
  }

  /** 判断目标是否达成（子类可覆盖） */
  _isGoalAchieved() {
    return false;
  }
}

module.exports = { SubAgent };

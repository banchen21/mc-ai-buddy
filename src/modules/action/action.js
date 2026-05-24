/**
 * 行为流引擎 — 编排 查询→决策→动作→反馈 完整流程
 *
 * 流程：
 *   1. LLM 决策（可调查询工具 + 动作工具）
 *   2. 执行工具（查询/动作）
 *   3. 结果追加到 history
 *   4. 循环：如果还有 tool_calls 继续执行，最多 N 轮
 *   5. 最终 LLM 生成自然语言回复
 */
const logger = require('../../core/logger');

class ActionModule {
  constructor(bot, deps) {
    this.bot = bot;
    this.llm = deps.llm;
    this.memory = deps.memory;
    this.config = deps.config;

    /** 所有工具定义 */
    this._tools = [];

    /** 工具执行器 */
    this._executors = {};

    /** 最大行为轮次 */
    this.maxRounds = 5;

    /** 人格设定（由消息模块注入） */
    this._persona = '';
  }

  setPersona(persona) {
    this._persona = persona;
  }

  /**
   * 注册工具
   */
  registerTool(toolDef, executor) {
    this._tools.push(toolDef);
    this._executors[toolDef.function.name] = executor;
  }

  /**
   * 行为流入口 — 玩家消息先经过这里
   * 纯聊天返回 false 交给消息模块
   */
  async handleCommand(username, message) {
    if (this._tools.length === 0) return false;

    try {
      const toolNames = this._tools.map(t => t.function.name).join('、');
      const system = (this._persona || '你是 Minecraft 中的 AI 助手。') +
        `\n\n当前对话玩家: ${username}\n可用工具: ${toolNames}` +
        `\n规则：问状态→调查询工具，给指令→调动作工具，纯聊天→不调工具。回复80字内。`;

      // ===== 第 1 轮：LLM 决策 =====
      let result = await this.llm.send(system, message, username, this._tools);

      // 纯聊天 → 直接回复
      if (!result.tool_calls?.length) {
        if (result.reply) {
          const clean = result.reply
            .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
            .replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '')
            .substring(0, 80);
          if (clean) this.bot.chat(clean);
        }
        return true;
      }

      // ===== 行为流循环：执行 → 反馈 → 再决策 =====
      let round = 0;
      while (result.tool_calls?.length > 0 && round < this.maxRounds) {
        round++;

        // 执行所有工具
        const results = [];
        for (const tc of result.tool_calls) {
          const name = tc.function.name;
          const params = JSON.parse(tc.function.arguments || '{}');
          const executor = this._executors[name];

          if (executor) {
            try {
              const r = await executor(params);
              results.push(r);
              logger.action('action', name, r);
            } catch (err) {
              results.push(`❌ ${err.message}`);
              logger.error('action/' + name, err);
            }
          } else {
            results.push(`未知工具: ${name}`);
          }
        }

        // 追加结果到 history
        this.llm.addToolResults(result.tool_calls, results);

        // 继续决策
        result = await this.llm.send(
          system,
          '还需要其他操作吗？不需要就不调工具。',
          username,
          this._tools,
        );

        // 没有更多 tool_calls → 撤销这条消息，结束循环
        if (!result.tool_calls?.length) {
          this.llm.undoLastSend();
          break;
        }
      }

      // ===== 最终回复：自然语言总结 =====
      const finalReply = await this.llm.send(
        '用中文回复玩家。',
        '请回复',
        username,
      );

      if (finalReply.reply) {
        const clean = finalReply.reply
          .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
          .replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '')
          .substring(0, 80);
        if (clean) this.bot.chat(clean);
      }

      return true;
    } catch (err) {
      logger.error('action', err);
      return false;
    }
  }
}

module.exports = { ActionModule };

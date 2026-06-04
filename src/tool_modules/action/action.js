/**
 * 行为模块 — 薄层，委托给 Agent 处理
 * 只负责：记忆记录 + 发送回复到游戏
 */
const logger = require('../../core/logger');

class ActionModule {
  constructor(bot, deps) {
    this.bot = bot;
    this.agent = deps.agent;
    this.memory = deps.journal;
    this.messageModule = deps.messageModule;
    this.voiceModule = deps.voiceModule;
  }

  async handleCommand(username, message, opts = {}) {
    if (!this.agent) return false;

    // 检查是否已被更高优先级的消息打断
    if (opts.abortSignal?.cancelled) return false;

    // 统计
    if (this.memory) {
      this.memory.incStat('chats');
    }

    try {
      const result = await this.agent.handle(username, message, opts);
      if (!result) return false;

      // 记录工具结果到 facts（供自主决策参考）
      if (this.memory && result.results.length > 0) {
        for (const r of result.results) {
          this.memory.remember('system', `[动作] ${r}`);
        }
        this.memory.incStat('actions', result.results.length);
      }

      // 发送最终回复（文本和语音并行，缩小间隔）
      if (result.reply) {
        if (this.voiceModule) {
          this.voiceModule.speak(result.reply);
        }
        if (this.messageModule) {
          await this.messageModule.send(result.reply);
        } else {
          this.bot.chat(result.reply);
        }
      }

      return true;
    } catch (err) {
      logger.error('action', err);
      return false;
    }
  }
}

module.exports = { ActionModule };

/**
 * 行为模块 — 薄层，委托给 Agent 处理
 * 只负责：记忆记录 + 发送回复到游戏
 */
const logger = require('../../core/logger');

class ActionModule {
  constructor(bot, deps) {
    this.bot = bot;
    this.agent = deps.agent;
    this.memory = deps.memory;
    this.messageModule = deps.messageModule;
  }

  async handleCommand(username, message) {
    if (!this.agent) return false;

    // 记录对话
    if (this.memory) {
      this.memory.remember(`[对话] ${username}: ${message}`);
      this.memory.incStat('chats');
    }

    try {
      const result = await this.agent.handle(username, message);
      if (!result) return false;

      // 记录动作到记忆
      if (this.memory && result.results.length > 0) {
        for (const r of result.results) {
          this.memory.remember(`[动作] ${r}`);
        }
        this.memory.incStat('actions', result.results.length);
      }

      // 发送最终回复（走 messageModule 过滤）
      if (result.reply) {
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

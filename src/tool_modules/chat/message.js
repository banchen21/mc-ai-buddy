/**
 * 消息模块 — 只负责消息收发，不涉及 LLM 调用
 */
const fs = require('fs');
const path = require('path');
const logger = require('../../core/logger');

const PERSONA_FILE = path.join(__dirname, '..', '..', '..', 'persona.md');

class MessageModule {
  constructor(bot, deps) {
    this.bot = bot;
    this.llm = deps.llm;
    this.memory = deps.journal;
    this.config = deps.config;
    this._queue = [];
    this._processing = false;

    /** 消息处理器链 */
    this._handlers = [];

    /** 人格设定 */
    this._persona = '';
  }

  /** 初始化事件监听 */
  init() {
    this._loadPersona();

    this.bot.on('chat', (username, message) => {
      if (username === this.bot.username) return;

      // 忽略空消息
      if (!message || !message.trim()) return;

      // 忽略以 / 开头的指令
      if (message.startsWith('/')) return;

      this._enqueue(username, message);
    });
  }

  /** 从 persona.md 加载人格设定 */
  _loadPersona() {
    try {
      this._persona = fs.readFileSync(PERSONA_FILE, 'utf-8').trim();
      console.log(`[Message] 📝 人格设定已加载 (${this._persona.length} 字)`);
    } catch (err) {
      console.log('[Message] ⚠️ persona.md 未找到，使用默认人格');
      this._persona = '';
    }
  }

  /** 重新加载人格设定（热更新） */
  reloadPersona() {
    this._loadPersona();
  }

  /**
   * 注册消息处理器
   */
  use(handler) {
    this._handlers.push(handler);
  }

  /** 消息入队 */
  _enqueue(username, message) {
    this._queue.push({ username, message });
    if (!this._processing) this._processQueue();
  }

  /** 异步处理消息队列 */
  async _processQueue() {
    this._processing = true;
    while (this._queue.length > 0) {
      const { username, message } = this._queue.shift();
      try {
        await this.onChat(username, message);
      } catch (err) {
        logger.error('message', err);
      }
    }
    this._processing = false;
  }

  /** 收到聊天消息 */
  async onChat(username, message) {
    logger.chat(username, message);

    if (this.memory) {
      this.memory.seePlayer(username);
    }

    for (const handler of this._handlers) {
      try {
        const handled = await handler(username, message);
        if (handled) return;
      } catch (err) {
        logger.error('message/handler', err);
      }
    }
  }

  /** 发送消息 */
  async send(msg) {
    const clean = msg
      .substring(0, 200);
    if (clean) {
      this.bot.chat(clean);
      logger.chat(this.bot.username, clean);
    }
  }

  /** 发送私聊 */
  async whisper(username, msg) {
    const clean = msg.substring(0, 200);
    this.bot.chat(`/msg ${username} ${clean}`);
    logger.chat(`${this.bot.username} → ${username}`, `[whisper] ${clean}`);
  }
}

module.exports = { MessageModule };

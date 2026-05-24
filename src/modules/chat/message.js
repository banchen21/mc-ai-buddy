/**
 * 消息模块 — 纯多轮对话，不涉及工具调用
 * 查询/动作类由 action 模块处理
 */
const fs = require('fs');
const path = require('path');
const logger = require('../../core/logger');

const PERSONA_FILE = path.join(__dirname, '..', '..', '..', 'persona.md');

class MessageModule {
  constructor(bot, deps) {
    this.bot = bot;
    this.llm = deps.llm;
    this.memory = deps.memory;
    this.config = deps.config;
    this._queue = [];
    this._processing = false;

    /** 消息处理器链 */
    this._handlers = [];

    /** 多轮对话开关 */
    this.chatEnabled = true;

    /** 人格设定 */
    this._persona = '';

    /** 共享工具（从 action 模块注入） */
    this._tools = [];
  }

  /** 设置共享工具列表 */
  setTools(tools) {
    this._tools = tools;
  }

  /** 初始化事件监听 */
  init() {
    this._loadPersona();

    this.bot.on('chat', (username, message) => {
      if (username === this.bot.username) return;
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

  /**
   * 多轮对话处理器 — 纯聊天，不传 tools
   */
  async _chatHandler(username, message) {
    if (!this.chatEnabled) return false;

    const system = this._persona + this._buildPlayerContext(username);
    const result = await this.llm.send(system, message, username, this._tools);

    // 有 tool_calls → 只查不执行，基于结果回复
    if (result.tool_calls?.length > 0) {
      // 消息模块不执行工具，撤销交给 action（但 action 已经返回 false 了）
      // 这里简单处理：撤销并返回 false
      this.llm.undoLastSend();
      return false;
    }

    if (result.reply) {
      await this.send(result.reply);
    }
    return true;
  }

  /** 构建玩家上下文 */
  _buildPlayerContext(username) {
    if (!this.memory) return '';

    const player = this.memory.data.players[username];
    if (!player) return `\n\n当前与你对话的玩家是 ${username}（首次见面）。`;

    const parts = [`当前与你对话的玩家是 ${username}。`];
    if (player.notes) {
      parts.push(`关于 ${username}：${player.notes}`);
    }
    return '\n\n' + parts.join(' ');
  }

  /** 发送消息 */
  async send(msg) {
    const clean = msg
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '')
      .substring(0, 80);
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

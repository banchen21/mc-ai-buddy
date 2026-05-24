/**
 * 💬 DialogueManager — 对话管理器
 *
 * 职责：
 * - 生成自然语言回复（LLM 对话）
 * - 使用 llm.chatHistory 进行多轮对话上下文拼接
 * - 不影响 bot 当前动作
 *
 * LLM 调用点之一
 */

class DialogueManager {
  constructor(llm, memory) {
    this.llm = llm;
    this.memory = memory;

    /** 待发送的回复队列 */
    this.pendingReplies = [];

    /** 并发锁 */
    this._generating = false;

    /** LLM 超时 (ms) */
    this._timeout = 15000;
  }

  /**
   * 处理对话消息
   * @param {string} message - 玩家消息
   * @param {string} username - 玩家名
   * @param {object} context - 环境上下文
   * @returns {string|null} 回复文本
   */
  async handleDialogue(message, username, context) {
    // 防止并发生成
    if (this._generating) {
      console.log(`[Dialogue] ⏳ Skipped (busy): "${message}"`);
      return null;
    }

    console.log(`[Dialogue] 💬 ${username}: "${message}"`);
    this._generating = true;
    try {
      const reply = await this._generateReply(message, username, context);
      if (reply) {
        console.log(`[Dialogue] → "${reply.substring(0, 60)}"`);
        // 记录到多轮对话历史
        this.llm.addChatMessage('assistant', reply);
        // 去重：不重复入队相同回复
        if (!this.pendingReplies.includes(reply)) {
          this.pendingReplies.push(reply);
        }
      }
      return reply;
    } catch (err) {
      console.error(`[Dialogue] ❌ ${err.message}`);
      return null;
    } finally {
      this._generating = false;
    }
  }

  /**
   * 获取下一个待发送的回复
   */
  nextReply() {
    return this.pendingReplies.shift() || null;
  }

  /**
   * 是否有待发送回复
   */
  get hasPendingReplies() {
    return this.pendingReplies.length > 0;
  }

  /**
   * 生成回复（带超时）
   * 使用多轮对话格式：system + 历史 + 当前 user
   */
  async _generateReply(message, username, context) {
    const system = `你是 Minecraft 中的 AI 伙伴。用中文简短自然地回复玩家。

**规则：**
- 回复要简短，1-2 句话，≤30 字
- 语气友好、自然
- 如果玩家问你的状态，如实回答
- 如果玩家闲聊，轻松回应
- 不要过度解释`;

    const envPrompt = `Bot 当前状态:
- HP: ${context.health ?? '?'}/20
- 位置: ${context.position ?? '?'}
- 手持: ${context.equipped ?? '?'}
- 背包: ${context.inventory ?? '空'}
- 生物群系: ${context.biome ?? '?'}

请回复:`;

    // 多轮对话格式：system + 最近历史（最多 6 条）+ 当前 user
    const chatHistory = this.llm.getChatHistory();
    const recentHistory = chatHistory.slice(-6);
    const messages = [
      { role: 'system', content: system },
      ...recentHistory,
      { role: 'user', content: envPrompt },
    ];

    try {
      const response = await this._withTimeout(
        this.llm.client.chat.completions.create({
          model: this.llm.model,
          messages,
          temperature: 0.7,
          max_tokens: 100,
          extra_body: this.llm._extraBody(),
        }),
        this._timeout,
      );

      return response.choices[0].message.content?.trim() || null;
    } catch (err) {
      if (err.message?.includes('timeout')) {
        console.log('[Dialogue] ⏰ LLM timeout');
      }
      return null;
    }
  }

  /** Promise 超时包装 */
  _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms)
      ),
    ]);
  }

  /**
   * 裁剪历史
   */
  _trimHistory() {
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  /**
   * 清空历史
   */
  clear() {
    this.history = [];
    this.pendingReplies = [];
    this._generating = false;
  }
}

module.exports = { DialogueManager };

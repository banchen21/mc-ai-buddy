/**
 * 任务编排器 — 将 LLM 返回的 tool_calls 编排为可执行的任务队列
 *
 * 职责：
 *   1. 接收 LLM 返回的 tool_calls
 *   2. 按顺序执行工具
 *   3. 结果追加到临时消息数组
 *   4. 循环：继续决策 → 执行 → 直到完成
 *   5. 最终生成自然语言回复
 *
 * 消息格式：Anthropic Messages API（content blocks）
 * system prompt 带 cache_control 断点，多轮工具循环中缓存命中
 */
const logger = require('./logger');

class TaskOrchestrator {
  constructor(llm, executors, options = {}) {
    this.llm = llm;
    this._executors = executors;
    this.maxRounds = options.maxRounds || 200;
    this.verbose = options.verbose !== false;
    this.onChat = options.onChat || null;
  }

  /**
   * 执行任务流
   */
  async run(systemPrompt, userMessage, username, tools, maxRounds, abortSignal) {
    const effectiveMaxRounds = maxRounds || this.maxRounds;
    const allResults = [];
    let round = 0;

    // 临时消息数组（Anthropic 格式）：历史 + 当前用户消息
    const internalMessages = [
      ...this.llm.history,
      { role: 'user', content: userMessage },
    ];

    // ===== 第 1 轮 =====
    let result = await this.llm.callRaw(systemPrompt, internalMessages, tools);

    // 纯聊天 → 写入持久历史并直接返回
    if (!result.tool_calls?.length) {
      const userMsg = { role: 'user', content: userMessage };
      if (username === 'system') userMsg.name = 'system';
      this.llm.history.push(
        userMsg,
        { role: 'assistant', content: result.reply || '' },
      );
      this.llm._trimHistory();
      if (this.llm._onHistoryChange) this.llm._onHistoryChange(this.llm.history);
      return { reply: result.reply, rounds: 0, results: [] };
    }

    // ===== 循环：执行 → 反馈 → 再决策 =====
    while (result.tool_calls?.length > 0 && round <= effectiveMaxRounds) {
      if (abortSignal?.cancelled) {
        console.log('[Orch] ⏹️ 用户打断，停止自动决策');
        return { reply: null, rounds: round, results: allResults };
      }
      round++;

      const tcNames = result.tool_calls
        .map((tc) => {
          const shortArgs = JSON.stringify(tc.input || {}).substring(0, 40);
          return `${tc.name}(${shortArgs})`;
        })
        .join(', ');
      console.log(`[Orch] 第${round}轮 → ${tcNames}`);

      if (result.rawMessage?.reasoning_content) {
        console.log(`\x1b[35m[思考]${result.rawMessage.reasoning_content}\x1b[0m`);
      }

      // 中间文本实时发送
      if (result.reply) {
        allResults.push(`[说] ${result.reply}`);
        if (this.onChat && username !== 'system') {
          this.onChat(result.reply);
        }
      }

      // 执行所有工具
      const roundResults = [];
      for (const tc of result.tool_calls) {
        const name = tc.function.name;
        const params = this._parseArgs(tc.function.arguments);
        const executor = this._executors[name];

        if (executor) {
          try {
            const r = await executor(params);
            roundResults.push(r);
            allResults.push(r);
            if (this.verbose) logger.action('orchestrator', name, r);
          } catch (err) {
            const msg = `❌ ${err.message}`;
            roundResults.push(msg);
            allResults.push(msg);
            logger.error('orchestrator/' + name, err);
          }
        } else {
          const msg = `未知工具: ${name}`;
          roundResults.push(msg);
          allResults.push(msg);
        }
      }

      // 追加 assistant 消息（Anthropic content blocks 格式）
      const rawContent = result.rawMessage?.content || [];
      internalMessages.push({ role: 'assistant', content: rawContent });

      // 追加 tool_result 消息（每个 tool_use 一条）
      for (let i = 0; i < result.tool_calls.length; i++) {
        internalMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: result.tool_calls[i].id,
              content: JSON.stringify(roundResults[i] ?? 'ok'),
            },
          ],
        });
      }

      result = await this.llm.callRaw(systemPrompt, internalMessages, tools);

      if (!result.tool_calls?.length) {
        break;
      }
    }

    // ===== 最终回复 =====
    let reply = result.reply;

    if (!reply) {
      console.log(`[Orch] ⚠️ 达到最大轮次(${effectiveMaxRounds})，清理工具历史后生成回复`);
      this.llm.stripToolHistory();
      const finalResult = await this.llm.send(
        '用中文回复玩家。禁止使用任何 XML 标签。',
        userMessage,
        username,
        null,
      );
      reply = finalResult.reply;
      if (finalResult.tool_calls?.length > 0) reply = '好的';
    } else {
      this.llm.stripToolHistory();
      const userMsg = { role: 'user', content: userMessage };
      if (username === 'system') userMsg.name = 'system';
      this.llm.history.push(
        userMsg,
        { role: 'assistant', content: reply },
      );
      this.llm._trimHistory();
      if (this.llm._onHistoryChange) this.llm._onHistoryChange(this.llm.history);
    }

    reply = (reply || '').substring(0, 256).trim();

    console.log(`[Orch] ✅ 完成 ${round}轮/${allResults.length}动作 → "${reply}"`);
    return { reply, rounds: round, results: allResults };
  }

  _parseArgs(args) {
    try {
      return JSON.parse(args || '{}');
    } catch {
      return {};
    }
  }
}

module.exports = { TaskOrchestrator };

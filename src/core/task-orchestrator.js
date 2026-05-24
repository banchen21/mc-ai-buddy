/**
 * 任务编排器 — 将 LLM 返回的 tool_calls 编排为可执行的任务队列
 *
 * 职责：
 *   1. 接收 LLM 返回的 tool_calls
 *   2. 按顺序执行工具
 *   3. 结果追加到 LLM history
 *   4. 循环：继续决策 → 执行 → 直到完成
 *   5. 最终生成自然语言回复
 *
 * 注意：编排器内部调用直接走 llm.client，不经过 llm.send()，
 *       避免 "继续"/"回复" 等内部提示词污染对话历史。
 */
const logger = require("./logger");

class TaskOrchestrator {
  constructor(llm, executors, options = {}) {
    this.llm = llm;
    this._executors = executors;
    this.maxRounds = options.maxRounds || 10;
    this.verbose = options.verbose !== false;
    /** 中间回复回调 (msg) => void */
    this.onChat = options.onChat || null;
  }

  /**
   * 直接调用 LLM API（不写入 history）
   * @returns {{ reply: string, tool_calls: array|null }}
   */
  async _callLLM(systemPrompt, messages, tools) {
    const params = {
      model: this.llm.model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: this.llm.maxTokens,
      temperature: this.llm.temperature,
      extra_body: this.llm._extraBody(),
    };

    if (tools && tools.length > 0) {
      params.tools = this.llm.useStrictTools
        ? tools.map((t) => ({
            ...t,
            function: { ...t.function, strict: true },
          }))
        : tools;
      params.tool_choice = "auto";
    }

    const response = await this.llm.client.chat.completions.create(params);
    const msg = response.choices[0].message;
    const usage = response.usage || {};

    // 日志
    const hit = usage.prompt_cache_hit_tokens || 0;
    const total = usage.prompt_tokens || 0;
    const hitRate = total > 0 ? ((hit / total) * 100).toFixed(0) : 0;
    const reply = (msg.content || "").trim();
    const tcCount = msg.tool_calls?.length || 0;
    const tcDetail =
      tcCount > 0
        ? " [" +
          msg.tool_calls
            .map((tc) => {
              let args = "";
              try {
                args = JSON.stringify(
                  JSON.parse(tc.function.arguments),
                ).substring(0, 50);
              } catch {}
              return `${tc.function.name}(${args})`;
            })
            .join(", ") +
          "]"
        : "";
    const lastMsg = messages[messages.length - 1];
    const label = lastMsg?.content?.substring(0, 20) || "";
    console.log(
      `[LLM] "${label}" → "${(reply || '').substring(0, 30)}"` +
        tcDetail +
        ` | 💾 cache:${hit}/${total} (${hitRate}%)`,
    );

    return {
      reply: reply || null,
      tool_calls: msg.tool_calls || null,
      rawMessage: msg, // 保留完整消息（含 reasoning_content 等）
    };
  }

  /**
   * 执行任务流
   * @param {string} systemPrompt — 系统提示
   * @param {string} userMessage — 用户消息
   * @param {string} username — 用户名
   * @param {array} tools — 工具定义
   * @returns {{ reply: string, rounds: number, results: string[] }}
   */
  async run(systemPrompt, userMessage, username, tools) {
    const allResults = [];
    let round = 0;

    // 构建内部消息数组（从头手动管理，不污染 llm.history）
    const internalMessages = [
      {
        role: "user",
        content: userMessage,
        ...(username ? { name: username } : {}),
      },
    ];

    // ===== 第 1 轮：LLM 决策（直接调 API） =====
    let result = await this._callLLM(systemPrompt, internalMessages, tools);

    // 纯聊天 → 写入 history 并直接返回
    if (!result.tool_calls?.length) {
      this.llm.history.push(
        {
          role: "user",
          content: userMessage,
          ...(username ? { name: username } : {}),
        },
        { role: "assistant", content: result.reply || "" },
      );
      this.llm._trimHistory();
      if (this.llm._onHistoryChange)
        this.llm._onHistoryChange(this.llm.history);
      return { reply: result.reply, rounds: 0, results: [] };
    }

    // ===== 循环：执行 → 反馈 → 再决策 =====
    while (result.tool_calls?.length > 0 && round <= this.maxRounds) {
      round++;

      // 日志：本轮工具
      const tcNames = result.tool_calls
        .map((tc) => {
          const args = this._parseArgs(tc.function.arguments);
          const shortArgs = JSON.stringify(args).substring(0, 40);
          return `${tc.function.name}(${shortArgs})`;
        })
        .join(", ");
      console.log(`[Orch] 第${round}轮 → ${tcNames}`);

      // 思考过程：仅控制台彩色输出，不发送到游戏（避免非法字符踢出）
      if (result.rawMessage?.reasoning_content) {
        const thinking = result.rawMessage.reasoning_content;
        console.log(`\x1b[35m[思考]${thinking}\x1b[0m`);
      }

      // 如果 LLM 同时返回了文本回复，收集
      if (result.reply) {
        allResults.push(`[说] ${result.reply}`);
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
            if (this.verbose) logger.action("orchestrator", name, r);
          } catch (err) {
            const msg = `❌ ${err.message}`;
            roundResults.push(msg);
            allResults.push(msg);
            logger.error("orchestrator/" + name, err);
          }
        } else {
          const msg = `未知工具: ${name}`;
          roundResults.push(msg);
          allResults.push(msg);
        }
      }

      // 追加 assistant 消息（保留 reasoning_content 等字段） + tool 结果
      const assistantMsg = { ...result.rawMessage };
      internalMessages.push(assistantMsg);
      for (let i = 0; i < result.tool_calls.length; i++) {
        internalMessages.push({
          role: "tool",
          tool_call_id: result.tool_calls[i].id,
          content: JSON.stringify(roundResults[i] ?? "ok"),
        });
      }

      // 继续决策（直接调 API，不经过 send）
      result = await this._callLLM(systemPrompt, internalMessages, tools);

      // 没有更多 tool_calls → 用当前回复作为最终结果
      if (!result.tool_calls?.length) {
        break;
      }
    }

    // ===== 最终回复 =====
    let reply = result.reply;

    if (!reply) {
      // 达到 maxRounds 上限，清理 history 后请求最终回复
      console.log(
        `[Orch] ⚠️ 达到最大轮次(${this.maxRounds})，清理工具历史后生成回复`,
      );
      this.llm.stripToolHistory();
      const finalResult = await this.llm.send(
        "用中文回复玩家。禁止使用任何 XML 标签。",
        userMessage,
        username,
        null,
      );
      reply = finalResult.reply;
      if (finalResult.tool_calls?.length > 0) reply = "好的";
    } else {
      // 正常完成：写入纯文本对话到 history，清理 tool 残留
      this.llm.stripToolHistory();
      this.llm.history.push(
        {
          role: "user",
          content: userMessage,
          ...(username ? { name: username } : {}),
        },
        { role: "assistant", content: reply },
      );
      this.llm._trimHistory();
      if (this.llm._onHistoryChange)
        this.llm._onHistoryChange(this.llm.history);
    }

    // 过滤残留标签
    reply = (reply || '').substring(0, 256).trim();

    console.log(
      `[Orch] ✅ 完成 ${round}轮/${allResults.length}动作 → "${reply}"`,
    );
    return { reply, rounds: round, results: allResults };
  }

  /** 安全解析 JSON 参数 */
  _parseArgs(args) {
    try {
      return JSON.parse(args || "{}");
    } catch {
      return {};
    }
  }
}

module.exports = { TaskOrchestrator };

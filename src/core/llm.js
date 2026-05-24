/**
 * LLM 统一入口 — 封装 DeepSeek API
 * 统一方法：同一次请求同时支持文本回复 + Tool Calls
 * 共享一套 history，适配 KV Cache
 */
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "..", "..", "activity.log");

function logError(msg) {
  const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const line = `[${ts}] ❌ LLM: ${msg}`;
  console.error(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

class LLM {
  constructor(config) {
    const baseURL = config.useStrictTools
      ? config.betaBaseUrl || "https://api.deepseek.com/beta"
      : config.baseUrl;

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL,
    });
    this.model = config.model || "deepseek-chat";
    this.useStrictTools = config.useStrictTools !== false;
    this.maxTokens = config.maxTokens || 300;
    this.temperature = config.temperature || 0.7;

    /**
     * 统一对话历史
     * 格式: [{ role, content, name?, tool_calls?, tool_call_id? }]
     * 包含 user / assistant / tool 三种角色
     */
    this.history = [];
    this.maxHistory = config.maxHistory || 20;

    /** 思考模式 */
    this.thinkingMode = config.thinkingMode || "enabled";
  }

  /** 获取 extra_body（思考模式控制） */
  _extraBody() {
    if (this.thinkingMode === "disabled") {
      return { thinking: { type: "disabled" } };
    }
    return {};
  }

  // ===== 统一对话接口 =====

  /**
   * 统一对话 — 同时支持文本回复 + Tool Calls
   * @param {string} systemPrompt — 系统提示（人格设定等）
   * @param {string} userMessage — 用户消息
   * @param {string} [username] — 用户名
   * @param {array}  [tools] — 可选工具定义
   * @returns {{ reply: string, tool_calls: array|null }}
   */
  async send(systemPrompt, userMessage, username = "", tools = null) {
    this._cleanOrphanToolCalls();

    try {
      const messages = [
        { role: "system", content: systemPrompt },
        ...this.history,
        {
          role: "user",
          content: userMessage,
          ...(username ? { name: username } : {}),
        },
      ];

      const params = {
        model: this.model,
        messages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        extra_body: this._extraBody(),
      };

      // 有工具时传入 tools
      if (tools && tools.length > 0) {
        params.tools = this.useStrictTools
          ? tools.map((t) => ({
              ...t,
              function: { ...t.function, strict: true },
            }))
          : tools;
        params.tool_choice = "auto";
      }

      const response = await this.client.chat.completions.create(params);
      const msg = response.choices[0].message;
      const usage = response.usage || {};

      // 追加到统一历史
      this.history.push({
        role: "user",
        content: userMessage,
        ...(username ? { name: username } : {}),
      });
      this.history.push(msg);
      this._trimHistory();

      // 自动保存到 memory
      if (this._onHistoryChange) this._onHistoryChange(this.history);

      // KV Cache 日志
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
      console.log(
        `[LLM] "${userMessage}" → "${reply}"` +
          tcDetail +
          ` | 💾 cache:${hit}/${total} (${hitRate}%)`,
      );

      return {
        reply: reply || null,
        tool_calls: msg.tool_calls || null,
      };
    } catch (err) {
      logError(`[LLM] ${err.message} status:${err.status}`);
      if (err.status === 400) {
        this.history = [];
        // 重试时不传 tools（可能是 tools 格式问题）
        return this.send(systemPrompt, userMessage, username, null);
      }
      return { reply: null, tool_calls: null };
    }
  }

  /**
   * 追加 tool 执行结果到历史
   */
  addToolResults(toolCalls, results) {
    for (let i = 0; i < toolCalls.length; i++) {
      this.history.push({
        role: "tool",
        tool_call_id: toolCalls[i].id,
        content: JSON.stringify(results[i] ?? "ok"),
      });
    }
    this._trimHistory();
  }

  /**
   * 撤销最近一次 send() 追加的历史（user + assistant）
   * 用于 action 判断是纯聊天时回退，交给消息模块处理
   */
  undoLastSend() {
    // 移除 assistant 消息
    if (
      this.history.length > 0 &&
      this.history[this.history.length - 1].role === "assistant"
    ) {
      this.history.pop();
    }
    // 移除 user 消息
    if (
      this.history.length > 0 &&
      this.history[this.history.length - 1].role === "user"
    ) {
      this.history.pop();
    }
  }

  // ===== 历史管理 =====

  /** 清理孤立的 tool_calls */
  _cleanOrphanToolCalls() {
    const cleaned = [];
    let pending = false;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const msg = this.history[i];
      if (msg.role === "tool") {
        pending = true;
        cleaned.unshift(msg);
      } else if (msg.role === "assistant" && msg.tool_calls) {
        if (pending) {
          cleaned.unshift(msg);
          pending = false;
        }
      } else {
        cleaned.unshift(msg);
      }
    }
    this.history = cleaned;
  }

  /** 裁剪历史，不拆散 tool_calls ↔ tool 配对 */
  _trimHistory() {
    if (this.history.length <= this.maxHistory) return;

    const excess = this.history.length - this.maxHistory;
    let cutAt = excess;

    for (let i = cutAt; i < this.history.length; i++) {
      if (this.history[i].role === "tool") {
        for (let j = i - 1; j >= 0; j--) {
          if (
            this.history[j].role === "assistant" &&
            this.history[j].tool_calls
          ) {
            if (j < cutAt) cutAt = j;
            break;
          }
        }
      }
    }

    if (cutAt > 0 && cutAt < this.history.length) {
      const atCut = this.history[cutAt];
      if (atCut.role === "assistant" && atCut.tool_calls) {
        for (let j = cutAt - 1; j >= 0; j--) {
          if (this.history[j].role === "user") {
            cutAt = j;
            break;
          }
        }
      }
    }

    this.history = this.history.slice(cutAt);
  }

  /**
   * 移除所有 tool_calls / tool 消息，只保留纯文本 user/assistant 对话
   * 用于 maxRounds 耗尽后清理上下文，避免 LLM 继续伪造 tool_calls
   */
  stripToolHistory() {
    this.history = this.history.filter(
      (msg) =>
        msg.role === "user" || (msg.role === "assistant" && !msg.tool_calls),
    );
  }
}

module.exports = { LLM };

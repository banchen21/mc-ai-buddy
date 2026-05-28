/**
 * LLM 统一入口 — OpenAI 兼容 API 封装
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
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model || "deepseek-chat";
    this.maxTokens = config.maxTokens || 300;
    this.temperature = config.temperature || 0.7;

    /** 对话历史 [{ role, content, name?, tool_calls?, tool_call_id? }] */
    this.history = [];
    this.maxHistory = config.maxHistory || 20;
  }

  // ===== 统一对话接口 =====

  /**
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @param {string} [username]
   * @param {array}  [tools]
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
      };

      if (tools && tools.length > 0) {
        params.tools = tools;
        params.tool_choice = "auto";
      }

      const response = await this.client.chat.completions.create(params);
      const msg = response.choices[0].message;
      const usage = response.usage || {};

      this.history.push({
        role: "user",
        content: userMessage,
        ...(username ? { name: username } : {}),
      });
      this.history.push(msg);
      this._trimHistory();

      if (this._onHistoryChange) this._onHistoryChange(this.history);

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
   */
  undoLastSend() {
    if (
      this.history.length > 0 &&
      this.history[this.history.length - 1].role === "assistant"
    ) {
      this.history.pop();
    }
    if (
      this.history.length > 0 &&
      this.history[this.history.length - 1].role === "user"
    ) {
      this.history.pop();
    }
  }

  // ===== 历史管理 =====

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
   */
  stripToolHistory() {
    this.history = this.history.filter(
      (msg) =>
        msg.role === "user" || (msg.role === "assistant" && !msg.tool_calls),
    );
  }
}

module.exports = { LLM };

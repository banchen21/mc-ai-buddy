/**
 * LLM 统一入口 — Anthropic API 封装（cache_control 优化多轮工具调用）
 */
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', '..', 'activity.log');

function logError(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${ts}] LLM: ${msg}`;
  console.error(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

/** Anthropic tool_use block → 内部 tool_call 格式（兼容编排器） */
function toToolCall(block) {
  return {
    id: block.id,
    name: block.name,
    function: {
      name: block.name,
      arguments: JSON.stringify(block.input),
    },
    input: block.input,
  };
}

class LLM {
  constructor(config) {
    this.client = new Anthropic({
      authToken: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    this.model = config.model || 'claude-sonnet-4-6';
    this.maxTokens = config.maxTokens || 1024;
    this.temperature = config.temperature || 0.7;

    /** 对话历史 — Anthropic 格式 [{ role, content }] */
    this.history = [];
    this.maxHistory = config.maxHistory || 16;
  }

  // ===== 统一对话接口 =====

  /**
   * 发送消息并追加到持久历史（编排器 max-rounds 兜底用）
   */
  async send(systemPrompt, userMessage, username = '', tools = null) {
    this._cleanOrphanToolCalls();

    try {
      const messages = [
        ...this.history,
        { role: 'user', content: userMessage },
      ];

      const params = this._buildParams(systemPrompt, messages, tools);

      const response = await this.client.messages.create(params);
      const usage = response.usage || {};

      // 提取文本和工具调用
      const textBlocks = response.content.filter((b) => b.type === 'text');
      const toolBlocks = response.content.filter((b) => b.type === 'tool_use');
      const reply = textBlocks.map((b) => b.text).join('').trim();

      // 写入持久历史
      this.history.push({ role: 'user', content: userMessage });
      this.history.push({ role: 'assistant', content: response.content });
      this._trimHistory();
      if (this._onHistoryChange) this._onHistoryChange(this.history);

      this._log(usage, userMessage, reply, toolBlocks);

      return {
        reply: reply || null,
        tool_calls: toolBlocks.length > 0 ? toolBlocks.map(toToolCall) : null,
      };
    } catch (err) {
      logError(`${err.message} status:${err.status}`);
      if (err.status === 400) {
        this.history = [];
        return this.send(systemPrompt, userMessage, username, null);
      }
      return { reply: null, tool_calls: null };
    }
  }

  // ===== 编排器用：直接调 API，不写 history =====

  /**
   * 直接调用 Anthropic API，使用临时 internalMessages
   * systemPrompt 自动带 cache_control
   */
  async callRaw(systemPrompt, messages, tools) {
    const params = this._buildParams(systemPrompt, messages, tools);
    const response = await this.client.messages.create(params);
    const usage = response.usage || {};

    const textBlocks = response.content.filter((b) => b.type === 'text');
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use');

    const reply = textBlocks.map((b) => b.text).join('').trim();
    this._log(usage, messages[messages.length - 1]?.content?.substring?.(0, 20) || '[blocks]', reply, toolBlocks);

    return {
      reply: reply || null,
      tool_calls: toolBlocks.length > 0 ? toolBlocks.map(toToolCall) : null,
      rawMessage: response,
    };
  }

  // ===== 内部 =====

  _buildParams(systemPrompt, messages, tools) {
    const params = {
      model: this.model,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    };

    if (tools && tools.length > 0) {
      params.tools = tools;
    }
    return params;
  }

  _log(usage, label, reply, toolBlocks) {
    const hit = usage.cache_read_input_tokens || 0;
    const create = usage.cache_creation_input_tokens || 0;
    const total = usage.input_tokens || 0;
    const hitRate = total > 0 ? ((hit / total) * 100).toFixed(0) : 0;
    const createStr = create > 0 ? ` +${create}` : '';
    const tcDetail =
      toolBlocks.length > 0
        ? ' [' +
          toolBlocks
            .map((b) => {
              const args = JSON.stringify(b.input || {}).substring(0, 40);
              return `${b.name}(${args})`;
            })
            .join(', ') +
          ']'
        : '';
    console.log(
      `[LLM] "${String(label).substring(0, 20)}" → "${reply.substring(0, 30)}"` +
        tcDetail +
        ` | 💾 cache:${hit}${createStr}/${total} (${hitRate}%)`,
    );
  }

  // ===== 历史管理 =====

  /**
   * 追加 tool 执行结果到持久历史
   * @param {array} toolCalls — 内部 tool_call 格式（含 id）
   */
  addToolResults(toolCalls, results) {
    for (let i = 0; i < toolCalls.length; i++) {
      this.history.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolCalls[i].id,
            content: JSON.stringify(results[i] ?? 'ok'),
          },
        ],
      });
    }
    this._trimHistory();
  }

  undoLastSend() {
    if (this.history.length > 0 && this.history[this.history.length - 1].role === 'assistant') {
      this.history.pop();
    }
    if (this.history.length > 0 && this.history[this.history.length - 1].role === 'user') {
      this.history.pop();
    }
  }

  _cleanOrphanToolCalls() {
    const cleaned = [];
    let pending = false;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const msg = this.history[i];
      if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.some((b) => b.type === 'tool_result')) {
        pending = true;
        cleaned.unshift(msg);
      } else if (msg.role === 'assistant' && Array.isArray(msg.content) && msg.content.some((b) => b.type === 'tool_use')) {
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
      const msg = this.history[i];
      if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.some((b) => b.type === 'tool_result')) {
        for (let j = i - 1; j >= 0; j--) {
          const prev = this.history[j];
          if (prev.role === 'assistant' && Array.isArray(prev.content) && prev.content.some((b) => b.type === 'tool_use')) {
            if (j < cutAt) cutAt = j;
            break;
          }
        }
      }
    }

    if (cutAt > 0 && cutAt < this.history.length) {
      const atCut = this.history[cutAt];
      if (atCut.role === 'assistant' && Array.isArray(atCut.content)) {
        for (let j = cutAt - 1; j >= 0; j--) {
          if (this.history[j].role === 'user') {
            cutAt = j;
            break;
          }
        }
      }
    }

    this.history = this.history.slice(cutAt);
  }

  /** 清理工具调用痕迹，只保留纯文本 user/assistant 对话 */
  stripToolHistory() {
    this.history = this.history.filter((msg) => {
      if (msg.role === 'user') {
        if (Array.isArray(msg.content)) {
          return !msg.content.some((b) => b.type === 'tool_result');
        }
        return true;
      }
      if (msg.role === 'assistant') {
        if (Array.isArray(msg.content)) {
          return !msg.content.some((b) => b.type === 'tool_use');
        }
        return true;
      }
      return false;
    });
  }
}

module.exports = { LLM };

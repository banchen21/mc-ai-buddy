/**
 * 统一日志 — 劫持 console.log 同时写入 activity.log
 */
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', '..', 'activity.log');
const JSONL_FILE = path.join(__dirname, '..', '..', 'activity.jsonl');

let _logEnabled = true;
let _jsonlEnabled = true;

function ts() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function iso() {
  return new Date().toISOString();
}

// ===== 劫持 console.log，同时写文件 =====
const _originalLog = console.log;
const _originalError = console.error;

console.log = function (...args) {
  const line = `[${ts()}] ${args.join(' ')}`;
  _originalLog(line);
  if (_logEnabled) {
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
  }
};

console.error = function (...args) {
  const line = `[${ts()}] ❌ ${args.join(' ')}`;
  _originalError(line);
  if (_logEnabled) {
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
  }
};

// ===== logger 对象（保留兼容旧接口） =====
const logger = {
  _bot: null,

  attach(bot) { this._bot = bot; },

  _state() {
    if (!this._bot?.entity) return { pos: '?', hp: '?' };
    const p = this._bot.entity.position;
    return {
      pos: `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`,
      hp: Math.round(this._bot.health),
      food: Math.round(this._bot.food),
    };
  },

  _stateStr() {
    const s = this._state();
    return ` | ${s.pos} HP:${s.hp}`;
  },

  _write(line, json) {
    if (_logEnabled) {
      try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
    }
    if (json && _jsonlEnabled) {
      try { fs.appendFileSync(JSONL_FILE, JSON.stringify({ ts: iso(), ...json }) + '\n'); } catch (e) {}
    }
  },

  info(plugin, msg) {
    const s = this._state();
    this._write(`[${ts()}] ℹ️ ${plugin}: ${msg}${this._stateStr()}`,
      { type: 'info', plugin, msg, ...s });
  },

  action(plugin, action, result) {
    const r = result !== undefined ? ` → ${result}` : '';
    const s = this._state();
    this._write(`[${ts()}] ⚡ ${plugin}/${action}${r}${this._stateStr()}`,
      { type: 'action', plugin, action, result, ...s });
  },

  chat(speaker, msg) {
    const s = this._state();
    this._write(`[${ts()}] 💬 ${speaker}: ${msg}${this._stateStr()}`,
      { type: 'chat', speaker, msg, ...s });
  },

  llm(purpose, input, output) {
    let out, toolNames = [];
    if (typeof output === 'string') {
      out = output.substring(0, 200);
    } else if (output?.tool_calls) {
      toolNames = output.tool_calls.map(tc => tc.function.name);
      const calls = toolNames.map((n, i) => {
        const args = output.tool_calls[i].function.arguments || '{}';
        return `${n}(${args.substring(0, 60)})`;
      }).join(' → ');
      out = `reply:"${(output.reply || '').substring(0, 40)}" tools:[${calls}]`;
    } else {
      out = JSON.stringify(output).substring(0, 200);
    }
    const s = this._state();
    this._write(`[${ts()}] 🤖 LLM/${purpose}: "${input}" → ${out}${this._stateStr()}`,
      { type: 'llm', purpose, input, output: out, toolNames, ...s });
  },

  error(plugin, err) {
    const s = this._state();
    const msg = err.message || String(err);
    console.error(`[${ts()}] ❌ ${plugin}: ${msg}${this._stateStr()}`);
    this._write(`[${ts()}] ❌ ${plugin}: ${msg}${this._stateStr()}`,
      { type: 'error', plugin, error: msg, ...s });
  },

  status(state, detail) {
    const s = this._state();
    this._write(`[${ts()}] 📡 STATUS: ${state}${detail ? ' - ' + detail : ''}${this._stateStr()}`,
      { type: 'status', state, detail, ...s });
  },

  event(name, detail) {
    const s = this._state();
    this._write(`[${ts()}] 🔔 ${name}${detail ? ': ' + detail : ''}${this._stateStr()}`,
      { type: 'event', name, detail, ...s });
  },

  /** 根据 config.logging 设置日志开关 */
  configure(cfg) {
    if (cfg?.logging) {
      if (typeof cfg.logging.activityLog === 'boolean') {
        _logEnabled = cfg.logging.activityLog;
      }
      if (typeof cfg.logging.activityJsonl === 'boolean') {
        _jsonlEnabled = cfg.logging.activityJsonl;
      }
    }
  },
};

module.exports = logger;

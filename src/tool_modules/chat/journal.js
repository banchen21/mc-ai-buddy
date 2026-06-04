/**
 * 日志记忆模块 — 按服务器存储 JSON 日志文件
 * 文件路径：memory/<host>_<port>.json
 */
const fs = require('fs');
const path = require('path');

const JOURNAL_DIR = path.join(__dirname, '..', '..', '..', 'memory');

class Journal {
  constructor(bot, deps) {
    this.bot = bot;
    this.config = deps.config;

    /** 日志数据 */
    this.data = {
      server: '',
      createdAt: '',
      updatedAt: '',
      players: {},       // { username: { firstSeen, lastSeen, notes } }
      chatHistory: [],   // [{ role, content, name?, ts }] 统一短时记忆
      locations: {},     // { name: { x, y, z, desc } }  命名坐标
      stats: {},         // { deaths, chats, ... }
    };

    /** 日志文件路径 */
    this._file = '';
  }

  /** 初始化 — 加载或创建日志文件 */
  init() {
    const { host, port } = this.config.bot;
    const safeName = `${host}_${port}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    this._file = path.join(JOURNAL_DIR, `${safeName}.json`);

    // 确保目录存在
    if (!fs.existsSync(JOURNAL_DIR)) {
      fs.mkdirSync(JOURNAL_DIR, { recursive: true });
    }

    if (fs.existsSync(this._file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this._file, 'utf-8'));
        console.log(`[Journal] 📂 已加载日志: ${safeName} (${this.data.chatHistory.length} 条对话)`);
      } catch (err) {
        console.log(`[Journal] ⚠️ 日志文件损坏，重新创建`);
        this._initFresh(safeName);
      }
    } else {
      this._initFresh(safeName);
    }
  }

  _initFresh(safeName) {
    this.data.server = safeName;
    this.data.createdAt = new Date().toISOString();
    this._save();
    console.log(`[Journal] 🆕 新日志: ${safeName}`);
  }

  /** 持久化到磁盘 */
  _save() {
    this.data.updatedAt = new Date().toISOString();
    try {
      fs.writeFileSync(this._file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error(`[Journal] ❌ 保存失败: ${err.message}`);
    }
  }

  // ===== 玩家记录 =====

  /** 记录玩家出现 */
  seePlayer(username) {
    const now = Date.now();
    if (!this.data.players[username]) {
      this.data.players[username] = { firstSeen: now, lastSeen: now, notes: '' };
    } else {
      this.data.players[username].lastSeen = now;
    }
    this._save();
  }

  /** 记录关于玩家的备注 */
  notePlayer(username, note) {
    if (!this.data.players[username]) {
      this.seePlayer(username);
    }
    this.data.players[username].notes = note;
    this._save();
  }

  // ===== 短时记忆（统一 chatHistory） =====

  /**
   * 记录一条系统事件到 chatHistory
   * @param {'system'|'tool'} role
   * @param {string} content
   */
  remember(role, content) {
    this.data.chatHistory.push({ role, content, ts: new Date().toISOString() });
    // 最多保留 200 条
    if (this.data.chatHistory.length > 200) {
      this.data.chatHistory = this.data.chatHistory.slice(-200);
    }
    this._save();
  }

  /** 获取最近 N 条系统/工具记录（供自主决策上下文） */
  recentFacts(n = 10) {
    return this.data.chatHistory
      .filter(m => m.role === 'system' || m.role === 'tool')
      .slice(-n)
      .map(m => m.content);
  }

  // ===== 位置记录 =====

  /** 记录命名坐标 */
  rememberLocation(name, x, y, z, desc = '') {
    this.data.locations[name] = { x, y, z, desc };
    this._save();
  }

  /** 获取命名坐标 */
  getLocation(name) {
    return this.data.locations[name] || null;
  }

  // ===== 统计 =====

  /** 增加统计计数 */
  incStat(key, delta = 1) {
    this.data.stats[key] = (this.data.stats[key] || 0) + delta;
    this._save();
  }

  /** 获取统计 */
  getStat(key) {
    return this.data.stats[key] || 0;
  }

  // ===== LLM 对话历史（与 chatHistory 同步） =====

  /**
   * 将 LLM 内存 history 同步到 chatHistory
   * 只同步真正的 user/assistant 对话，过滤系统通知
   */
  saveHistory(history) {
    // 保留已有的 system/tool 记录，替换 user/assistant 部分
    const sysMsgs = this.data.chatHistory.filter(m => m.role === 'system' || m.role === 'tool');
    const chatMsgs = history
      .filter(m => {
        if (m.role !== 'user' && m.role !== 'assistant') return false;
        const content = typeof m.content === 'string' ? m.content : '';
        // 过滤系统通知
        if (content.startsWith('[系统通知]') || content.startsWith('（已自动处理：')) return false;
        return true;
      })
      .slice(-40)
      .map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        ...(msg.name ? { name: msg.name } : {}),
        ts: new Date().toISOString(),
      }));
    this.data.chatHistory = [...sysMsgs, ...chatMsgs].slice(-200);
    this._save();
  }

  /** 恢复 LLM 对话历史（只返回 user/assistant 消息） */
  loadHistory() {
    return this.data.chatHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content, ...(m.name ? { name: m.name } : {}) }));
  }
}

module.exports = { Journal };

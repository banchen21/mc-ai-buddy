/**
 * 📡 状态指示器 — 实时显示 bot 当前在做什么
 * 通过 bot.chat() 或 console 输出当前状态
 */
class StatusIndicator {
  constructor(bot) {
    this.bot = bot;
    this.current = 'idle';
    this.startTime = 0;
    this.lastReport = 0;
    this.reportInterval = 5000; // 每 5 秒报告一次
    this._timer = null;
  }

  /** 状态枚举 */
  static STATES = {
    idle:       { emoji: '💤', text: '待命中' },
    thinking:   { emoji: '🤔', text: '思考中' },
    moving:     { emoji: '🚶', text: '移动中' },
    mining:     { emoji: '⛏️', text: '挖矿中' },
    chopping:   { emoji: '🪓', text: '砍树中' },
    crafting:   { emoji: '🔧', text: '合成中' },
    smelting:   { emoji: '🔥', text: '烧炼中' },
    building:   { emoji: '🏗️', text: '建造中' },
    fighting:   { emoji: '⚔️', text: '战斗中' },
    collecting: { emoji: '📦', text: '捡东西' },
    giving:     { emoji: '🎁', text: '给物品' },
    following:  { emoji: '👣', text: '跟随中' },
    wandering:  { emoji: '🗺️', text: '探索中' },
    eating:     { emoji: '🍖', text: '吃东西' },
    sleeping:   { emoji: '😴', text: '睡觉中' },
    error:      { emoji: '❌', text: '出错了' },
  };

  /** 设置当前状态 */
  set(state, detail = '') {
    if (this.current === state) return;
    this.current = state;
    this.startTime = Date.now();
    const s = StatusIndicator.STATES[state] || { emoji: '❓', text: state };
    console.log(`[Status] ${s.emoji} ${s.text}${detail ? ': ' + detail : ''}`);
    // 同时写入日志
    try { require('./logger').status(state, detail); } catch (e) { console.error('[StatusIndicator] Logger error:', e.message); }
  }

  /** 获取当前状态文本 */
  getText() {
    const s = StatusIndicator.STATES[this.current] || { emoji: '❓', text: this.current };
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    return `${s.emoji} ${s.text} (${elapsed}s)`;
  }

  /** 开始定时报告（只记日志，不 chat） */
  startReporting(intervalMs = 8000) {
    this._timer = setInterval(() => {
      if (this.current === 'idle') return;
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      if (elapsed > 5) {
        console.log(`[Status] ${this.getText()}`);
      }
    }, intervalMs);
  }

  stopReporting() {
    if (this._timer) clearInterval(this._timer);
  }
}

module.exports = { StatusIndicator };

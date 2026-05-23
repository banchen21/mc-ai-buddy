/**
 * 🧠 共享记忆 — 长期记忆 + 短期记忆
 *
 * 短期记忆：当前会话的对话历史、最近操作、环境快照（内存中，重启丢失）
 * 长期记忆：重要事件、地标、玩家关系、经验教训（持久化到 memory.json）
 */
const fs = require('fs');
const path = require('path');
const { Perception } = require('./perception');

const MEMORY_FILE = path.join(__dirname, '..', '..', 'memory.json');

class Memory {
  constructor() {
    // ===== 短期记忆（会话内） =====
    this.chatHistory = [];       // { role, content, time }
    this.lastAction = null;
    this.recentActions = [];     // 最近 10 个操作 { action, result, time }
    this.shortTermFacts = [];    // 临时事实，如 "正在挖矿"、"刚被骷髅攻击"

    // ===== 长期记忆（持久化） =====
    this.longTerm = this._load();
    this._saveTimer = null;

    this.perception = new Perception();
  }

  // ===== 长期记忆持久化 =====

  _load() {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
      }
    } catch (e) {
      console.log('[Memory] Failed to load memory.json, starting fresh');
    }
    return {
      landmarks: [],
      playerNotes: {},
      lessons: [],
      stats: { deaths: 0, crafts: 0, mines: 0, chops: 0, smelts: 0 },
      importantEvents: [],
    };
  }

  _save() {
    if (!this._saveTimer) {
      this._saveTimer = setTimeout(() => {
        try {
          fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.longTerm, null, 2));
        } catch (e) {
          console.error('[Memory] Failed to save:', e.message);
        }
        this._saveTimer = null;
      }, 5000);
    }
  }

  // ===== 短期记忆 =====

  addChat(role, content) {
    this.chatHistory.push({ role, content, time: Date.now() });
    if (this.chatHistory.length > 30) this.chatHistory = this.chatHistory.slice(-30);
  }

  addAction(action, result) {
    this.lastAction = action;
    this.recentActions.push({ action, result, time: Date.now() });
    if (this.recentActions.length > 10) this.recentActions = this.recentActions.slice(-10);

    const statMap = { mine: 'mines', chop: 'chops', craft: 'crafts', smelt: 'smelts' };
    const statKey = statMap[action];
    if (statKey && result !== false) {
      this.longTerm.stats[statKey] = (this.longTerm.stats[statKey] || 0) + 1;
      this._save();
    }
  }

  addFact(fact) {
    this.shortTermFacts.push({ fact, time: Date.now() });
    this.shortTermFacts = this.shortTermFacts.filter(f => Date.now() - f.time < 30000).slice(-5);
  }

  // ===== 长期记忆 =====

  addLandmark(name, pos) {
    const existing = this.longTerm.landmarks.find(l => l.name === name);
    if (existing) {
      existing.pos = pos;
      existing.time = Date.now();
    } else {
      this.longTerm.landmarks.push({ name, pos, time: Date.now() });
    }
    if (this.longTerm.landmarks.length > 20) {
      this.longTerm.landmarks = this.longTerm.landmarks.slice(-20);
    }
    this._save();
  }

  rememberPlayer(playerName, note) {
    if (!this.longTerm.playerNotes[playerName]) {
      this.longTerm.playerNotes[playerName] = [];
    }
    this.longTerm.playerNotes[playerName].push({ note, time: Date.now() });
    if (this.longTerm.playerNotes[playerName].length > 10) {
      this.longTerm.playerNotes[playerName] = this.longTerm.playerNotes[playerName].slice(-10);
    }
    this._save();
  }

  learnLesson(event, lesson) {
    if (this.longTerm.lessons.some(l => l.lesson === lesson)) return;
    this.longTerm.lessons.push({ event, lesson, time: Date.now() });
    if (this.longTerm.lessons.length > 20) {
      this.longTerm.lessons = this.longTerm.lessons.slice(-20);
    }
    this._save();
  }

  recordEvent(event) {
    this.longTerm.importantEvents.push({ event, time: Date.now() });
    if (this.longTerm.importantEvents.length > 30) {
      this.longTerm.importantEvents = this.longTerm.importantEvents.slice(-30);
    }
    this._save();
  }

  recordDeath(cause) {
    this.longTerm.stats.deaths = (this.longTerm.stats.deaths || 0) + 1;
    this.longTerm.importantEvents.push({
      event: `Died: ${cause || 'unknown'}`,
      time: Date.now(),
    });
    this._save();
  }

  // ===== 兼容旧接口 =====

  updateSnapshot(bot) { /* noop */ }
  scanEntities(bot, radius) { /* noop */ }
  scanBlocks(bot, radius) { /* noop */ }

  // ===== 获取 LLM 上下文 =====

  getContext(bot) {
    const p = this.perception.scan(bot, this);

    return {
      health: p.self.health,
      food: p.self.food,
      position: p.self.position,
      equipped: p.self.equipped.hand,
      inventory: p.self.inventory.summary,
      gaps: p.self.gaps,

      underAttack: p.self.underAttack,
      lastAttacker: p.self.lastAttacker,
      recentDamage: p.self.recentDamage,
      damageCount30s: p.self.damageCount30s,

      threats: p.near.threats,
      threatCount: p.near.threatCount,
      animals: p.near.animals,
      players: p.near.players,
      drops: p.near.drops,
      ores: p.near.ores,
      trees: p.near.trees,
      facilities: p.near.facilities,
      dangers: p.near.dangers,
      blockSummary: p.near.allBlocks,
      totalBlocks: p.near.totalBlocks,

      farEntities: p.far.entitySummary,
      biome: p.far.biome,
      hasInteresting: p.far.hasInteresting,

      timeOfDay: p.world.timeOfDay,
      dayPhase: p.world.dayPhase,
      isDaytime: p.world.isDaytime,
      isUnderground: p.world.isUnderground,
      canSleep: p.world.canSleep,

      lastAction: this.lastAction,
      recentChat: p.task.chatHistory.map(c => c.content).join(' | '),
      recentFacts: this.shortTermFacts.map(f => f.fact).join('; ') || null,

      longTermSummary: this._getLongTermSummary(),
    };
  }

  _getLongTermSummary() {
    const parts = [];
    if (this.longTerm.landmarks.length > 0) {
      parts.push('Landmarks: ' + this.longTerm.landmarks.slice(-5)
        .map(l => `${l.name}(${l.pos})`).join(', '));
    }
    if (this.longTerm.lessons.length > 0) {
      parts.push('Lessons: ' + this.longTerm.lessons.slice(-3)
        .map(l => l.lesson).join('; '));
    }
    const s = this.longTerm.stats;
    parts.push(`Stats: deaths:${s.deaths || 0} crafts:${s.crafts || 0} mines:${s.mines || 0} chops:${s.chops || 0}`);
    return parts.join(' | ') || null;
  }

  getFullReport(bot) {
    return this.perception.scan(bot, this);
  }
}

module.exports = { Memory };

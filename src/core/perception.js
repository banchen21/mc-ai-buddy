/**
 * 🧭 感知层 (Perception) — 快速扫描 + 紧凑输出
 * 用 bot.findBlocks 替代三重循环，一次实体扫描产出全部数据
 */
const ORE_PATTERN = /ore|diamond|emerald|gold|iron|coal|copper|lapis|redstone|netherite|quartz/;
const WOOD_PATTERN = /log|wood|planks|sapling|leaves/;
const VALUABLE = /chest|furnace|crafting_table|enchanting_table|anvil|bed|door|torch|lantern/;
const DANGER = /lava|fire|cactus|magma/;

const FOOD_ITEMS = [
  'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
  'cooked_cod', 'cooked_salmon', 'baked_potato', 'golden_apple', 'golden_carrot',
  'beef', 'porkchop', 'chicken', 'mutton', 'bread', 'apple', 'carrot', 'potato',
  'melon_slice', 'cod', 'salmon', 'cookie', 'pumpkin_pie', 'rabbit_stew', 'mushroom_stew',
];
const TOOL_ITEMS = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears', 'fishing_rod', 'flint_and_steel'];

class Perception {
  constructor() {
    this.damageLog = [];
    this.underAttack = false;
    this.lastAttacker = null;
  }

  recordDamage(source, damage) {
    const now = Date.now();
    this.damageLog.push({ time: now, source, damage });
    this.damageLog = this.damageLog.filter(d => now - d.time < 30000);
    this.underAttack = true;
    this.lastAttacker = source;
  }

  clearThreat() {
    this.underAttack = false;
    this.lastAttacker = null;
  }

  scan(bot, memory) {
    if (!bot?.entity) return this._empty();
    return {
      self: this._scanSelf(bot),
      env: this._scanEnv(bot),
      task: this._scanTask(bot, memory),
    };
  }

  // ===== 自身状态（紧凑格式） =====
  _scanSelf(bot) {
    const inv = bot.inventory?.items() || [];
    const hand = bot.inventory?.slots?.[bot.getEquipmentDestSlot?.('hand')]?.name || '空手';

    // 背包分类统计
    let foodN = 0, toolN = 0, oreN = 0, woodN = 0, blockN = 0;
    const tools = [], ores = [], foods = [];
    for (const i of inv) {
      if (FOOD_ITEMS.includes(i.name)) { foodN += i.count; foods.push(i.name); }
      else if (TOOL_ITEMS.some(t => i.name.includes(t))) { toolN++; tools.push(i.name); }
      else if (ORE_PATTERN.test(i.name) || i.name.includes('ingot') || i.name.includes('diamond')) { oreN += i.count; ores.push(i.name); }
      else if (WOOD_PATTERN.test(i.name)) { woodN += i.count; }
      else if (/stone|dirt|sand|cobblestone|gravel/.test(i.name)) { blockN += i.count; }
    }

    const invStr = [
      tools.length ? `工具:${tools.join(',')}` : '',
      ores.length ? `矿物:${ores.join(',')}` : '',
      foodN ? `食物:${foods[0]}等${foodN}个` : '',
      woodN ? `木材:${woodN}` : '',
      blockN ? `方块:${blockN}` : '',
    ].filter(Boolean).join(' | ') || '空';

    return {
      hp: Math.round(bot.health),
      food: Math.round(bot.food),
      pos: `${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)}`,
      holding: hand,
      inv: invStr,
      gaps: this._analyzeGaps(inv),
      underAttack: this.underAttack,
      attacker: this.lastAttacker?.name || null,
      hits30s: this.damageLog.length,
    };
  }

  _analyzeGaps(inv) {
    const gaps = [];
    const has = (p) => inv.some(i => p.test(i.name));
    if (!has(/pickaxe/)) gaps.push('pickaxe');
    if (!has(/axe/)) gaps.push('axe');
    if (!has(/sword/)) gaps.push('sword');
    if (!has(/shovel/)) gaps.push('shovel');
    if (!inv.some(i => FOOD_ITEMS.includes(i.name))) gaps.push('food');
    if (!has(/torch/)) gaps.push('torch');
    if (!has(/bed/)) gaps.push('bed');
    if (!has(/crafting_table/)) gaps.push('table');
    if (!has(/furnace/)) gaps.push('furnace');
    return gaps;
  }

  // ===== 环境感知（48格实体 + 64格方块） =====
  _scanEnv(bot) {
    // 实体：48 格（3 个区块），按距离分段
    const all = this._getEntities(bot, 48);
    const near = all.filter(e => e.dist <= 24);   // 近：1.5 区块
    const mid = all.filter(e => e.dist > 24 && e.dist <= 48); // 远：1.5-3 区块

    const nearStr = near.length > 0
      ? near.slice(0, 15).map(e => `${e.name}@${e.pos}(${e.dist}m)`).join(', ')
      : 'none';
    const farStr = mid.length > 0
      ? mid.slice(0, 8).map(e => `${e.name}(${e.dist}m)`).join(', ')
      : 'none';

    const players = all.filter(e => e.type === 'player');
    const playerStr = players.length > 0
      ? players.map(e => `${e.name}@${e.pos}(${e.dist}m)`).join(', ')
      : null;

    const drops = near.filter(e => e.type === 'object');
    const dropStr = drops.length > 0 ? drops.map(e => e.name).join(',') : null;

    // 方块：64 格（4 个区块），用 findBlocks
    const blockStr = this._scanBlocks(bot);

    const timeOfDay = Math.round(bot.time?.timeOfDay || 0);
    const dayPhase = timeOfDay < 2000 ? '清晨' : timeOfDay < 6000 ? '上午' :
      timeOfDay < 10000 ? '正午' : timeOfDay < 13000 ? '下午' :
      timeOfDay < 14000 ? '黄昏' : timeOfDay < 18000 ? '夜晚' : '深夜';

    let biome = '?';
    try { biome = bot.blockAt(bot.entity.position.floored())?.biome?.name?.replace(/_/g, ' ') || '?'; } catch {}

    return {
      entities: nearStr,
      farEntities: farStr,
      player: playerStr,
      drops: dropStr,
      blocks: blockStr,
      time: dayPhase,
      underground: bot.entity.position.y < 55,
      biome,
      canSleep: timeOfDay > 12540 && timeOfDay < 23460,
      raining: bot.isRaining || false,
    };
  }

  /** 快速方块扫描：64 格范围，只找关键类型 */
  _scanBlocks(bot) {
    const parts = [];
    try {
      const mcData = require('minecraft-data')(bot.version);
      const R = 64; // 4 个区块

      // 原木
      const logIds = Object.entries(mcData.blocksByName)
        .filter(([n]) => n.includes('log') && !n.includes('stripped'))
        .map(([, b]) => b.id);
      if (logIds.length) {
        const logs = bot.findBlocks({ matching: logIds, maxDistance: R, count: 50 });
        if (logs.length) parts.push(`log:${logs.length}`);
      }

      // 矿石
      const oreIds = Object.entries(mcData.blocksByName)
        .filter(([n]) => ORE_PATTERN.test(n)).map(([, b]) => b.id);
      if (oreIds.length) {
        const ores = bot.findBlocks({ matching: oreIds, maxDistance: R, count: 50 });
        if (ores.length) {
          const oc = {};
          for (const op of ores.slice(0, 30)) { const b = bot.blockAt(op); if (b) oc[b.name] = (oc[b.name] || 0) + 1; }
          const os = Object.entries(oc).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n}×${c}`).join(',');
          if (os) parts.push(`ores:${os}`);
        }
      }

      // 功能方块
      const valIds = Object.entries(mcData.blocksByName)
        .filter(([n]) => VALUABLE.test(n)).map(([, b]) => b.id);
      if (valIds.length) {
        const val = bot.findBlocks({ matching: valIds, maxDistance: R, count: 20 });
        if (val.length) {
          const vc = {};
          for (const vp of val.slice(0, 15)) { const b = bot.blockAt(vp); if (b) vc[b.name] = (vc[b.name] || 0) + 1; }
          parts.push('facilities:' + Object.entries(vc).map(([n, c]) => `${n}×${c}`).join(','));
        }
      }

      // 危险
      const dangerIds = Object.entries(mcData.blocksByName)
        .filter(([n]) => DANGER.test(n)).map(([, b]) => b.id);
      if (dangerIds.length) {
        const dangers = bot.findBlocks({ matching: dangerIds, maxDistance: R, count: 10 });
        if (dangers.length) parts.push(`danger:${dangers.length}`);
      }
    } catch {}
    return parts.join(' | ') || 'empty';
  }

  // ===== 任务感知 =====
  _scanTask(bot, memory) {
    return {
      lastAction: memory?.lastAction || null,
      recentChat: (memory?.chatHistory || []).slice(-3).map(c => `${c.role}:${c.content}`).join(' | ') || null,
    };
  }

  // ===== 工具方法 =====

  _getEntities(bot, radius) {
    const result = [];
    if (!bot?.entity) return result;
    for (const [, e] of Object.entries(bot.entities)) {
      if (e === bot.entity) continue;
      const dist = bot.entity.position.distanceTo(e.position);
      if (dist <= radius) {
        const p = e.position;
        result.push({
          name: e.name || e.username || 'unknown',
          type: e.type || (e.username ? 'player' : 'mob'),
          dist: Math.round(dist),
          pos: `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`,
        });
        if (result.length >= 50) break;
      }
    }
    result.sort((a, b) => a.dist - b.dist);
    return result;
  }

  _empty() {
    return {
      self: { hp: 0, food: 0, pos: '?', holding: '?', inv: '?', gaps: [], underAttack: false, attacker: null, hits30s: 0 },
      env: { entities: '?', farEntities: '?', player: null, drops: null, blocks: '?', time: '?', underground: false, biome: '?', canSleep: false, raining: false },
      task: { lastAction: null, recentChat: null },
    };
  }
}

module.exports = { Perception };

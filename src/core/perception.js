/**
 * 🧭 感知层 (Perception)
 * 将 bot 的原始数据转化为 LLM 友好的结构化感知报告
 *
 * 感知维度：
 *   1. 自身状态 (Self)      — 血量、饱食度、装备、背包分类
 *   2. 近区感知 (Near)      — 16格内：实体分类、掉落物、所有方块统计
 *   3. 远区感知 (Far)       — 32格内：生物群系、远处实体摘要
 *   4. 环境感知 (World)     — 时间/天气、光照、所处维度
 *   5. 任务感知 (Task)      — 当前目标、上次结果、背包缺口
 */

const HOSTILE = /zombie|skeleton|creeper|spider|witch|husk|drowned|pillager|vindicator|evoker|enderman|hoglin|piglin_brute|blaze|wither_skeleton|cave_spider|slime|magma_cube|phantom/;
const PASSIVE = /cow|pig|sheep|chicken|rabbit|horse|donkey|mule|llama|cat|wolf|fox|bee|turtle|dolphin|squid|salmon|cod|pufferfish|tropical_fish|bat|mooshroom|ocelot|parrot|polar_bear|panda|goat|axolotl|glow_squid|frog|tadpole|camel|sniffer|armadillo/;
const VILLAGER = /villager|wandering_trader|iron_golem|snow_golem/;

const ORE_PATTERN = /ore|diamond|emerald|gold|iron|coal|copper|lapis|redstone|netherite|quartz/;
const WOOD_PATTERN = /log|wood|planks|sapling|leaves/;
const VALUABLE = /chest|furnace|crafting_table|enchanting_table|anvil|bed|door|torch|lantern/;
const DANGER = /lava|fire|cactus|magma|water/;

const FOOD_ITEMS = [
  'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
  'cooked_cod', 'cooked_salmon', 'baked_potato', 'golden_apple', 'golden_carrot',
  'beef', 'porkchop', 'chicken', 'mutton',
  'bread', 'apple', 'carrot', 'potato', 'melon_slice',
  'cod', 'salmon', 'cookie', 'pumpkin_pie', 'rabbit_stew', 'mushroom_stew',
];

const TOOL_ITEMS = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears', 'fishing_rod', 'flint_and_steel'];

class Perception {
  constructor() {
    // 伤害事件追踪（最近 30 秒内的伤害记录）
    this.damageLog = [];
    this.lastDamageTime = 0;
    this.underAttack = false;
    this.lastAttacker = null;
  }

  /**
   * 记录一次伤害事件（由外部 index.js 调用）
   * @param {object} source - 伤害来源实体
   * @param {number} damage - 伤害值
   */
  recordDamage(source, damage) {
    const now = Date.now();
    this.damageLog.push({ time: now, source, damage });
    // 只保留最近 30 秒的记录
    this.damageLog = this.damageLog.filter(d => now - d.time < 30000);
    this.lastDamageTime = now;
    this.underAttack = true;
    this.lastAttacker = source;
  }

  /**
   * 清除"正在受攻击"标记（由 combat 插件在解决威胁后调用）
   */
  clearThreat() {
    this.underAttack = false;
    this.lastAttacker = null;
  }

  /**
   * 执行完整感知扫描
   */
  scan(bot, memory) {
    if (!bot?.entity) return this._empty();

    const report = {
      self: this._scanSelf(bot),
      near: this._scanNear(bot),
      far: this._scanFar(bot),
      world: this._scanWorld(bot),
      task: this._scanTask(memory),
    };

    return report;
  }

  // ===== 自身状态 =====
  _scanSelf(bot) {
    const inv = bot.inventory?.items() || [];
    const equipped = {
      hand: bot.inventory?.slots?.[bot.getEquipmentDestSlot?.('hand')]?.name || '空手',
      head: bot.inventory?.slots?.[bot.getEquipmentDestSlot?.('head')]?.name || '无',
      chest: bot.inventory?.slots?.[bot.getEquipmentDestSlot?.('torso')]?.name || '无',
      legs: bot.inventory?.slots?.[bot.getEquipmentDestSlot?.('legs')]?.name || '无',
      feet: bot.inventory?.slots?.[bot.getEquipmentDestSlot?.('feet')]?.name || '无',
    };

    // 背包分类
    const food = inv.filter(i => FOOD_ITEMS.includes(i.name));
    const tools = inv.filter(i => TOOL_ITEMS.some(t => i.name.includes(t)));
    const ores = inv.filter(i => ORE_PATTERN.test(i.name) || i.name.includes('ingot') || i.name.includes('diamond') || i.name.includes('emerald'));
    const wood = inv.filter(i => WOOD_PATTERN.test(i.name));
    const blocks = inv.filter(i => i.name.includes('stone') || i.name.includes('dirt') || i.name.includes('sand') || i.name.includes('cobblestone'));
    const other = inv.filter(i =>
      !FOOD_ITEMS.includes(i.name) &&
      !TOOL_ITEMS.some(t => i.name.includes(t)) &&
      !ORE_PATTERN.test(i.name) && !i.name.includes('ingot') && !i.name.includes('diamond') &&
      !WOOD_PATTERN.test(i.name) &&
      !i.name.includes('stone') && !i.name.includes('dirt')
    );

    return {
      health: Math.round(bot.health),
      food: Math.round(bot.food),
      saturation: Math.round(bot.foodSaturation || 0),
      position: `${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)}`,
      equipped,
      // 伤害/威胁感知
      underAttack: this.underAttack,
      lastAttacker: this.lastAttacker
        ? `${this.lastAttacker.name || this.lastAttacker.username || 'unknown'}`
        : null,
      recentDamage: this.damageLog.length > 0
        ? this.damageLog.slice(-5).map(d =>
            `${d.source?.name || d.source?.username || '?'}:${d.damage}`
          ).join(', ')
        : null,
      damageCount30s: this.damageLog.length,
      inventory: {
        total: inv.length,
        summary: [
          food.length ? `🍖食物:${food.map(i => i.name + '×' + i.count).join(',')}` : '',
          tools.length ? `🔧工具:${tools.map(i => i.name).join(',')}` : '',
          ores.length ? `💎矿物:${ores.map(i => i.name + '×' + i.count).join(',')}` : '',
          wood.length ? `🪵木材:${wood.map(i => i.name + '×' + i.count).join(',')}` : '',
          blocks.length ? `🧱方块:${blocks.map(i => i.name + '×' + i.count).join(',')}` : '',
          other.length ? `📦其他:${other.map(i => i.name + '×' + i.count).join(',')}` : '',
        ].filter(Boolean).join(' | ') || '空背包',
      },
      // 背包缺口分析
      gaps: this._analyzeGaps(inv, equipped),
    };
  }

  /** 分析背包缺口 */
  _analyzeGaps(inv, equipped) {
    const gaps = [];
    const hasItem = (pattern) => inv.some(i => pattern.test(i.name));

    if (!hasItem(/pickaxe/)) gaps.push('缺镐子');
    if (!hasItem(/axe/)) gaps.push('缺斧头');
    if (!hasItem(/sword/)) gaps.push('缺武器');
    if (!hasItem(/shovel/)) gaps.push('缺铲子');
    if (!inv.some(i => FOOD_ITEMS.includes(i.name))) gaps.push('缺食物');
    if (!hasItem(/torch/)) gaps.push('缺火把');
    if (!hasItem(/bed/)) gaps.push('缺床');
    if (!hasItem(/crafting_table/)) gaps.push('缺工作台');
    if (!hasItem(/furnace/)) gaps.push('缺熔炉');

    return gaps;
  }

  // ===== 近区感知 (16格实体 + 8格方块统计) =====
  _scanNear(bot) {
    const entities = this._getEntities(bot, 16);
    const blocks = this._getBlocks(bot, 8);   // 缩小到 8 格，避免 OOM

    // 实体分类
    const hostiles = entities.filter(e => HOSTILE.test(e.name));
    const passives = entities.filter(e => PASSIVE.test(e.name));
    const villagers = entities.filter(e => VILLAGER.test(e.name));
    const players = entities.filter(e => e.type === 'player');
    const drops = entities.filter(e => e.type === 'object');

    // 所有方块统计（只展示前 10 种，减少 prompt 长度）
    const counts = blocks._counts || {};
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top10 = sorted.slice(0, 10).map(([name, cnt]) => `${name}×${cnt}`).join(', ');
    const more = sorted.length > 10 ? ` +${sorted.length - 10}种` : '';
    const allBlocks = top10 + more;

    // 高亮分类（从 counts 中提取）
    const oreNames = Object.keys(counts).filter(n => ORE_PATTERN.test(n));
    const woodNames = Object.keys(counts).filter(n => WOOD_PATTERN.test(n));
    const valuableNames = Object.keys(counts).filter(n => VALUABLE.test(n));
    const dangerNames = Object.keys(counts).filter(n => DANGER.test(n));
    const logCount = Object.entries(counts)
      .filter(([n]) => n.includes('log'))
      .reduce((s, [, c]) => s + c, 0);

    return {
      threats: hostiles.length > 0
        ? hostiles.map(e => `⚠️${e.name}(${e.dist}m)`).join(', ')
        : '安全',
      threatCount: hostiles.length,
      animals: passives.length > 0
        ? passives.map(e => `${e.name}(${e.dist}m)`).join(', ')
        : '无',
      players: players.length > 0
        ? players.map(e => `${e.name}(${e.dist}m)`).join(', ')
        : '无',
      drops: drops.length > 0
        ? `${drops.length}个掉落物: ${drops.map(e => e.name).join(',')}`
        : '无',

      // 所有方块（完整统计）
      allBlocks,
      totalBlocks: blocks._total || 0,

      // 高亮分类
      ores: oreNames.length > 0
        ? oreNames.map(n => `${n}×${counts[n]}`).slice(0, 8).join(', ')
        : '无',
      trees: logCount > 0 ? `${logCount}木头` : '无',
      facilities: valuableNames.length > 0
        ? valuableNames.map(n => `${n}×${counts[n]}`).join(', ')
        : '无',
      dangers: dangerNames.length > 0
        ? dangerNames.map(n => `${n}×${counts[n]}`).join(', ')
        : '无',
    };
  }

  // ===== 远区感知 (20格) =====
  _scanFar(bot) {
    const entities = this._getEntities(bot, 20);
    const farEntities = entities.filter(e => e.dist > 16);

    // 统计
    const counts = {};
    farEntities.forEach(e => {
      const key = e.name || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    });

    // 生物群系检测（通过方块推断）
    const pos = bot.entity.position.floored();
    let biome = '未知';
    try {
      const biomeName = bot.blockAt(pos)?.biome?.name || '';
      if (biomeName) biome = biomeName.replace(/_/g, ' ');
    } catch (e) {
      // biome 读取失败，非关键
    }

    return {
      entitySummary: Object.entries(counts).length > 0
        ? Object.entries(counts).map(([k, v]) => `${k}×${v}`).slice(0, 8).join(', ')
        : '空旷',
      totalEntities: farEntities.length,
      biome,
      // 是否有值得探索的方向
      hasInteresting: farEntities.some(e =>
        PASSIVE.test(e.name) || VILLAGER.test(e.name) || e.type === 'object'
      ),
    };
  }

  // ===== 世界环境 =====
  _scanWorld(bot) {
    const timeOfDay = Math.round(bot.time?.timeOfDay || 0);
    const isDaytime = timeOfDay < 13000 && timeOfDay > 0;
    const dayPhase = timeOfDay < 2000 ? '清晨' :
      timeOfDay < 6000 ? '上午' :
      timeOfDay < 10000 ? '正午' :
      timeOfDay < 13000 ? '下午' :
      timeOfDay < 14000 ? '黄昏' :
      timeOfDay < 18000 ? '夜晚' : '深夜';

    // 光照检测
    let lightLevel = '未知';
    try {
      const pos = bot.entity.position.floored();
      const block = bot.blockAt(pos);
      lightLevel = block?.light || block?.skyLight || '?';
    } catch (e) {
      // 光照读取失败，非关键
    }

    // 是否在地下
    const isUnderground = bot.entity.position.y < 55;

    return {
      timeOfDay,
      dayPhase,
      isDaytime,
      isUnderground,
      lightLevel,
      canSleep: timeOfDay > 12540 && timeOfDay < 23460,
      isRaining: bot.isRaining || false,
      isThundering: bot.isThundering || false,
    };
  }

  // ===== 任务感知 =====
  _scanTask(memory) {
    return {
      lastAction: memory?.lastAction || '无',
      chatHistory: (memory?.chatHistory || []).slice(-5).map(c =>
        `${c.role}: ${c.content}`
      ),
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
        result.push({
          name: e.name || e.username || 'unknown',
          type: e.type || (e.username ? 'player' : 'mob'),
          dist: Math.round(dist),
        });
        if (result.length >= 50) break; // 上限 50 个
      }
    }
    result.sort((a, b) => a.dist - b.dist);
    return result;
  }

  _getBlocks(bot, radius) {
    const counts = {};
    if (!bot?.entity) return { _counts: counts, _total: 0 };

    const pos = bot.entity.position.floored();
    // 只扫描关键高度层（脚下-1 到 头顶+2），从 11 层缩减到 5 层，减少 55% 扫描量
    const minY = -1, maxY = 3;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = minY; dy <= maxY; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const b = bot.blockAt(pos.offset(dx, dy, dz));
          if (!b || b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air') continue;
          counts[b.name] = (counts[b.name] || 0) + 1;
        }
      }
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { _counts: counts, _total: total };
  }

  _empty() {
    return {
      self: { health: 0, food: 0, position: '?', inventory: { summary: '?' }, gaps: [] },
      near: { threats: '?', animals: '?', players: '?', drops: '?', ores: '?', trees: '?', facilities: '?', dangers: '?', raw: { entities: [], blocks: [] } },
      far: { entitySummary: '?', totalEntities: 0, biome: '?', hasInteresting: false },
      world: { timeOfDay: 0, dayPhase: '?', isDaytime: true, isUnderground: false, lightLevel: '?', canSleep: false, isRaining: false },
      task: { lastAction: '?', chatHistory: [] },
    };
  }
}

module.exports = { Perception };

/**
 * ⛏️ gather 插件 — 采集：挖矿、砍树、捡物品
 * 遵守 Minecraft 工具等级规则
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const logger = require('../core/logger');

let bot, deps;

// Minecraft 工具等级：数字越大越好
const TOOL_TIERS = { netherite: 5, diamond: 4, iron: 3, stone: 2, wooden: 1, gold: 0 };

// 每种方块需要的最低工具等级
const BLOCK_REQUIREMENTS = {
  // 木镐 (tier >= 1)
  stone: 1, cobblestone: 1, coal_ore: 1, deepslate_coal_ore: 1,
  // 石镐 (tier >= 2)
  iron_ore: 2, deepslate_iron_ore: 2, lapis_ore: 2, deepslate_lapis_ore: 2,
  copper_ore: 2, deepslate_copper_ore: 2,
  // 铁镐 (tier >= 3)
  diamond_ore: 3, deepslate_diamond_ore: 3, gold_ore: 3, deepslate_gold_ore: 3,
  redstone_ore: 3, deepslate_redstone_ore: 3, emerald_ore: 3, deepslate_emerald_ore: 3,
  // 黑曜石需要钻石镐 (tier >= 4)
  obsidian: 4, crying_obsidian: 4,
  // 远古残骸需要钻石镐 (tier >= 4)
  ancient_debris: 4,
};

function makeMovements() {
  const mcData = require('minecraft-data')(bot.version);
  const moves = new Movements(bot, mcData);
  moves.canDig = true;
  moves.allowParkour = true;
  moves.canSwim = true;
  return moves;
}

/** 获取物品的工具等级 */
function getToolTier(itemName) {
  for (const [tierName, tier] of Object.entries(TOOL_TIERS)) {
    if (itemName.includes(tierName)) return tier;
  }
  return 0;
}

/** 获取挖掘方块所需的最低工具等级 */
function getRequiredTier(blockName) {
  // 精确匹配
  if (BLOCK_REQUIREMENTS[blockName]) return BLOCK_REQUIREMENTS[blockName];
  // 模糊匹配
  for (const [key, tier] of Object.entries(BLOCK_REQUIREMENTS)) {
    if (blockName.includes(key)) return tier;
  }
  // 木头/土/沙等不需要工具
  if (/log|wood|plank|dirt|sand|gravel|wool|leaves|sapling/.test(blockName)) return 0;
  // 默认需要木镐
  return 1;
}

/** 装备最佳工具，并检查是否足够挖掘目标方块 */
function equipBestTool(bot, blockName) {
  const isWood = /log|wood|plank/.test(blockName);
  const toolType = isWood ? 'axe' : 'pickaxe';
  const requiredTier = getRequiredTier(blockName);

  const tools = bot.inventory.items()
    .filter(i => i.name.includes(toolType))
    .sort((a, b) => getToolTier(b.name) - getToolTier(a.name));

  if (tools[0]) {
    const bestTier = getToolTier(tools[0].name);
    bot.equip(tools[0], 'hand').catch((e) => logger.error('gather/equip', e));

    if (requiredTier > 0 && bestTier < requiredTier) {
      console.log(`[Gather] ⚠️ ${tools[0].name} (tier ${bestTier}) too weak for ${blockName} (needs tier ${requiredTier})`);
      return false; // 工具不够好
    }
    return true;
  }

  // 没有工具
  if (requiredTier > 0) {
    console.log(`[Gather] ⚠️ No ${toolType} for ${blockName} (needs tier ${requiredTier})`);
    return false;
  }
  return true; // 不需要工具（如挖土）
}

module.exports = {
  name: 'gather',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() { logger.info('gather', 'ready'); },
  stop() {},

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'mine',
        description: '挖掘指定类型的方块（矿石/石头/土等）',
        parameters: {
          type: 'object',
          properties: {
            block: { type: 'string', description: '方块英文名，如 stone, iron_ore, coal_ore, diamond_ore, dirt, sand, gravel' },
            count: { type: 'number', description: '挖掘数量，默认8' },
          },
          required: ['block', 'count'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'chop',
        description: '砍树收集原木',
        parameters: {
          type: 'object',
          properties: {
            count: { type: 'number', description: '砍树数量，默认5' },
          },
          required: ['count'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'collect',
        description: '捡起附近地上的掉落物',
        parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
      },
    },
  ],

  actions: {
    /** 挖指定方块 — 用 bot.dig() 直接挖掘，挖完自动捡掉落物 */
    async mine(params) {
      const blockName = params.block || params.block_type || 'stone';
      const count = params.count || 8;
      const mcData = require('minecraft-data')(bot.version);

      // 匹配方块 ID
      const search = blockName.toLowerCase().replace(/\s+/g, '_');
      const blockIds = Object.entries(mcData.blocksByName)
        .filter(([name]) => name.includes(search))
        .map(([, b]) => b.id);

      if (!blockIds.length) {
        console.log(`[Gather] Unknown block: ${blockName}`);
        return 0;
      }

      // 检查工具等级
      const canMine = equipBestTool(bot, blockName);
      if (!canMine) {
        const required = getRequiredTier(blockName);
        const tierNames = ['hand', 'wood', 'stone', 'iron', 'diamond', 'netherite'];
        console.log(`[Gather] Tool too weak for ${blockName}, need tier ${required}`);
        return `need_tier:${required}(${tierNames[required] || required})`;
      }

      let mined = 0;
      const timeout = Date.now() + 60000;
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 5;

      for (let i = 0; i < count * 3 && mined < count; i++) {
        if (Date.now() > timeout) break;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log(`[Gather] Too many errors (${consecutiveErrors}), stopping`);
          break;
        }

        const block = bot.findBlock({
          matching: blockIds,
          maxDistance: 32,
          count: 1,
        });

        if (!block) break;

        try {
          // 走到方块旁边
          const goal = new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2);
          bot.pathfinder.setMovements(makeMovements());
          await bot.pathfinder.goto(goal);
          // 直接挖掘
          await bot.dig(block);
          mined++;
          consecutiveErrors = 0;  // 成功 → 重置
          // 挖完后等一小会，捡起掉落物
          await new Promise(r => setTimeout(r, 500));
          await this._collectNearby();
        } catch (err) {
          consecutiveErrors++;
          // 只在第一次错误时记录日志，避免刷屏
          if (consecutiveErrors === 1) {
            logger.error('gather/mine', err);
          }
          // 短暂等待后重试
          await new Promise(r => setTimeout(r, 300));
        }
      }

      bot.pathfinder.setGoal(null);
      logger.action('gather', 'mine', `${mined}x ${blockName}`);
      if (mined > 0) console.log(`[Gather] Mined ${mined}x ${blockName}`);
      return mined;
    },

    /** 捡起脚下附近的掉落物 */
    async _collectNearby() {
      const drops = Object.values(bot.entities).filter(
        e => (e.name === 'item' || e.displayName === 'Item' || e.type === 'object') &&
          bot.entity.position.distanceTo(e.position) < 3
      );
      for (const drop of drops) {
        try {
          // 走过去捡
          const goal = new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0.5);
          bot.pathfinder.setMovements(makeMovements());
          await bot.pathfinder.goto(goal);
        } catch {}
      }
    },

    /** 砍树 */
    async chop(params) {
      return this.mine({ ...params, block: 'log', count: params?.count || 5 });
    },

    /** 捡掉落物 */
    async collect() {
      bot.pathfinder.setMovements(makeMovements());

      const items = Object.values(bot.entities).filter(
        e => e.name === 'item' || e.displayName === 'Item' || e.type === 'object'
      );

      if (!items.length) {
        console.log('[Gather] Nothing to collect');
        return 0;
      }

      let collected = 0;
      for (const item of items.slice(0, 10)) {
        if (bot.entity.position.distanceTo(item.position) > 32) continue;
        try {
          bot.pathfinder.setGoal(new goals.GoalNear(
            item.position.x, item.position.y, item.position.z, 1
          ));
          await new Promise(r => setTimeout(r, 2000));
          collected++;
        } catch {}
      }

      bot.pathfinder.setGoal(null);
      logger.action('gather', 'collect', collected);
      return collected;
    },
  },
};

/**
 * 🖐️ use 插件 — 使用功能方块：熔炉、箱子、附魔台、铁砧等
 * 走到方块旁边 → 打开 GUI → 执行操作 → 关闭
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const logger = require('../core/logger');

let bot, deps;

// Minecraft 燃料燃烧时间（ticks），来源：Minecraft Wiki
const FUEL_TIMES = {
  oak_planks: 300, birch_planks: 300, spruce_planks: 300, jungle_planks: 300,
  acacia_planks: 300, dark_oak_planks: 300, mangrove_planks: 300, cherry_planks: 300,
  bamboo_planks: 300, crimson_planks: 300, warped_planks: 300,
  stick: 100, bamboo: 50,
  oak_sapling: 100, birch_sapling: 100,
  oak_log: 800, birch_log: 800, spruce_log: 800, jungle_log: 800,
  acacia_log: 800, dark_oak_log: 800, mangrove_log: 800, cherry_log: 800,
  stripped_oak_log: 800, stripped_birch_log: 800,
  coal: 1600, charcoal: 1600,
  blaze_rod: 2000,
  coal_block: 2400,
  lava_bucket: 20000,
};

// 烧炼时间：Minecraft 中所有物品烧炼都是 200 ticks = 10秒
const COOK_TIME = 200;

/** 获取物品的燃料时间（ticks），支持模糊匹配 */
function getFuelTime(itemName) {
  if (FUEL_TIMES[itemName]) return FUEL_TIMES[itemName];
  for (const [key, time] of Object.entries(FUEL_TIMES)) {
    if (itemName.includes(key) || key.includes(itemName)) return time;
  }
  if (itemName.includes('planks')) return 300;
  if (itemName.includes('slab')) return 150;
  if (itemName.includes('log') || itemName.includes('wood')) return 800;
  return 0;
}

function makeMovements() {
  const mcData = require('minecraft-data')(bot.version);
  const moves = new Movements(bot, mcData);
  moves.canDig = false;
  moves.canSwim = true;
  return moves;
}

/** 走到方块旁边 */
async function walkToBlock(block) {
  if (!block) return false;
  const dist = bot.entity.position.distanceTo(block.position);
  if (dist <= 3) return true;

  bot.pathfinder.setMovements(makeMovements());
  const goal = new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2);
  try {
    await bot.pathfinder.goto(goal);
    bot.pathfinder.setGoal(null);
    return true;
  } catch {
    bot.pathfinder.setGoal(null);
    return false;
  }
}

/** 找最近的指定方块 */
function findBlock(blockName, maxDist = 16) {
  const mcData = require('minecraft-data')(bot.version);
  const id = mcData.blocksByName[blockName]?.id;
  if (!id) return null;
  return bot.findBlock({ matching: id, maxDistance: maxDist });
}

module.exports = {
  name: 'use',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() { logger.info('use', 'ready'); },
  stop() {},

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'smelt',
        description: '用熔炉烧炼物品（如铁矿石→铁锭）。会自动走到熔炉旁操作',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: '要烧炼的物品英文名，如 iron_ore, raw_iron, raw_copper, sand, cobblestone' },
            fuel: { type: 'string', description: '燃料英文名，如 coal, oak_planks, oak_log。不填自动选' },
            count: { type: 'number', description: '烧炼数量，默认全部' },
          },
          required: ['input', 'fuel', 'count'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'open_chest',
        description: '打开附近的箱子，查看/存取物品',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'deposit(存入) 或 withdraw(取出) 或 view(查看)' },
            item: { type: 'string', description: '物品英文名，view 时可不填' },
            count: { type: 'number', description: '数量，不填则全部' },
          },
          required: ['action', 'item', 'count'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'use_block',
        description: '使用功能方块（附魔台、铁砧、砂轮、制图台等）',
        parameters: {
          type: 'object',
          properties: {
            block: { type: 'string', description: '方块英文名，如 enchanting_table, anvil, grindstone, cartography_table, smithing_table, loom, stonecutter' },
          },
          required: ['block'],
          additionalProperties: false,
        },
      },
    },
  ],

  actions: {
    /** 烧炼物品 — 轮询等待烧炼完成 */
    async smelt(params) {
      const inputName = (params.input || '').toLowerCase().replace(/\s+/g, '_');
      const fuelName = (params.fuel || '').toLowerCase().replace(/\s+/g, '_');
      const count = params.count || null;
      const mcData = require('minecraft-data')(bot.version);

      // 找熔炉
      const furnace = findBlock('furnace');
      if (!furnace) {
        console.log('[Use] No furnace nearby');
        return false;
      }

      // 找输入物品
      const inputItem = bot.inventory.items().find(i =>
        i.name === inputName || i.name.includes(inputName)
      );
      if (!inputItem) {
        console.log(`[Use] No ${inputName} in inventory`);
        return false;
      }

      // 找燃料
      let fuelItem = null;
      if (fuelName) {
        fuelItem = bot.inventory.items().find(i =>
          i.name === fuelName || i.name.includes(fuelName)
        );
      } else {
        fuelItem = bot.inventory.items().find(i => i.name === 'coal' || i.name === 'charcoal')
          || bot.inventory.items().find(i => i.name.includes('planks'))
          || bot.inventory.items().find(i => i.name.includes('log'));
      }

      if (!fuelItem) {
        console.log('[Use] No fuel');
        return false;
      }

      // 走到熔炉旁
      if (!(await walkToBlock(furnace))) {
        console.log('[Use] Cannot reach furnace');
        return false;
      }

      const smeltCount = count ? Math.min(count, inputItem.count) : inputItem.count;

      // 使用真实 Minecraft 数据
      const fuelTime = getFuelTime(fuelItem.name);
      if (fuelTime === 0) {
        console.log(`[Use] ${fuelItem.name} is not fuel`);
        return false;
      }

      // 计算：每个燃料能烧几个物品
      const itemsPerFuel = Math.floor(fuelTime / COOK_TIME);
      const fuelNeeded = Math.ceil(smeltCount / itemsPerFuel);
      const actualFuel = Math.min(fuelNeeded, fuelItem.count);

      console.log(`[Smelt] ${smeltCount}x ${inputItem.name}: fuel=${fuelItem.name}(${fuelTime}ticks/${fuelTime/20}s), cookTime=${COOK_TIME}ticks, 1fuel=${itemsPerFuel}items, need ${fuelNeeded} fuel`);

      try {
        const f = await bot.openFurnace(furnace);

        // 放燃料（一次放够）
        await f.putFuel(fuelItem.type, null, actualFuel);
        // 放输入（一次放够，熔炉会自动逐个烧）
        await f.putInput(inputItem.type, null, smeltCount);

        console.log(`[Smelt] Starting ${smeltCount}x ${inputItem.name}`);

        // 轮询等待烧炼完成
        const maxWaitMs = smeltCount * COOK_TIME * 60; // 多给 20% 余量
        const pollInterval = 1500;
        const startTime = Date.now();
        let smelted = 0;

        while (Date.now() - startTime < maxWaitMs) {
          await new Promise(r => setTimeout(r, pollInterval));

          // 取出已完成的成品
          try {
            const outputItem = f.outputItem();
            if (outputItem) {
              await f.takeOutput();
              smelted += outputItem.count;
              console.log(`[Smelt] Progress: ${smelted}/${smeltCount}`);
            }
          } catch {}

          if (smelted >= smeltCount) break;

          // 检查熔炉是否熄火（输入槽为空 = 烧完了或没燃料了）
          try {
            const inputSlot = f.inputItem();
            if (!inputSlot && smelted < smeltCount) {
              // 输入空了但还没烧完 → 可能缺燃料
              const remaining = smeltCount - smelted;
              const moreFuel = Math.ceil(remaining / itemsPerFuel);
              const fuelLeft = bot.inventory.items().find(i => i.name === fuelItem.name);
              if (fuelLeft && moreFuel > 0) {
                console.log(`[Smelt] Adding ${moreFuel} more fuel`);
                await f.putFuel(fuelItem.type, null, Math.min(moreFuel, fuelLeft.count));
              } else {
                break;
              }
            }
          } catch {}
        }

        f.close();

        if (smelted > 0) {
          console.log(`[Smelt] Done: ${smelted}x ${inputItem.name}`);
          logger.action('use', 'smelt', `${smelted}x ${inputItem.name}`);
          return smelted;
        } else {
          console.log('[Smelt] Failed, possibly no fuel');
          return false;
        }
      } catch (err) {
        logger.error('use/smelt', err);
        return false;
      }
    },

    /** 打开箱子 */
    async open_chest(params) {
      const action = params.action || 'view';
      const itemName = (params.item || '').toLowerCase().replace(/\s+/g, '_');
      const count = params.count || null;

      const chest = findBlock('chest') || findBlock('trapped_chest') || findBlock('barrel');
      if (!chest) {
        console.log('[Use] No chest nearby');
        return 'no_chest';
      }

      if (!(await walkToBlock(chest))) {
        console.log('[Use] Cannot reach chest');
        return 'unreachable';
      }

      try {
        const c = await bot.openContainer(chest);

        if (action === 'view') {
          const items = c.containerItems().map(i => `${i.name}×${i.count}`).join(', ');
          c.close();
          return items || 'empty';
        }

        if (action === 'deposit') {
          const item = bot.inventory.items().find(i =>
            i.name === itemName || i.name.includes(itemName)
          );
          if (!item) { c.close(); return 'no_item'; }
          const n = count ? Math.min(count, item.count) : item.count;
          await c.deposit(item.type, null, n);
          c.close();
          return `deposited ${n}x ${item.name}`;
        }

        if (action === 'withdraw') {
          const item = c.containerItems().find(i =>
            i.name === itemName || i.name.includes(itemName)
          );
          if (!item) { c.close(); return 'not_found'; }
          const n = count ? Math.min(count, item.count) : item.count;
          await c.withdraw(item.type, null, n);
          c.close();
          return `withdrew ${n}x ${item.name}`;
        }

        c.close();
        return false;
      } catch (err) {
        logger.error('use/openChest', err);
        return false;
      }
    },

    /** 使用功能方块 */
    async use_block(params) {
      const blockName = (params.block || '').toLowerCase().replace(/\s+/g, '_');
      const block = findBlock(blockName);
      if (!block) {
        console.log(`[Use] No ${blockName} nearby`);
        return false;
      }

      if (!(await walkToBlock(block))) {
        console.log(`[Use] Cannot reach ${blockName}`);
        return false;
      }

      try {
        await bot.activateBlock(block);
        console.log(`[Use] Used ${blockName}`);
        logger.action('use', 'use_block', blockName);
        return true;
      } catch (err) {
        logger.error('use/useBlock', err);
        return false;
      }
    },
  },
};

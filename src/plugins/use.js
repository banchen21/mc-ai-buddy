/**
 * 🖐️ use 插件 — 使用功能方块 / 物品
 *
 * 四种模式：
 *   1. 带 UI 模式 — 熔炉/箱子/附魔台等，打开 GUI 操作
 *   2. 无 UI 模式 — 门/拉杆/按钮/床等，右键激活即可
 *   3. 进食模式 — 吃食物（无 UI，不需要方块）
 *   4. 长按模式 — 弓/弩/三叉戟/盾牌/药水/水桶等，长按右键蓄力/使用
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const logger = require('../core/logger');

let bot, deps;

// 燃料燃烧时间（ticks）
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

const COOK_TIME = 200; // 烧炼时间 200 ticks = 10秒

// 带 UI 的方块（需要打开 GUI 操作）
const UI_BLOCKS = /furnace|blast_furnace|smoker|chest|trapped_chest|barrel|shulker_box|enchanting_table|anvil|grindstone|cartography_table|smithing_table|loom|stonecutter|brewing_stand|beacon|hopper|dispenser|dropper/;

// 无 UI 的方块（右键激活即可）
const NOUI_BLOCKS = /door|trapdoor|fence_gate|lever|button|pressure_plate|note_block|jukebox|bell|bed|respawn_anchor|lodestone|composter|cauldron|flower_pot|cake|campfire|soul_campfire/;

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

function findBlock(blockName, maxDist = 16) {
  const mcData = require('minecraft-data')(bot.version);
  const id = mcData.blocksByName[blockName]?.id;
  if (!id) return null;
  return bot.findBlock({ matching: id, maxDistance: maxDist });
}

/** 判断方块是否需要 UI */
function needsUI(blockName) {
  return UI_BLOCKS.test(blockName);
}

module.exports = {
  name: 'use',
  version: '2.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() {},
  stop() {},

  tools: [
    {
      type: 'function',
      function: {
        name: 'use',
        description: '使用功能方块或物品。支持：activate(右键方块)、smelt(烧炼)、deposit/withdraw/view(箱子)、eat(进食)、hold(长按右键蓄力/使用物品)' ,
        parameters: {
          type: 'object',
          properties: {
            block: { type: 'string', description: '方块英文名。hold/eat时不需要' },
            action: { type: 'string', description: 'smelt | deposit | withdraw | view | eat | hold | activate(默认)' },
            input: { type: 'string', description: '[smelt] 要烧炼的物品' },
            fuel: { type: 'string', description: '[smelt] 燃料，不填自动选' },
            count: { type: 'number', description: '[smelt/deposit/withdraw] 数量' },
            item: { type: 'string', description: '[deposit/withdraw/eat/hold] 物品英文名。hold时必填(如bow/crossbow/shield/potion/water_bucket)' },
            duration: { type: 'number', description: '[hold] 长按持续时间(毫秒)，默认1000ms。弓蓄力约1000ms，吃东西约1600ms' },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
  ],

  actions: {
    /**
     * 使用功能方块 / 物品
     *
     * 右键方块：
     *   use({ block: 'oak_door' })
     *   use({ block: 'lever' })
     *   use({ block: 'crafting_table' })
     *
     * 带 UI：
     *   use({ block: 'furnace', action: 'smelt', input: 'iron_ore', fuel: 'coal', count: 8 })
     *   use({ block: 'chest', action: 'deposit', item: 'cobblestone', count: 64 })
     *   use({ block: 'chest', action: 'withdraw', item: 'iron_ingot', count: 10 })
     *   use({ block: 'chest', action: 'view' })
     *
     * 进食：
     *   use({ action: 'eat' })
     *   use({ action: 'eat', item: 'cooked_beef' })
     *
     * 长按右键：
     *   use({ action: 'hold', item: 'bow' })                  // 射箭(蓄力1秒)
     *   use({ action: 'hold', item: 'crossbow' })             // 弩(已装填则发射)
     *   use({ action: 'hold', item: 'shield' })               // 举盾
     *   use({ action: 'hold', item: 'trident' })              // 投掷三叉戟
     *   use({ action: 'hold', item: 'water_bucket' })         // 倒水
     *   use({ action: 'hold', item: 'potion', duration: 1600 }) // 喝药水
     *   use({ action: 'hold', item: 'golden_apple', duration: 1600 }) // 吃金苹果
     */
    async use(params) {
      const action = params.action || 'activate';

      // ===== 进食模式 =====
      if (action === 'eat') {
        return this._eat(params);
      }

      // ===== 长按右键模式 =====
      if (action === 'hold') {
        return this._hold(params);
      }

      const blockName = (params.block || '').toLowerCase().replace(/\s+/g, '_');
      if (!blockName) {
        console.log('[Use] No block specified');
        return 'no_block';
      }

      // 找方块
      const block = findBlock(blockName);
      if (!block) {
        console.log(`[Use] No ${blockName} nearby`);
        return 'no_block';
      }

      // 走到方块旁
      if (!(await walkToBlock(block))) {
        console.log(`[Use] Cannot reach ${blockName}`);
        return 'unreachable';
      }

      // 判断是否带 UI
      if (needsUI(blockName)) {
        return this._useWithUI(block, blockName, action, params);
      } else {
        return this._useWithoutUI(block, blockName);
      }
    },

    // ================================================================
    //  带 UI 模式：打开 GUI → 操作 → 关闭
    // ================================================================

    async _useWithUI(block, blockName, action, params) {
      switch (action) {
        case 'smelt':
          return this._smelt(block, params);
        case 'deposit':
          return this._chestDeposit(block, params);
        case 'withdraw':
          return this._chestWithdraw(block, params);
        case 'view':
          return this._chestView(block);
        default:
          // 默认：打开 GUI 看一眼就关（如附魔台、铁砧）
          return this._activateUI(block, blockName);
      }
    },

    /** 烧炼物品 */
    async _smelt(furnaceBlock, params) {
      const inputName = (params.input || '').toLowerCase().replace(/\s+/g, '_');
      const fuelName = (params.fuel || '').toLowerCase().replace(/\s+/g, '_');
      const count = params.count || null;

      const inputItem = bot.inventory.items().find(i =>
        i.name === inputName || i.name.includes(inputName)
      );
      if (!inputItem) {
        console.log(`[Use] No ${inputName} in inventory`);
        return 'no_input';
      }

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
        return 'no_fuel';
      }

      const smeltCount = count ? Math.min(count, inputItem.count) : inputItem.count;
      const fuelTime = getFuelTime(fuelItem.name);
      if (fuelTime === 0) {
        console.log(`[Use] ${fuelItem.name} is not fuel`);
        return 'not_fuel';
      }

      const itemsPerFuel = Math.floor(fuelTime / COOK_TIME);
      const fuelNeeded = Math.ceil(smeltCount / itemsPerFuel);
      const actualFuel = Math.min(fuelNeeded, fuelItem.count);

      console.log(`[Smelt] ${smeltCount}x ${inputItem.name} | fuel: ${fuelItem.name} ×${actualFuel} (1 fuel = ${itemsPerFuel} items)`);

      try {
        const f = await bot.openFurnace(furnaceBlock);
        await f.putFuel(fuelItem.type, null, actualFuel);
        await f.putInput(inputItem.type, null, smeltCount);

        console.log(`[Smelt] Started, waiting...`);

        const maxWaitMs = smeltCount * COOK_TIME * 60;
        const startTime = Date.now();
        let smelted = 0;

        while (Date.now() - startTime < maxWaitMs) {
          await new Promise(r => setTimeout(r, 1500));

          try {
            const outputItem = f.outputItem();
            if (outputItem) {
              await f.takeOutput();
              smelted += outputItem.count;
            }
          } catch {}

          if (smelted >= smeltCount) break;

          try {
            const inputSlot = f.inputItem();
            if (!inputSlot && smelted < smeltCount) {
              const remaining = smeltCount - smelted;
              const moreFuel = Math.ceil(remaining / itemsPerFuel);
              const fuelLeft = bot.inventory.items().find(i => i.name === fuelItem.name);
              if (fuelLeft && moreFuel > 0) {
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
        }
        return false;
      } catch (err) {
        logger.error('use/smelt', err);
        return false;
      }
    },

    /** 箱子存入 */
    async _chestDeposit(chestBlock, params) {
      const itemName = (params.item || '').toLowerCase().replace(/\s+/g, '_');
      const count = params.count || null;

      const item = bot.inventory.items().find(i =>
        i.name === itemName || i.name.includes(itemName)
      );
      if (!item) return 'no_item';

      try {
        const c = await bot.openContainer(chestBlock);
        const n = count ? Math.min(count, item.count) : item.count;
        await c.deposit(item.type, null, n);
        c.close();
        console.log(`[Use] Deposited ${n}x ${item.name}`);
        logger.action('use', 'deposit', `${n}x ${item.name}`);
        return n;
      } catch (err) {
        logger.error('use/deposit', err);
        return false;
      }
    },

    /** 箱子取出 */
    async _chestWithdraw(chestBlock, params) {
      const itemName = (params.item || '').toLowerCase().replace(/\s+/g, '_');
      const count = params.count || null;

      try {
        const c = await bot.openContainer(chestBlock);
        const item = c.containerItems().find(i =>
          i.name === itemName || i.name.includes(itemName)
        );
        if (!item) { c.close(); return 'not_found'; }

        const n = count ? Math.min(count, item.count) : item.count;
        await c.withdraw(item.type, null, n);
        c.close();
        console.log(`[Use] Withdrew ${n}x ${item.name}`);
        logger.action('use', 'withdraw', `${n}x ${item.name}`);
        return n;
      } catch (err) {
        logger.error('use/withdraw', err);
        return false;
      }
    },

    /** 箱子查看 */
    async _chestView(chestBlock) {
      try {
        const c = await bot.openContainer(chestBlock);
        const items = c.containerItems().map(i => `${i.name}×${i.count}`).join(', ');
        c.close();
        return items || 'empty';
      } catch (err) {
        logger.error('use/view', err);
        return false;
      }
    },

    /** 带 UI 方块默认激活（附魔台、铁砧等） */
    async _activateUI(block, blockName) {
      try {
        await bot.activateBlock(block);
        console.log(`[Use] Activated ${blockName}`);
        logger.action('use', 'activate', blockName);
        return true;
      } catch (err) {
        logger.error('use/activateUI', err);
        return false;
      }
    },

    // ================================================================
    //  无 UI 模式：右键激活（门/拉杆/按钮/床/音符盒等）
    // ================================================================

    async _useWithoutUI(block, blockName) {
      try {
        await bot.activateBlock(block);
        console.log(`[Use] Activated ${blockName}`);
        logger.action('use', 'activate', blockName);
        return true;
      } catch (err) {
        logger.error('use/activate', err);
        return false;
      }
    },

    // ================================================================
    //  长按右键模式：弓/弩/三叉戟/盾牌/药水/水桶等
    // ================================================================

    // 需要长按的物品及其默认蓄力时间(ms)
    HOLD_ITEMS: {
      bow: 1000, crossbow: 1000, trident: 1000,
      shield: 500, water_bucket: 200, lava_bucket: 200,
      potion: 1600, splash_potion: 1600, lingering_potion: 1600,
      golden_apple: 1600, enchanted_golden_apple: 1600,
      milk_bucket: 1600, honey_bottle: 1600,
      spyglass: 500, brush: 500,
      fishing_rod: 500, goat_horn: 1000,
    },

    async _hold(params) {
      const itemName = (params.item || '').toLowerCase().replace(/\s+/g, '_');
      if (!itemName) {
        console.log('[Use] hold requires item parameter');
        return 'no_item';
      }

      // 找物品
      const item = bot.inventory.items().find(i =>
        i.name === itemName || i.name.includes(itemName)
      );
      if (!item) {
        console.log(`[Use] No ${itemName} in inventory`);
        return 'no_item';
      }

      // 确定蓄力时间
      let duration = params.duration || null;
      if (!duration) {
        // 自动匹配
        for (const [key, ms] of Object.entries(this.HOLD_ITEMS)) {
          if (item.name.includes(key)) {
            duration = ms;
            break;
          }
        }
        if (!duration) duration = 1000; // 默认 1 秒
      }

      console.log(`[Use] 🖐️ Holding ${item.name} for ${duration}ms`);

      try {
        await bot.equip(item, 'hand');

        // 开始长按
        bot.activateItem();

        // 等待蓄力
        await new Promise(r => setTimeout(r, duration));

        // 释放（弓射箭、三叉戟投掷等）
        bot.deactivateItem();

        logger.action('use', 'hold', `${item.name} ${duration}ms`);
        return true;
      } catch (err) {
        logger.error('use/hold', err);
        // 确保释放
        try { bot.deactivateItem(); } catch {}
        return false;
      }
    },

    // ================================================================
    //  进食模式：吃食物（无 UI，不需要方块）
    // ================================================================

    // 食物优先级（饱食度从高到低，腐肉/蜘蛛眼最后）
    FOOD_PRIORITY: [
      'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
      'cooked_cod', 'cooked_salmon', 'baked_potato', 'golden_carrot', 'golden_apple',
      'beef', 'porkchop', 'chicken', 'mutton', 'bread', 'apple',
      'carrot', 'potato', 'melon_slice', 'cod', 'salmon', 'cookie',
      'pumpkin_pie', 'rabbit_stew', 'mushroom_stew', 'beetroot_soup',
      'dried_kelp', 'sweet_berries', 'glow_berries', 'chorus_fruit',
      'rotten_flesh', 'spider_eye',
    ],

    async _eat(params) {
      const itemName = params.item || null;
      let food = null;

      if (itemName) {
        // 指定食物
        food = bot.inventory.items().find(i =>
          i.name === itemName || i.name.includes(itemName)
        );
        if (!food) {
          console.log(`[Use] No ${itemName} to eat`);
          return 'no_food';
        }
      } else {
        // 自动选最佳食物
        for (const name of this.FOOD_PRIORITY) {
          food = bot.inventory.items().find(i => i.name === name);
          if (food) break;
        }
        if (!food) {
          console.log('[Use] No food in inventory');
          return 'no_food';
        }
      }

      console.log(`[Use] 🍖 Eating ${food.name} (food: ${Math.round(bot.food)})`);

      try {
        await bot.equip(food, 'hand');
        await bot.consume();
        logger.action('use', 'eat', food.name);
        return true;
      } catch (err) {
        logger.error('use/eat', err);
        return false;
      }
    },
  },
};

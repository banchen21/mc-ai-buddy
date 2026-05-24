/**
 * 🔧 craft 插件 — 合成：自动合成 + 工作台管理
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const logger = require('../core/logger');

let bot, deps;

function makeMovements() {
  const mcData = require('minecraft-data')(bot.version);
  const moves = new Movements(bot, mcData);
  moves.canDig = false;
  moves.canSwim = true;
  return moves;
}

/** 查找或放置工作台 */
async function findOrPlaceTable() {
  const mcData = require('minecraft-data')(bot.version);
  const tableId = mcData.blocksByName.crafting_table?.id;
  if (!tableId) return null;

  // 先找附近的（扩大范围到 16 格）
  const nearby = bot.findBlock({ matching: tableId, maxDistance: 16 });
  if (nearby) {
    console.log(`[Craft] Found table at ${nearby.position}`);
    return nearby;
  }

  // 背包里有就放
  const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!tableItem) {
    console.log('[Craft] No crafting_table in inventory');
    return null;
  }

  // 找脚下或旁边的空地
  const pos = bot.entity.position.floored();
  const offsets = [
    { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
    { x: 0, y: 1, z: 0 },  // 头顶
  ];

  for (const off of offsets) {
    const targetPos = pos.offset(off.x, off.y, off.z);
    const block = bot.blockAt(targetPos);
    if (block && (block.name === 'air' || block.name === 'cave_air')) {
      const refBlock = bot.blockAt(targetPos.offset(0, -1, 0));
      if (refBlock && refBlock.name !== 'air') {
        try {
          await bot.equip(tableItem, 'hand');
          await bot.placeBlock(refBlock, new (require('vec3'))(0, 1, 0));
          console.log(`[Craft] Placed table at ${targetPos}`);
          return bot.blockAt(targetPos);
        } catch (err) {
          logger.error('craft/placeTable', err);
        }
      }
    }
  }

  console.log('[Craft] No valid spot to place table');
  return null;
}

module.exports = {
  name: 'craft',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() {},
  stop() {},

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'craft',
        description: '合成物品（自动处理工作台）',
        parameters: {
          type: 'object',
          properties: {
            item: { type: 'string', description: '物品英文名，如 wooden_pickaxe, stone_pickaxe, iron_pickaxe, crafting_table, furnace, wooden_axe, stick, oak_planks, white_bed' },
            count: { type: 'number', description: '合成数量，默认1' },
          },
          required: ['item', 'count'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'sleep',
        description: '在附近的床上睡觉（仅夜晚可用）',
        parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
      },
    },
  ],

  actions: {
    /** 合成物品 */
    async craft(params) {
      const itemName = params.item || params.item_name;
      const count = params.count || 1;
      const mcData = require('minecraft-data')(bot.version);

      // 查找物品 ID
      const item = mcData.itemsByName[itemName]
        || Object.values(mcData.itemsByName).find(i => i.name.includes(itemName));

      if (!item) {
        console.log(`[Craft] Unknown item: ${itemName}`);
        return false;
      }

      console.log(`[Craft] Target: ${itemName} (id=${item.id}), count=${count}`);

      // 先尝试 2x2 合成（背包合成）
      let recipe = bot.recipesFor(item.id, null, 1, null);
      console.log(`[Craft] 2x2 recipes: ${recipe?.length || 0}`);

      // 需要工作台
      let table = null;
      if (!recipe?.length) {
        table = await findOrPlaceTable();
        console.log(`[Craft] Crafting table: ${table ? 'found' : 'not found'}`);
        if (!table) {
          console.log(`[Craft] No crafting table for ${itemName}`);
          return false;
        }
        recipe = bot.recipesFor(item.id, null, 1, table);
        console.log(`[Craft] 3x3 recipes: ${recipe?.length || 0}`);
      }

      if (!recipe?.length) {
        const allRecipes = bot.recipesAll(item.id, null, table);
        console.log(`[Craft] All recipes for ${itemName}: ${allRecipes?.length || 0}`);
        if (allRecipes?.length) {
          const first = allRecipes[0];
          const ingredients = (first.delta || [])
            .filter(d => d.count < 0 && d.id > 0)
            .map(d => {
              const itemName = mcData.items[d.id]?.name || `id:${d.id}`;
              return `${itemName}×${-d.count}`;
            }).join(', ');

          console.log(`[Craft] Needs: ${ingredients}`);
          // 返回缺失材料信息，让 LLM 知道该收集什么
          return `need: ${ingredients}`;
        } else {
          console.log(`[Craft] No recipe for ${itemName}`);
        }
        return false;
      }

      try {
        // 如果用工作台，先走到旁边
        if (table) {
          const dist = bot.entity.position.distanceTo(table.position);
          if (dist > 4) {
            console.log(`[Craft] Walking to table (${Math.round(dist)}m away)...`);
            bot.pathfinder.setMovements(makeMovements());
            const goal = new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2);
            await bot.pathfinder.goto(goal);
            bot.pathfinder.setGoal(null);
            // 重新获取方块引用（位置可能变了）
            table = bot.blockAt(table.position);
            if (!table) {
              console.log('[Craft] Table disappeared');
              return false;
            }
          }
        }

        await bot.craft(recipe[0], count, table);
        console.log(`[Craft] Crafted ${count}x ${itemName}`);
        logger.action('craft', 'craft', `${count}x ${itemName}`);
        return true;
      } catch (err) {
        logger.error('craft/craft', err);
        console.log(`[Craft] Error: ${err.message}`);
        return false;
      }
    },

    /** 睡觉 */
    async sleep() {
      const timeOfDay = bot.time?.timeOfDay ?? (bot.time?.age ?? 0) % 24000;
      const isNight = timeOfDay > 12540 && timeOfDay < 23460;
      if (!isNight && !bot.isRaining && !bot.isThundering) {
        return 'not_night';
      }

      const mcData = require('minecraft-data')(bot.version);
      // 匹配所有床（white_bed, red_bed 等）
      const bedIds = Object.entries(mcData.blocksByName)
        .filter(([n]) => n.includes('bed'))
        .map(([, b]) => b.id);
      if (!bedIds.length) return 'no_bed';

      // 直接找最近的床方块
      const bed = bot.findBlock({ matching: bedIds, maxDistance: 32 });
      if (!bed) return 'no_bed';

      try {
        const dist = bot.entity.position.distanceTo(bed.position);
        if (dist > 3) {
          bot.pathfinder.setMovements(makeMovements());
          await bot.pathfinder.goto(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));
          bot.pathfinder.setGoal(null);
        }

        await bot.sleep(bed);
        logger.action('craft', 'sleep');
        return true;
      } catch (err) {
        console.log(`[Craft] Sleep failed: ${err.message}`);
        return false;
      }
    },
  },
};

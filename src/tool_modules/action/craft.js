/**
 * 合成模块 — 合成 / 查询配方 / 熔炼
 * 参考 plugins/craft.js：使用 mcData.itemsByName + bot.recipesFor
 */
const { Movements, goals } = require('mineflayer-pathfinder');

class CraftModule {
  constructor(bot) {
    this.bot = bot;
  }

  getToolDefs() {
    return [
      {
        type: 'function',
        function: {
          name: 'craft',
          description: '合成物品（自动处理工作台），物品名用英文如 wooden_pickaxe, stick, oak_planks, crafting_table',
          parameters: {
            type: 'object',
            properties: {
              item: { type: 'string', description: '物品英文名' },
              count: { type: 'number', description: '数量，默认1' },
            },
            required: ['item'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_recipe',
          description: '查询物品的合成配方及所需材料',
          parameters: {
            type: 'object',
            properties: {
              item: { type: 'string', description: '物品英文名' },
            },
            required: ['item'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'smelt',
          description: '用熔炉烧炼物品',
          parameters: {
            type: 'object',
            properties: {
              item: { type: 'string', description: '要烧炼的物品英文名' },
              fuel: { type: 'string', description: '燃料（coal/planks等），默认coal' },
              count: { type: 'number', description: '数量，默认1' },
            },
            required: ['item'],
          },
        },
      },
    ];
  }

  getExecutors() {
    return {
      craft: (p) => this._craft(p),
      search_recipe: (p) => this._searchRecipe(p),
      smelt: (p) => this._smelt(p),
    };
  }

  // ===== 辅助 =====

  /** 获取 mcData */
  _mcData() {
    return require('minecraft-data')(this.bot.version);
  }

  /** 通过名称模糊查找物品 */
  _findItem(itemName) {
    const mcData = this._mcData();
    return mcData.itemsByName[itemName]
      || Object.values(mcData.itemsByName).find(i => i.name.includes(itemName));
  }

  /** 构建寻路 movements */
  _makeMovements() {
    const mcData = this._mcData();
    const moves = new Movements(this.bot, mcData);
    moves.canDig = false;
    moves.canSwim = true;
    return moves;
  }

  /** 查找或放置工作台 */
  async _findOrPlaceTable() {
    const mcData = this._mcData();
    const tableId = mcData.blocksByName.crafting_table?.id;
    if (!tableId) return null;

    // 先找附近的（16格内）
    const nearby = this.bot.findBlock({ matching: tableId, maxDistance: 16 });
    if (nearby) return nearby;

    // 背包里有就放
    const tableItem = this.bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) return null;

    const pos = this.bot.entity.position.floored();
    const offsets = [
      { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
    ];

    for (const off of offsets) {
      const targetPos = pos.offset(off.x, off.y, off.z);
      const block = this.bot.blockAt(targetPos);
      if (block && (block.name === 'air' || block.name === 'cave_air')) {
        const refBlock = this.bot.blockAt(targetPos.offset(0, -1, 0));
        if (refBlock && refBlock.name !== 'air') {
          try {
            await this.bot.equip(tableItem, 'hand');
            await this.bot.placeBlock(refBlock, new (require('vec3').Vec3)(0, 1, 0));
            return this.bot.blockAt(targetPos);
          } catch {}
        }
      }
    }
    return null;
  }

  // ===== 工具实现 =====

  _searchRecipe({ item }) {
    const mcData = this._mcData();
    const targetItem = this._findItem(item);
    if (!targetItem) return `未找到物品: ${item}`;

    // 用 bot.recipesFor 查配方（2x2 和 3x3）
    const recipes2x2 = this.bot.recipesFor(targetItem.id, null, 1, null) || [];
    const table = this.bot.findBlock({
      matching: mcData.blocksByName.crafting_table?.id,
      maxDistance: 16,
    });
    const recipes3x3 = table ? (this.bot.recipesFor(targetItem.id, null, 1, table) || []) : [];

    const allRecipes = [...recipes2x2, ...recipes3x3];
    if (!allRecipes.length) return `未找到 ${item} 的合成配方`;

    // 取第一个配方，解析材料
    const recipe = allRecipes[0];
    const ingredients = (recipe.delta || [])
      .filter(d => d.type === 'item' && d.count < 0)
      .map(d => {
        const ingName = mcData.items[d.id]?.name || `id:${d.id}`;
        return `${ingName} x${-d.count}`;
      }).join(', ');

    const needsTable = recipes2x2.length === 0;
    const tableHint = needsTable ? '（需要工作台）' : '（背包合成）';
    return `${targetItem.name}: ${ingredients || '无材料'} ${tableHint}`;
  }

  async _craft({ item, count = 1 }) {
    const mcData = this._mcData();
    const targetItem = this._findItem(item);
    if (!targetItem) return `未找到物品: ${item}`;

    // 先尝试 2x2 背包合成
    let recipe = this.bot.recipesFor(targetItem.id, null, 1, null);
    let table = null;

    if (!recipe?.length) {
      // 需要工作台
      table = await this._findOrPlaceTable();
      if (!table) return `合成 ${item} 需要工作台，但附近没有且背包也没有工作台`;
      recipe = this.bot.recipesFor(targetItem.id, null, 1, table);
    }

    if (!recipe?.length) {
      // 检查缺什么材料
      const allRecipes = this.bot.recipesAll(targetItem.id, null, table);
      if (allRecipes?.length) {
        const ingredients = (allRecipes[0].delta || [])
          .filter(d => d.type === 'item' && d.count < 0)
          .map(d => {
            const ingName = mcData.items[d.id]?.name || `id:${d.id}`;
            return `${ingName} x${-d.count}`;
          }).join(', ');
        return `缺少材料: ${ingredients}`;
      }
      return `未找到 ${item} 的合成配方`;
    }

    // 如果用工作台，先走到旁边
    if (table) {
      const dist = this.bot.entity.position.distanceTo(table.position);
      if (dist > 4) {
        this.bot.pathfinder.setMovements(this._makeMovements());
        await this.bot.pathfinder.goto(
          new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2)
        );
        this.bot.pathfinder.setGoal(null);
        table = this.bot.blockAt(table.position);
        if (!table) return '工作台不见了';
      }
    }

    try {
      await this.bot.craft(recipe[0], count, table);
      return `合成了 ${targetItem.name} x${count}`;
    } catch (err) {
      return `合成失败: ${err.message}`;
    }
  }

  async _smelt({ item, fuel = 'coal', count = 1 }) {
    const furnace = this.bot.findBlock({
      matching: this._mcData().blocksByName.furnace?.id,
      maxDistance: 8,
    });
    if (!furnace) return '附近没有熔炉';

    const inputItem = this.bot.inventory.items().find(i => i.name.includes(item));
    if (!inputItem) return `背包没有 ${item}`;
    const fuelItem = this.bot.inventory.items().find(i => i.name.includes(fuel));
    if (!fuelItem) return `背包没有燃料 ${fuel}`;

    try {
      const furnaceBlock = await this.bot.openFurnace(furnace);
      await furnaceBlock.putInput(inputItem.type, null, count);
      await furnaceBlock.putFuel(fuelItem.type, null, 1);
      await furnaceBlock.close();
      return `开始烧炼 ${item} x${count}`;
    } catch (err) {
      return `烧炼失败: ${err.message}`;
    }
  }
}

module.exports = { CraftModule };

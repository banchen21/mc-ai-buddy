/**
 * 合成模块 — 合成 / 查询配方 / 熔炼
 */
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
          description: '合成指定物品',
          parameters: {
            type: 'object',
            properties: {
              item: { type: 'string', description: '要合成的物品名' },
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
          description: '查询物品的合成配方',
          parameters: {
            type: 'object',
            properties: {
              item: { type: 'string', description: '物品名' },
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
              item: { type: 'string', description: '要烧炼的物品名' },
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

  _searchRecipe({ item }) {
    const recipes = this.bot.registry.recipes;
    if (!recipes) return '无法获取合成表';
    const found = recipes.filter(r =>
      r.result && r.result.name && r.result.name.includes(item)
    ).slice(0, 3);
    if (found.length === 0) return `未找到 ${item} 的合成配方`;
    return found.map(r => {
      const ingredients = Object.entries(r.ingredients || {})
        .map(([k, v]) => `${v.name || v} x${v.count || 1}`).join(' + ');
      return `${r.result.name}: ${ingredients}`;
    }).join(' | ');
  }

  async _craft({ item, count = 1 }) {
    const recipes = this.bot.registry.recipes;
    if (!recipes) return '无法获取合成表';
    const recipe = recipes.find(r =>
      r.result && r.result.name && r.result.name.includes(item)
    );
    if (!recipe) return `未找到 ${item} 的合成配方`;

    const craftTable = this.bot.findBlock({
      matching: this.bot.registry.blocksByName.crafting_table?.id,
      maxDistance: 8,
    });

    try {
      await this.bot.craft(recipe, count, craftTable || undefined);
      return `合成了 ${item} x${count}`;
    } catch (err) {
      return `合成失败: ${err.message}`;
    }
  }

  async _smelt({ item, fuel = 'coal', count = 1 }) {
    const furnace = this.bot.findBlock({
      matching: this.bot.registry.blocksByName.furnace?.id,
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

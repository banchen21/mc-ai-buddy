/**
 * 🍖 survive 插件 — 生存：进食、装备升级
 */
const logger = require('../core/logger');

let bot, deps;

const FOOD_ITEMS = [
  'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
  'cooked_cod', 'cooked_salmon', 'baked_potato',
  'beef', 'porkchop', 'chicken', 'mutton',
  'bread', 'apple', 'carrot', 'potato',
  'cod', 'salmon', 'cookie', 'melon_slice',
];

const GEAR_TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];

module.exports = {
  name: 'survive',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() {
    bot.loadPlugin(require('mineflayer-auto-eat').plugin);
    logger.info('survive', 'ready');
  },
  stop() {},

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'eat',
        description: '吃背包里的食物恢复饱食度',
        parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'upgrade',
        description: '自动升级到背包里最好的武器/工具',
        parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
      },
    },
  ],

  actions: {
    /** 吃东西 */
    async eat() {
      const food = bot.inventory.items().find(i => FOOD_ITEMS.includes(i.name));
      if (!food) { console.log('[Survive] No food to eat'); return false; }

      try {
        await bot.equip(food, 'hand');
        await bot.consume();
        logger.action('survive', 'eat', food.name);
        return true;
      } catch {
        return false;
      }
    },

    /** 升级装备 */
    async upgrade() {
      const mcData = require('minecraft-data')(bot.version);

      // 检查当前装备等级
      const currentSword = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
      const currentTier = currentSword
        ? GEAR_TIERS.findIndex(t => currentSword.name.includes(t))
        : -1;

      // 找更好的武器
      const better = bot.inventory.items().find(i => {
        if (!i.name.includes('sword') && !i.name.includes('axe')) return false;
        const tier = GEAR_TIERS.findIndex(t => i.name.includes(t));
        return tier > currentTier;
      });

      if (better) {
        await bot.equip(better, 'hand');
        logger.action('survive', 'upgrade', better.name);
      }
    },
  },

  /** 心跳：检查饥饿 */
  tick() {
    if (!bot?.entity) return;

    // 自动进食
    if (bot.food < 14) {
      const food = bot.inventory.items().find(i => FOOD_ITEMS.includes(i.name));
      if (food) {
        bot.equip(food, 'hand').then(() => bot.consume()).catch((e) => logger.error('survive/eat', e));
        logger.action('survive', 'autoEat', `food:${bot.food}`);
      }
    }

    // 自动升级装备
    this.actions.upgrade();
  },
};

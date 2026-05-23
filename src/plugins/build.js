/**
 * 🏗️ build 插件 — 建造：放置方块
 */
const logger = require('../core/logger');

let bot, deps;

module.exports = {
  name: 'build',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() { logger.info('build', 'ready'); },
  stop() {},

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'place',
        description: '在面前放置方块',
        parameters: {
          type: 'object',
          properties: {
            block: { type: 'string', description: '方块英文名，如 crafting_table, furnace, torch, oak_planks, stone' },
          },
          required: ['block'],
          additionalProperties: false,
        },
      },
    },
  ],

  actions: {
    /** 放置方块 — 在脚下周围找空地 */
    async place(params) {
      const blockName = (params.block || params.block_type || '').toLowerCase().replace(/\s+/g, '_');

      // 找物品
      const item = bot.inventory.items().find(i =>
        i.name === blockName || i.name.includes(blockName)
      );

      if (!item) {
        console.log(`[Build] No ${blockName} in inventory`);
        return false;
      }

      // 在脚下周围找空地
      const pos = bot.entity.position.floored();
      const offsets = [
        { dx: 1, dy: 0, dz: 0 }, { dx: -1, dy: 0, dz: 0 },
        { dx: 0, dy: 0, dz: 1 }, { dx: 0, dy: 0, dz: -1 },
      ];

      for (const off of offsets) {
        const targetPos = pos.offset(off.dx, off.dy, off.dz);
        const targetBlock = bot.blockAt(targetPos);
        const belowBlock = bot.blockAt(targetPos.offset(0, -1, 0));

        if (targetBlock && (targetBlock.name === 'air' || targetBlock.name === 'cave_air') &&
            belowBlock && belowBlock.name !== 'air' && belowBlock.name !== 'cave_air') {
          try {
            await bot.equip(item, 'hand');
            await bot.placeBlock(belowBlock, new (require('vec3'))(0, 1, 0));
            console.log(`[Build] Placed ${blockName}`);
            logger.action('build', 'place', blockName);
            return true;
          } catch (err) {
            logger.error('build/place', err);
          }
        }
      }

      console.log(`[Build] No spot to place ${blockName}`);
      return false;
    },
  },
};

/**
 * 🎁 give 插件 — 给玩家物品：走到玩家旁边 + 丢弃
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const logger = require('../core/logger');

let bot, deps;

function makeMovements() {
  const mcData = require('minecraft-data')(bot.version);
  const moves = new Movements(bot, mcData);
  moves.canDig = false;
  return moves;
}

module.exports = {
  name: 'give',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() { logger.info('give', 'ready'); },
  stop() {},

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'give',
        description: '把物品给玩家：先走到玩家旁边，再丢出物品',
        parameters: {
          type: 'object',
          properties: {
            item: { type: 'string', description: '物品英文名，如 stone_pickaxe, iron_ore, cobblestone, oak_log' },
            count: { type: 'number', description: '给的数量，不填则全部给' },
            player: { type: 'string', description: '给哪个玩家，不填则给最近的玩家' },
          },
          required: ['item', 'count', 'player'],
          additionalProperties: false,
        },
      },
    },
  ],

  actions: {
    /** 给玩家物品：走过去 + 丢弃 */
    async give(params) {
      const itemName = (params.item || '').toLowerCase().replace(/\s+/g, '_');
      const count = params.count || null;
      const targetName = params.player;

      // 1. 找物品
      const item = bot.inventory.items().find(i =>
        i.name === itemName || i.name.includes(itemName)
      );

      if (!item) {
        console.log(`[Give] No ${itemName} in inventory`);
        return false;
      }

      const giveCount = count ? Math.min(count, item.count) : item.count;

      // 2. 找目标玩家
      let target = null;
      if (targetName) {
        target = bot.players[targetName];
      }

      if (!target?.entity) {
        let nearest = null, nearestDist = Infinity;
        for (const [name, p] of Object.entries(bot.players)) {
          if (name === bot.username || !p.entity) continue;
          const d = bot.entity.position.distanceTo(p.entity.position);
          if (d < nearestDist) { nearestDist = d; nearest = p; }
        }
        target = nearest;
      }

      if (!target?.entity) {
        console.log('[Give] No player nearby');
        return false;
      }

      // 3. 走到玩家旁边
      const dist = bot.entity.position.distanceTo(target.entity.position);
      if (dist > 3) {
        console.log(`[Give] Walking to give ${giveCount}x ${item.name}`);
        bot.pathfinder.setMovements(makeMovements());
        const goal = new goals.GoalNear(
          target.entity.position.x,
          target.entity.position.y,
          target.entity.position.z,
          2
        );
        try {
          await bot.pathfinder.goto(goal);
        } catch (err) {
          logger.error('give/goto', err);
          bot.pathfinder.setGoal(null);
          return false;
        }
        bot.pathfinder.setGoal(null);
      }

      // 4. 看向玩家
      if (target.entity) {
        await bot.lookAt(target.entity.position.offset(0, 1.6, 0));
      }

      // 5. 丢弃物品
      try {
        await bot.toss(item.type, null, giveCount);
        console.log(`[Give] Gave ${giveCount}x ${item.name}`);
        logger.action('give', 'give', `${giveCount}x ${item.name} to ${target.username || 'player'}`);
        return true;
      } catch (err) {
        logger.error('give/toss', err);
        return false;
      }
    },
  },
};

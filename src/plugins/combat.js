/**
 * ⚔️ combat 插件 — 战斗：攻击、闪避、反击
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const logger = require('../core/logger');

let bot, deps;

const HOSTILE = /zombie|skeleton|creeper|spider|witch|husk|drowned|pillager|vindicator|evoker|enderman|hoglin|piglin_brute|blaze|wither_skeleton|cave_spider|slime|magma_cube/;

function makeMovements() {
  const mcData = require('minecraft-data')(bot.version);
  const moves = new Movements(bot, mcData);
  moves.canDig = false;
  return moves;
}

/** 装备最佳武器 */
function equipWeapon() {
  const weapon = bot.inventory.items().find(i =>
    i.name.includes('sword') && !i.name.includes('wood')
  ) || bot.inventory.items().find(i =>
    i.name.includes('sword') || i.name.includes('axe')
  );
  if (weapon) bot.equip(weapon, 'hand').catch((e) => logger.error('combat/equip', e));
  return weapon;
}

module.exports = {
  name: 'combat',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() {
    bot.loadPlugin(require('mineflayer-pvp').plugin);
    logger.info('combat', 'ready');
  },
  stop() {},

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'attack',
        description: '攻击目标（怪物或玩家）',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: '目标：nearest_hostile(最近怪物) 或玩家名 或实体名' },
          },
          required: ['target'],
          additionalProperties: false,
        },
      },
    },
  ],

  actions: {
    /** 攻击目标 */
    async attack(params) {
      const target = params.target || 'nearest_hostile';
      equipWeapon();

      if (target === 'nearest_hostile') {
        const hostile = bot.nearestEntity(e =>
          e.type === 'mob' && HOSTILE.test(e.name || '')
        );
        if (!hostile) { console.log('[Combat] No hostile nearby'); return; }
        return this._attackEntity(hostile);
      }

      // 玩家目标
      const player = bot.players[target];
      if (player?.entity) return this._attackEntity(player.entity);

      // 按名称找实体
      const entity = bot.nearestEntity(e => (e.name || '').includes(target));
      if (entity) return this._attackEntity(entity);

      console.log(`[Combat] Target not found: ${target}`);
    },

    /** 攻击实体 */
    async _attackEntity(entity) {
      const name = entity.name || entity.username || '目标';
      console.log(`[Combat] Attacking ${name}`);
      logger.action('combat', 'attack', name);

      if (typeof bot.attack !== 'function') {
        console.log('[Combat] bot.attack not available (pvp plugin not loaded)');
        return;
      }

      try {
        bot.pathfinder.setMovements(makeMovements());
        bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2));

        await bot.attack(entity);
        bot.pathfinder.setGoal(null);
      } catch (err) {
        logger.error('combat/attack', err);
      }
    },

    /** 闪避 */
    async dodge() {
      logger.action('combat', 'dodge');
      bot.pathfinder.setMovements(makeMovements());
      const pos = bot.entity.position;
      const angle = Math.random() * Math.PI * 2;
      bot.pathfinder.setGoal(new goals.GoalNear(
        pos.x + Math.cos(angle) * 15,
        pos.y,
        pos.z + Math.sin(angle) * 15,
        2
      ));
      setTimeout(() => bot.pathfinder.setGoal(null), 5000);
    },
  },

  /** 心跳：检测威胁 */
  tick(attackerEntity) {
    try {
      if (!bot?.entity || bot.health <= 0) return;

      // 优先响应传入的攻击者
      let hostiles = [];
      if (attackerEntity) {
        hostiles = [attackerEntity];
      } else {
        hostiles = Object.values(bot.entities).filter(
          e => e.type === 'mob' && HOSTILE.test(e.name || '') &&
            bot.entity.position.distanceTo(e.position) < 16
        );
      }

      if (hostiles.length > 0) {
        const threat = hostiles[0];
        logger.info('combat', `Threat: ${threat.name || threat.username || '?'} | HP:${Math.round(bot.health)}`);
        if (bot.health < 10) {
          this.actions.dodge();
        } else {
          equipWeapon();
          if (typeof bot.attack === 'function') {
            const result = bot.attack(threat);
            if (result && typeof result.catch === 'function') {
              result.catch((e) => logger.error('combat/autoAttack', e));
            }
          }
        }
      } else {
        deps?.memory?.perception?.clearThreat();
      }
    } catch (err) {
      logger.error('combat/tick', err);
    }
  },
};

/**
 * ⚔️ combat 插件 — 战斗：攻击、闪避、反击
 * 基于 mineflayer-pvp 实现智能攻击（自动追击、攻击冷却、盾牌格挡）
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
  version: '2.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() {
    bot.loadPlugin(require('mineflayer-pvp').plugin);
    // 配置 pvp 插件
    if (bot.pvp) {
      bot.pvp.followRange = 2;
      bot.pvp.attackRange = 3.5;
      bot.pvp.viewDistance = 32;
      bot.pvp.movements = makeMovements();
    }
    logger.info('combat', 'ready');
  },
  stop() {
    // 停止当前攻击
    try { bot.pvp?.stop(); } catch {}
  },

  tools: [
    {
      type: 'function',
      function: {
        name: 'attack',
        description: '攻击目标（自动追击直到目标死亡）',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: '目标名或 nearest_hostile' },
          },
          required: ['target'],
          additionalProperties: false,
        },
      },
    },
  ],

  actions: {
    /** 攻击目标（使用 bot.pvp 自动追击） */
    async attack(params) {
      const targetName = params?.target || 'nearest_hostile';
      equipWeapon();

      let target = null;

      if (targetName === 'nearest_hostile') {
        target = bot.nearestEntity(e => e.type === 'mob' && e.name !== 'player');
      } else {
        const player = bot.players[targetName];
        if (player?.entity) target = player.entity;
        if (!target) {
          target = bot.nearestEntity(e => (e.name || e.username || '').includes(targetName));
        }
      }

      if (!target) {
        console.log(`[Combat] No target: ${targetName}`);
        return false;
      }

      const name = target.name || target.username || '目标';
      console.log(`[Combat] Attacking ${name}`);
      logger.action('combat', 'attack', name);

      // 用 pvp 插件自动追击 + 攻击
      if (bot.pvp) {
        await bot.pvp.attack(target);
        return true;
      }
      return false;
    },

    /** 闪避：停止攻击，向远离威胁的方向跑 */
    async dodge() {
      logger.action('combat', 'dodge');

      // 先停止 pvp 攻击
      try { bot.pvp?.stop(); } catch {}

      bot.pathfinder.setMovements(makeMovements());

      const threat = bot.nearestEntity(e => e.type === 'mob');
      const pos = bot.entity.position;
      let dx = 0, dz = 0;

      if (threat) {
        const away = pos.clone().subtract(threat.position).normalize();
        dx = away.x * 20;
        dz = away.z * 20;
      } else {
        const angle = Math.random() * Math.PI * 2;
        dx = Math.cos(angle) * 20;
        dz = Math.sin(angle) * 20;
      }

      bot.pathfinder.setGoal(new goals.GoalNear(pos.x + dx, pos.y, pos.z + dz, 3));

      setTimeout(() => {
        try { bot?.pathfinder?.setGoal(null); } catch {}
      }, 5000);
    },
  },

  /** 心跳：检测威胁并自动响应 */
  tick(attackerEntity) {
    try {
      if (!bot?.entity || bot.health <= 0) return;

      // pvp 插件正在攻击中，不重复触发
      if (bot.pvp?.target) return;

      const threatRadius = deps?.config?.combat?.threatRadius ?? 16;
      const dodgeHp = deps?.config?.combat?.dodgeHpThreshold ?? 10;

      let threat = attackerEntity;
      if (!threat) {
        threat = bot.nearestEntity(e =>
          e.type === 'mob' &&
          bot.entity.position.distanceTo(e.position) < threatRadius
        );
      }

      if (!threat) {
        deps?.memory?.perception?.clearThreat();
        return;
      }

      logger.info('combat', `Threat: ${threat.name || '?'} | HP:${Math.round(bot.health)}`);

      if (bot.health < dodgeHp) {
        this.actions.dodge();
      } else {
        equipWeapon();
        this.actions.attack({ target: threat.name || threat.username });
      }
    } catch (err) {
      logger.error('combat/tick', err);
    }
  },
};

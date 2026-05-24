/**
 * #2 残血强制逃脱 (Low HP Flee)
 *
 * 触发：血量 < 6 点，且仍在被攻击
 * 行为：清空队列 + 连续疾跑 3 秒 + 自动使用金苹果/末影珍珠/不死图腾 + 放方块封路
 */

const { Movements, goals } = require('mineflayer-pathfinder');

const LIFE_SAVERS = [
  { name: 'golden_apple', action: 'eat' },
  { name: 'enchanted_golden_apple', action: 'eat' },
  { name: 'golden_carrot', action: 'eat' },
  { name: 'ender_pearl', action: 'throw' },
  { name: 'totem_of_undying', action: 'hold' },
];

class LowHpFlee {
  constructor(bot, deps) {
    this.bot = bot;
    this.deps = deps;
    this.fleeing = false;
    this.fleeStartTime = 0;
    this.FLEE_DURATION = 3000;
  }

  check(now) {
    if (this.bot.health >= 6) return false;
    if (!this.deps.memory?.perception?.underAttack) return false;
    if (this.fleeing) return false;

    console.log(`[Survival] 🏃 #2 Low HP Flee: HP=${Math.round(this.bot.health)}`);
    this.fleeing = true;
    this.fleeStartTime = now;
    this._useLifeSaver();
    this._startFlee();
    return true;
  }

  continueFlee() {
    if (!this.fleeing) return;
    if (Date.now() - this.fleeStartTime > this.FLEE_DURATION) {
      try { this.bot?.pathfinder?.setGoal(null); } catch {}
      this.fleeing = false;
    }
  }

  async _useLifeSaver() {
    for (const saver of LIFE_SAVERS) {
      const item = this.bot.inventory.items().find(i => i.name === saver.name);
      if (!item) continue;
      console.log(`[Survival] 💊 Life saver: ${saver.name}`);
      try {
        if (saver.action === 'eat') {
          await this.bot.equip(item, 'hand');
          await this.bot.consume();
        } else if (saver.action === 'hold') {
          await this.bot.equip(item, 'off-hand');
        } else if (saver.action === 'throw') {
          await this.bot.equip(item, 'hand');
          await this.bot.lookAt(this.bot.entity.position.offset(0, -1, 0), true);
          await this.bot.activateItem();
        }
        break;
      } catch (err) { console.error('[Survival] lifeSaver:', err.message); }
    }
  }

  _startFlee() {
    try {
      const mcData = require('minecraft-data')(this.bot.version);
      const moves = new Movements(this.bot, mcData);
      moves.canDig = true; moves.canSwim = true;
      this.bot.pathfinder.setMovements(moves);
      const pos = this.bot.entity.position;
      const threat = this._findThreat();
      if (threat) {
        const away = pos.clone().subtract(threat.position).normalize();
        this.bot.pathfinder.setGoal(new goals.GoalNear(pos.x + away.x * 25, pos.y, pos.z + away.z * 25, 5));
      } else {
        const angle = Math.random() * Math.PI * 2;
        this.bot.pathfinder.setGoal(new goals.GoalNear(pos.x + Math.cos(angle) * 25, pos.y, pos.z + Math.sin(angle) * 25, 5));
      }
      this._placeBlockBehind();
    } catch (err) { console.error('[Survival] flee:', err.message); }
  }

  _findThreat() {
    const harmless = /squid|bat|cod|salmon|tropical_fish|pufferfish|glow_squid|tadpole|axolotl|turtle|dolphin|villager|wandering_trader|iron_golem|snow_golem|cat|ocelot|wolf|fox|bee|chicken|cow|pig|sheep|rabbit|horse|donkey|mule|llama|trader_llama|parrot|panda|polar_bear|goat|frog|allay|camel|sniffer|armadillo/;
    return this.bot.nearestEntity(e => e.type === 'mob' && !harmless.test(e.name || '') && this.bot.entity.position.distanceTo(e.position) < 16);
  }

  _placeBlockBehind() {
    try {
      const pos = this.bot.entity.position.floored();
      const behind = pos.clone();
      const vel = this.bot.entity.velocity;
      if (Math.abs(vel.x) > Math.abs(vel.z)) behind.x += vel.x > 0 ? -1 : 1;
      else behind.z += vel.z > 0 ? -1 : 1;
      const block = this.bot.blockAt(behind);
      if (block && (block.name === 'air' || block.name === 'cave_air')) {
        const below = this.bot.blockAt(behind.offset(0, -1, 0));
        if (below && below.name !== 'air') {
          const scaffold = this.bot.inventory.items().find(i => /dirt|cobblestone|stone|netherrack|planks/.test(i.name));
          if (scaffold) {
            this.bot.equip(scaffold, 'hand').catch(() => {});
            this.bot.placeBlock(below, require('vec3')(0, 1, 0)).catch(() => {});
          }
        }
      }
    } catch {}
  }

  reset() {
    this.fleeing = false;
    this.fleeStartTime = 0;
  }
}

module.exports = { LowHpFlee };

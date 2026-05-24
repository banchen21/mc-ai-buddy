/**
 * #3 苦力怕预警 (Creeper Warning)
 * 触发：点燃的苦力怕在 5 格内 → 反方向疾跑
 */
const { Movements, goals } = require('mineflayer-pathfinder');

class CreeperWarning {
  constructor(bot) { this.bot = bot; }

  check() {
    try {
      const creeper = this.bot.nearestEntity(e =>
        (e.name === 'creeper' || (e.name || '').includes('creeper')) &&
        this.bot.entity.position.distanceTo(e.position) <= 5
      );
      if (!creeper) return false;
      const ignited = this._isIgnited(creeper);
      if (!ignited) return false;
      console.log(`[Survival] 💣 #3 Creeper! dist=${Math.round(this.bot.entity.position.distanceTo(creeper.position))}m`);
      this._dodge(creeper);
      return true;
    } catch { return false; }
  }

  _isIgnited(creeper) {
    try {
      if (creeper.metadata) {
        for (const [key, value] of creeper.metadata) {
          if ((key === 16 || key === 17) && value === true) return true;
        }
      }
      return this.bot.entity.position.distanceTo(creeper.position) <= 3;
    } catch { return this.bot.entity.position.distanceTo(creeper.position) <= 3; }
  }

  _dodge(threat) {
    try {
      const mcData = require('minecraft-data')(this.bot.version);
      const moves = new Movements(this.bot, mcData);
      moves.canDig = true; moves.canSwim = true; moves.allowParkour = true;
      this.bot.pathfinder.setMovements(moves);
      const pos = this.bot.entity.position;
      const away = pos.clone().subtract(threat.position).normalize();
      this.bot.pathfinder.setGoal(new goals.GoalNear(pos.x + away.x * 15, pos.y, pos.z + away.z * 15, 3));
      this.bot.setControlState('jump', true);
      setTimeout(() => {
        try { this.bot?.setControlState('jump', false); } catch {}
        try { this.bot?.pathfinder?.setGoal(null); } catch {}
      }, 3000);
    } catch (err) { console.error('[Survival] creeper:', err.message); }
  }

  reset() {}
}

module.exports = { CreeperWarning };

/**
 * #4 弹道闪避 (Projectile Dodge)
 * 触发：飞行物（箭/火球/三叉戟）8格内朝向自己 → 侧跳闪避
 */
const { Movements, goals } = require('mineflayer-pathfinder');

class ProjectileDodge {
  constructor(bot) {
    this.bot = bot;
    this.cooldown = 0;
  }

  check(now) {
    if (now - this.cooldown < 500) return false;
    try {
      const projectiles = Object.values(this.bot.entities).filter(e => {
        if (!e || e === this.bot.entity) return false;
        const name = (e.name || '').toLowerCase();
        return /arrow|trident|fireball|wither_skull|shulker_bullet|dragon_fireball|small_fireball|snowball|egg|llama_spit/.test(name);
      });
      if (!projectiles.length) return false;
      const myPos = this.bot.entity.position;
      for (const proj of projectiles) {
        const dist = myPos.distanceTo(proj.position);
        if (dist > 8) continue;
        const vel = proj.velocity;
        if (!vel) continue;
        // 判断飞行物是否朝向玩家：飞行物→玩家的方向 与 飞行物速度方向 的夹角
        const toPlayer = myPos.clone().subtract(proj.position);
        const toPlayerLen = Math.sqrt(toPlayer.x * toPlayer.x + toPlayer.y * toPlayer.y + toPlayer.z * toPlayer.z);
        const velLen = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
        if (toPlayerLen < 0.01 || velLen < 0.01) continue;
        // 点积 > 0 表示夹角 < 90°，即飞行物在朝向玩家
        const dot = (toPlayer.x * vel.x + toPlayer.y * vel.y + toPlayer.z * vel.z) / (toPlayerLen * velLen);
        if (dot > 0.3) {
          console.log(`[Survival] 🏹 #4 Projectile! ${proj.name || '?'} dist=${Math.round(dist)}m dot=${dot.toFixed(2)}`);
          this._dodge(vel);
          this.cooldown = now;
          return true;
        }
      }
    } catch {}
    return false;
  }

  _dodge(velocity) {
    try {
      const mcData = require('minecraft-data')(this.bot.version);
      const moves = new Movements(this.bot, mcData);
      moves.canDig = true; moves.canSwim = true;
      this.bot.pathfinder.setMovements(moves);
      const pos = this.bot.entity.position;
      const perpX = -velocity.z, perpZ = velocity.x;
      const len = Math.sqrt(perpX * perpX + perpZ * perpZ) || 1;
      const dir = Math.random() > 0.5 ? 1 : -1;
      this.bot.pathfinder.setGoal(new goals.GoalNear(pos.x + (perpX / len) * dir * 3, pos.y, pos.z + (perpZ / len) * dir * 3, 1));
      this.bot.setControlState('jump', true);
      setTimeout(() => {
        try { this.bot?.setControlState('jump', false); } catch {}
        try { this.bot?.pathfinder?.setGoal(null); } catch {}
      }, 400);
    } catch (err) { console.error('[Survival] projectile:', err.message); }
  }

  reset() { this.cooldown = 0; }
}

module.exports = { ProjectileDodge };

/**
 * #8 溺水自救 (Drowning)
 * 触发：头部在水中 + HP 在下降 + 无攻击者 → 上浮
 * 不触发：单纯在水中（允许水下作业）
 */
class Drowning {
  constructor(bot) {
    this.bot = bot;
    this.cooldown = 0;
    this._swimming = false;
    this._lastHealth = 0;
  }

  check(now) {
    // 正在上浮中 → 保持 active 直到脚下不是水
    if (this._swimming) {
      const feetPos = this.bot.entity.position.floored();
      const feetBlock = this.bot.blockAt(feetPos);
      if (feetBlock && feetBlock.name !== 'water') {
        this._stop();
        return false;
      }
      return true;
    }

    if (now - this.cooldown < 2000) return false;
    try {
      // 条件 1：头部在水中
      const headPos = this.bot.entity.position.floored().offset(0, 1, 0);
      const headBlock = this.bot.blockAt(headPos);
      if (!headBlock || headBlock.name !== 'water') {
        this._lastHealth = this.bot.health;
        return false;
      }

      // 条件 2：HP 在下降（说明氧气耗尽，真正溺水）
      const hp = this.bot.health;
      if (hp >= this._lastHealth) {
        this._lastHealth = hp;
        return false;
      }
      this._lastHealth = hp;

      // 条件 3：没有攻击者（排除战斗伤害）
      const threat = this.bot.nearestEntity(e =>
        e.type === 'mob' && this.bot.entity.position.distanceTo(e.position) < 10
      );
      if (threat) return false;

      console.log(`[Survival] 🌊 #8 Drowning! HP=${Math.round(hp)}`);
      this._swimUp();
      this.cooldown = now;
      return true;
    } catch { return false; }
  }

  _swimUp() {
    this._swimming = true;
    // 优先看向附近的玩家，否则看向上方
    const player = this._findNearestPlayer();
    if (player) {
      this.bot.lookAt(player.position, true).catch(() => {});
    } else {
      this.bot.lookAt(this.bot.entity.position.offset(0, 10, 0), true).catch(() => {});
    }
    // 奔跑 + 跳跃 + 前进（水中跳跃=上浮）
    this.bot.setControlState('sprint', true);
    this.bot.setControlState('jump', true);
    this.bot.setControlState('forward', true);
  }

  _findNearestPlayer() {
    let closest = null;
    let closestDist = Infinity;
    for (const [, e] of Object.entries(this.bot.entities)) {
      if (!e || e === this.bot.entity) continue;
      if (e.type !== 'player') continue;
      if (e.username === this.bot.username) continue;
      const dist = this.bot.entity.position.distanceTo(e.position);
      if (dist < closestDist) {
        closestDist = dist;
        closest = e;
      }
    }
    return closest;
  }

  _stop() {
    this._swimming = false;
    try { this.bot?.clearControlStates(); } catch {}
  }

  reset() {
    this.cooldown = 0;
    this._lastHealth = 0;
    this._stop();
  }
}

module.exports = { Drowning };

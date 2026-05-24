/**
 * #5 坠落自救 (Fall Save)
 * 触发：下落速度 > 5m/s 且下方非安全方块 → 水桶/船/干草块/末影珍珠
 */
class FallSave {
  constructor(bot) {
    this.bot = bot;
    this.cooldown = 0;
    this.lastY = 0;
    this.lastYTime = 0;
    this._saving = false; // 正在执行自救，防止被 deactivate 打断
  }

  track(now) {
    if (this.bot?.entity) {
      this.lastY = this.bot.entity.position.y;
      this.lastYTime = now;
    }
  }

  check(now) {
    // 自救执行中 → 保持 active
    if (this._saving) return true;
    if (now - this.cooldown < 2000) return false;
    try {
      const pos = this.bot.entity.position;
      if (this.lastYTime === 0 || now - this.lastYTime > 500) return false;
      const dt = (now - this.lastYTime) / 1000;
      if (dt <= 0 || dt > 0.5) return false;
      const fallSpeed = (this.lastY - pos.y) / dt;
      // 速度 > 5m/s 且 实际下落 > 1.5 格（排除击退造成的瞬时速度）
      const fallDist = this.lastY - pos.y;
      if (fallSpeed < 5 || fallDist < 1.5) return false;
      const below = this.bot.blockAt(pos.floored().offset(0, -1, 0));
      const safe = /water|slime|honey|hay|bed|wool|carpet|snow|vine|cobweb|powder_snow|scaffolding/;
      if (below && safe.test(below.name)) return false;
      console.log(`[Survival] 🪂 #5 Falling! speed=${fallSpeed.toFixed(1)}m/s dist=${fallDist.toFixed(1)}`);
      this._save();
      this.cooldown = now;
      return true;
    } catch { return false; }
  }

  _save() {
    this._saving = true;
    const pos = this.bot.entity.position;
    const below = pos.floored().offset(0, -1, 0);

    // 优先水桶
    const water = this.bot.inventory.items().find(i => i.name === 'water_bucket');
    if (water) {
      console.log('[Survival] 💧 MLG Water Bucket!');
      // 用 setTimeout 顺序执行，不依赖 Promise 链
      this.bot.equip(water, 'hand').catch(() => {});
      setTimeout(() => {
        this.bot.lookAt(below, true).catch(() => {});
        setTimeout(() => {
          this.bot.activateItem(); // 放水
          // 落地后回收
          setTimeout(() => {
            try {
              const feet = this.bot.entity?.position?.floored();
              if (feet) {
                const atFeet = this.bot.blockAt(feet);
                if (atFeet && atFeet.name === 'water') {
                  this.bot.activateItem();
                  console.log('[Survival] 🪣 Water reclaimed!');
                }
              }
            } catch {}
            this._saving = false;
          }, 600);
        }, 50);
      }, 50);
      return;
    }

    // 船
    const boat = this.bot.inventory.items().find(i => i.name.includes('boat'));
    if (boat) {
      console.log('[Survival] 🚣 Boat!');
      this.bot.equip(boat, 'hand').catch(() => {});
      setTimeout(() => {
        this.bot.lookAt(below, true).catch(() => {});
        setTimeout(() => {
          this.bot.activateItem();
          this._saving = false;
        }, 50);
      }, 50);
      return;
    }

    // 干草块 / 黏液块 / 蜂蜜块
    const soft = this.bot.inventory.items().find(i => /hay|slime|honey/.test(i.name));
    if (soft) {
      console.log('[Survival] 🟫 Soft landing!');
      this.bot.equip(soft, 'hand').catch(() => {});
      setTimeout(() => {
        this.bot.lookAt(below, true).catch(() => {});
        setTimeout(() => {
          const ref = this.bot.blockAt(below.offset(0, -1, 0));
          if (ref && ref.name !== 'air' && ref.name !== 'cave_air') {
            this.bot.placeBlock(ref, require('vec3')(0, 1, 0)).catch(() => {});
          }
          this._saving = false;
        }, 50);
      }, 50);
      return;
    }

    // 末影珍珠
    const pearl = this.bot.inventory.items().find(i => i.name === 'ender_pearl');
    if (pearl) {
      console.log('[Survival] 💜 Ender Pearl!');
      this.bot.equip(pearl, 'hand').catch(() => {});
      setTimeout(() => {
        this.bot.lookAt(pos.offset(0, -10, 0), true).catch(() => {});
        setTimeout(() => {
          this.bot.activateItem();
          this._saving = false;
        }, 50);
      }, 50);
      return;
    }

    // 什么都没有
    this.bot.setControlState('jump', true);
    setTimeout(() => { try { this.bot?.setControlState('jump', false); } catch {} }, 500);
    this._saving = false;
  }

  reset() { this.cooldown = 0; this._saving = false; }
}

module.exports = { FallSave };

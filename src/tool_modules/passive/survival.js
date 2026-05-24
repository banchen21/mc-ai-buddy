/**
 * 被动子模块 — 生存响应
 *
 * 职责：饥饿自动进食、自动治疗
 */
class SurvivalPassive {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** 注册所有生存相关事件 */
  init() {
    this._onHungry();
  }

  // ===== 事件监听 =====

  /** 饥饿时自动进食 */
  _onHungry() {
    this.ctx.bot.on('health', () => {
      if (!this.ctx.enabled) return;
      const food = Math.round(this.ctx.bot.food);
      if (food > 6) return;

      const foodNames = [
        'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
        'cooked_mutton', 'cooked_rabbit', 'cooked_cod',
        'cooked_salmon', 'bread', 'apple', 'golden_apple',
        'golden_carrot', 'baked_potato', 'beetroot_soup',
        'mushroom_stew', 'pumpkin_pie', 'cookie',
      ];
      const foodItem = this.ctx.bot.inventory.items().find(i =>
        foodNames.some(f => i.name.includes(f))
      );
      if (!foodItem) return;

      if (this.ctx.onCooldown('eat', 30000)) return;

      this.ctx.bot.equip(foodItem, 'hand').then(() => {
        this.ctx.bot.consume().catch(() => {});
      });
      this.ctx.injectEvent(`饥饿 (饱食度:${food})，已自动进食 ${foodItem.name}`);
      this.ctx.memory?.remember(`[生存] 自动进食 ${foodItem.name}`);
    });
  }
}

module.exports = { SurvivalPassive };

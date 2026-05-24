/**
 * #10 饱食度归零 (Starving)
 * 触发：饥饿 = 0 → 紧急吃任何食物 / 猎杀动物取肉 / 通知调度器
 */
const FOOD_RANK = [
  'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
  'cooked_cod', 'cooked_salmon', 'baked_potato', 'golden_carrot',
  'beef', 'porkchop', 'chicken', 'mutton', 'bread', 'apple',
  'carrot', 'potato', 'melon_slice', 'cod', 'salmon', 'cookie',
  'pumpkin_pie', 'rabbit_stew', 'mushroom_stew',
  'rotten_flesh', 'spider_eye',
];

class Starving {
  constructor(bot, deps) {
    this.bot = bot;
    this.deps = deps;
    this.active = false;
    this.notified = false;
  }

  check() {
    if (typeof this.bot.food === 'number' && this.bot.food > 0) {
      this.active = false; this.notified = false; return false;
    }
    if (this.active) return true;
    console.log('[Survival] 💀 #10 STARVING! Food=0');
    this.active = true;

    let any = null;
    for (const name of FOOD_RANK) {
      const item = this.bot.inventory.items().find(i => i.name === name);
      if (item) { any = item; break; }
    }
    if (any) {
      this.bot.equip(any, 'hand').then(() => this.bot.consume()).catch(() => {});
      this.active = false;
      return false;
    }

    if (!this.notified) {
      this.notified = true;
      console.log('[Survival] 🆘 #10 No food! Notifying scheduler...');
      if (this.deps._onStarving) this.deps._onStarving();
    }

    this._hunt();
    return true;
  }

  _hunt() {
    try {
      const huntable = /chicken|cow|pig|sheep|rabbit|cod|salmon|tropical_fish/;
      const prey = this.bot.nearestEntity(e => e.type === 'mob' && huntable.test(e.name || '') && this.bot.entity.position.distanceTo(e.position) < 16);
      if (!prey) return;
      console.log(`[Survival] 🏹 #10 Hunting ${prey.name || '?'} for food!`);
      const weapon = this.bot.inventory.items().find(i => /sword|axe/.test(i.name));
      if (weapon) this.bot.equip(weapon, 'hand').catch(() => {});
      if (this.bot.pvp) this.bot.pvp.attack(prey).catch(() => {});
      else { this.bot.lookAt(prey.position.offset(0, 1, 0), true).catch(() => {}); this.bot.attack(prey).catch(() => {}); }
    } catch (err) { console.error('[Survival] hunt:', err.message); }
  }

  reset() { this.active = false; this.notified = false; }
}

module.exports = { Starving };

/**
 * #9 自动进食 (Auto Eat)
 * 触发：饥饿 < 6 且不在战斗 → 自动吃最佳食物（不中断任务）
 */
const FOOD_RANK = [
  'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
  'cooked_cod', 'cooked_salmon', 'baked_potato', 'golden_carrot', 'golden_apple',
  'beef', 'porkchop', 'chicken', 'mutton', 'bread', 'apple',
  'carrot', 'potato', 'melon_slice', 'cod', 'salmon', 'cookie',
  'pumpkin_pie', 'rabbit_stew', 'mushroom_stew', 'beetroot_soup',
  'dried_kelp', 'sweet_berries', 'glow_berries', 'chorus_fruit',
  'rotten_flesh', 'spider_eye',
];

class AutoEat {
  constructor(bot, deps) {
    this.bot = bot;
    this.deps = deps;
    this.cooldown = 0;
  }

  check(now) {
    if (typeof this.bot.food !== 'number' || this.bot.food >= 6) return false;
    if (now - this.cooldown < 3000) return false;
    if (this.deps.memory?.perception?.underAttack) return false;

    let best = null;
    for (const name of FOOD_RANK) {
      const item = this.bot.inventory.items().find(i => i.name === name);
      if (item) {
        if ((name === 'rotten_flesh' || name === 'spider_eye') && best) continue;
        best = item; break;
      }
    }
    if (!best) return false;

    console.log(`[Survival] 🍖 #9 Auto-eat: ${best.name} (food: ${Math.round(this.bot.food)})`);
    this._eat(best);
    this.cooldown = now;
    return false; // 不中断任务
  }

  async _eat(food) {
    try {
      try { this.bot?.pathfinder?.setGoal(null); } catch {}
      await this.bot.equip(food, 'hand');
      await this.bot.consume();
    } catch (err) { console.error('[Survival] eat:', err.message); }
  }

  reset() { this.cooldown = 0; }
}

module.exports = { AutoEat };

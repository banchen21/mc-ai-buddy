/**
 * #11 工具切换 (Tool Switch)
 * 触发：手上工具耐久 < 10% → 自动切换同类最佳工具
 */
class ToolSwitch {
  constructor(bot) {
    this.bot = bot;
    this.cooldown = 0;
  }

  check(now) {
    if (now - this.cooldown < 2000) return;
    this.cooldown = now;
    try {
      const held = this.bot.inventory.slots[this.bot.getEquipmentDestSlot('hand')];
      if (!held) return;
      if (!/pickaxe|axe|shovel|hoe|sword|shears|fishing_rod|flint_and_steel|trident|bow|crossbow/.test(held.name)) return;
      const dur = this._getDurability(held);
      const max = this._getMaxDurability(held);
      if (dur === null || max === null || dur / max > 0.1) return;
      const type = this._getType(held.name);
      const alts = this.bot.inventory.items().filter(i => i !== held && this._getType(i.name) === type);
      if (!alts.length) { console.log(`[Survival] 🔧 #11 No backup ${type}!`); return; }
      const best = alts.reduce((a, b) => (this._getDurability(a) || 0) > (this._getDurability(b) || 0) ? a : b);
      console.log(`[Survival] 🔧 #11 Switch: ${held.name} → ${best.name}`);
      this.bot.equip(best, 'hand').catch(() => {});
    } catch (err) { console.error('[Survival] toolSwitch:', err.message); }
  }

  _getDurability(item) {
    try {
      if (item.nbt?.value?.Damage?.value !== undefined) return item.nbt.value.Damage.value;
      if (item.metadata !== undefined && item.metadata < 0) return -item.metadata;
      return null;
    } catch { return null; }
  }

  _getMaxDurability(item) {
    try {
      const mcData = require('minecraft-data')(this.bot.version);
      return mcData.items[item.type]?.maxDurability || null;
    } catch { return null; }
  }

  _getType(name) {
    if (/pickaxe/.test(name)) return 'pickaxe';
    if (/axe/.test(name)) return 'axe';
    if (/shovel/.test(name)) return 'shovel';
    if (/hoe/.test(name)) return 'hoe';
    if (/sword/.test(name)) return 'sword';
    if (/shears/.test(name)) return 'shears';
    if (/fishing_rod/.test(name)) return 'fishing_rod';
    if (/flint_and_steel/.test(name)) return 'flint_and_steel';
    if (/trident/.test(name)) return 'trident';
    if (/bow/.test(name) && !/crossbow/.test(name)) return 'bow';
    if (/crossbow/.test(name)) return 'crossbow';
    return 'other';
  }

  reset() { this.cooldown = 0; }
}

module.exports = { ToolSwitch };

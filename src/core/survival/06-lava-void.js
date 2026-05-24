/**
 * #6 岩浆/虚空拯救 (Lava/Void Escape)
 * 触发：脚下方块是岩浆，或脚下连续 5 格空气 → 疾跑跳跃+水桶/垫方块
 */
const { Movements, goals } = require('mineflayer-pathfinder');

class LavaVoidEscape {
  constructor(bot) {
    this.bot = bot;
    this.cooldown = 0;
  }

  check(now) {
    if (now - this.cooldown < 1000) return false;
    try {
      const pos = this.bot.entity.position;
      const foot = this.bot.blockAt(pos.floored().offset(0, -1, 0));
      if (foot && (foot.name === 'lava' || foot.name === 'flowing_lava')) {
        console.log('[Survival] 🔥 #6 LAVA!');
        this._escapeLava();
        this.cooldown = now;
        return true;
      }
      let allAir = true;
      for (let dy = -1; dy >= -5; dy--) {
        const b = this.bot.blockAt(pos.floored().offset(0, dy, 0));
        if (b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') { allAir = false; break; }
      }
      if (allAir) {
        console.log(`[Survival] 🕳️ #6 VOID! y=${Math.round(pos.y)}`);
        this._escapeVoid();
        this.cooldown = now;
        return true;
      }
    } catch {}
    return false;
  }

  async _escapeLava() {
    try {
      const water = this.bot.inventory.items().find(i => i.name === 'water_bucket');
      if (water) {
        await this.bot.equip(water, 'hand');
        const fp = this.bot.entity.position.floored().offset(0, -1, 0);
        const ref = this.bot.blockAt(fp.offset(0, -1, 0));
        if (ref) await this.bot.placeBlock(ref, require('vec3')(0, 1, 0));
      }
      const mcData = require('minecraft-data')(this.bot.version);
      const moves = new Movements(this.bot, mcData);
      moves.canDig = true; moves.canSwim = true;
      this.bot.pathfinder.setMovements(moves);
      const solidIds = Object.entries(mcData.blocksByName)
        .filter(([n, b]) => !n.includes('air') && !n.includes('water') && !n.includes('lava') && !n.includes('fire') && b.hardness > 0 && b.boundingBox === 'block')
        .map(([, b]) => b.id);
      if (solidIds.length) {
        const safe = this.bot.findBlock({ matching: solidIds, maxDistance: 10, count: 1 });
        if (safe) this.bot.pathfinder.setGoal(new goals.GoalNear(safe.position.x, safe.position.y + 1, safe.position.z, 1));
      }
      this.bot.setControlState('jump', true);
      setTimeout(() => {
        try { this.bot?.setControlState('jump', false); } catch {}
        try { this.bot?.pathfinder?.setGoal(null); } catch {}
      }, 3000);
    } catch (err) { console.error('[Survival] lava:', err.message); }
  }

  async _escapeVoid() {
    try {
      const pearl = this.bot.inventory.items().find(i => i.name === 'ender_pearl');
      if (pearl) {
        await this.bot.equip(pearl, 'hand');
        const mcData = require('minecraft-data')(this.bot.version);
        const solidIds = Object.entries(mcData.blocksByName)
          .filter(([n, b]) => !n.includes('air') && b.hardness > 0 && b.boundingBox === 'block')
          .map(([, b]) => b.id);
        if (solidIds.length) {
          const wall = this.bot.findBlock({ matching: solidIds, maxDistance: 32, count: 1 });
          if (wall) { await this.bot.lookAt(wall.position, true); await this.bot.activateItem(); return; }
        }
      }
      const scaffold = this.bot.inventory.items().find(i => /dirt|cobblestone|stone|netherrack|end_stone|planks/.test(i.name));
      if (scaffold) {
        await this.bot.equip(scaffold, 'hand');
        const below = this.bot.blockAt(this.bot.entity.position.floored().offset(0, -1, 0));
        if (below) await this.bot.placeBlock(below, require('vec3')(0, 1, 0));
      }
    } catch (err) { console.error('[Survival] void:', err.message); }
  }

  reset() { this.cooldown = 0; }
}

module.exports = { LavaVoidEscape };

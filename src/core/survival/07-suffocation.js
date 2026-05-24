/**
 * #7 窒息自救 (Suffocation)
 * 触发：头部在固体方块内 → 持续跳跃挖掘头顶
 */
class Suffocation {
  constructor(bot) {
    this.bot = bot;
    this.active = false;
    this._digTarget = null; // 正在挖的方块位置
  }

  check() {
    try {
      const head = this.bot.blockAt(this.bot.entity.position.floored().offset(0, 1, 0));
      if (!head) return false;
      const isSolid = head.name !== 'air' && head.name !== 'cave_air' && head.name !== 'void_air' && head.name !== 'water' && head.name !== 'lava' && head.boundingBox === 'block';
      if (!isSolid) {
        if (this.active) { console.log('[Survival] 🫁 #7 Freed!'); this._stop(); }
        return false;
      }
      if (this.active) { this._continueDig(head); return true; }
      console.log(`[Survival] 🫁 #7 Suffocating! Block: ${head.name}`);
      this.active = true;
      this._dig(head);
      return true;
    } catch { return false; }
  }

  _dig(block) {
    try {
      this._digTarget = block.position.clone();
      const tool = this.bot.inventory.items().find(i => /pickaxe|shovel/.test(i.name));
      if (tool) this.bot.equip(tool, 'hand').catch(() => {});
      this.bot.lookAt(block.position, true).catch(() => {});
      this.bot.setControlState('jump', true);
      setTimeout(() => {
        try {
          if (this._digTarget) this.bot.dig(block).catch(() => {});
        } catch {}
      }, 100);
    } catch (err) { console.error('[Survival] suffocate:', err.message); }
  }

  _continueDig(head) {
    try {
      if (this._digTarget && this._digTarget.equals(head.position)) return;
      this._digTarget = head.position.clone();
      this.bot.setControlState('jump', true);
      // 如果 pathfinder 正在运行，先停掉避免冲突
      try { this.bot.pathfinder?.setGoal(null); } catch {}
      this.bot.dig(head).catch(() => {});
    } catch {}
  }

  _stop() {
    this.active = false;
    this._digTarget = null;
    try { this.bot?.stopDigging(); } catch {}
    try { this.bot?.clearControlStates(); } catch {}
  }

  reset() { this._stop(); }
}

module.exports = { Suffocation };

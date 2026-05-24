/**
 * 🛡️ SurvivalInstinct — 生存本能调度器
 *
 * 协调 12 个独立模块，按优先级执行检查
 * 每 50ms 由主循环调用一次
 */

const { DamageDodge } = require('./survival/01-damage-dodge');
const { LowHpFlee } = require('./survival/02-low-hp-flee');
const { CreeperWarning } = require('./survival/03-creeper-warning');
const { ProjectileDodge } = require('./survival/04-projectile-dodge');
const { FallSave } = require('./survival/05-fall-save');
const { LavaVoidEscape } = require('./survival/06-lava-void');
const { Suffocation } = require('./survival/07-suffocation');
const { Drowning } = require('./survival/08-drowning');
const { AutoEat } = require('./survival/09-auto-eat');
const { Starving } = require('./survival/10-starving');
const { ToolSwitch } = require('./survival/11-tool-switch');
const { ArmorReplace } = require('./survival/12-armor-replace');

class SurvivalInstinct {
  constructor(bot, deps) {
    this.bot = bot;
    this.deps = deps;

    // 初始化 12 个模块
    this.modules = {
      damageDodge: new DamageDodge(bot, deps),
      lowHpFlee: new LowHpFlee(bot, deps),
      creeperWarning: new CreeperWarning(bot),
      projectileDodge: new ProjectileDodge(bot),
      fallSave: new FallSave(bot),
      lavaVoid: new LavaVoidEscape(bot),
      suffocation: new Suffocation(bot),
      drowning: new Drowning(bot),
      autoEat: new AutoEat(bot, deps),
      starving: new Starving(bot, deps),
      toolSwitch: new ToolSwitch(bot),
      armorReplace: new ArmorReplace(bot),
    };

    /** 伤害追踪 */
    this.lastDamageTime = 0;
    this.lastDamageAmount = 0;
    this.damageInLastSecond = 0;
    this._damageWindow = [];

    /** 是否激活 */
    this.active = false;
    this.activeReason = 'none';

    /** 调试 */
    this._lastDebugLog = 0;
  }

  /** 记录受伤 */
  recordDamage(amount) {
    const now = Date.now();
    this.lastDamageTime = now;
    this.lastDamageAmount = amount;
    this._damageWindow.push({ time: now, amount });
    this._damageWindow = this._damageWindow.filter(d => now - d.time < 1000);
    this.damageInLastSecond = this._damageWindow.reduce((s, d) => s + d.amount, 0);
  }

  /** 每帧检查 */
  check() {
    if (!this.bot?.entity) return false;
    const now = Date.now();

    // 调试日志
    if (now - this._lastDebugLog > 1000) {
      this._lastDebugLog = now;
      const threat = this._findThreat();
      console.log(`[Survival] 📊 HP:${Math.round(this.bot.health)} Food:${Math.round(this.bot.food)} ` +
        `Active:${this.active}(${this.activeReason}) Dmg:${this.lastDamageAmount} ` +
        `Threat:${threat?.name || 'none'}`);
    }

    // ===== 已激活 → 让模块自己判断是否继续 =====
    if (this.active) {
      // 让当前激活的模块自己决定是否继续
      const stillActive = this._checkActiveModule(now);
      if (!stillActive) {
        this._deactivate();
        return false;
      }
      return true;
    }

    // ===== 按优先级检查各模块 =====
    const { lavaVoid, fallSave, suffocation, drowning, creeperWarning, projectileDodge, lowHpFlee, damageDodge, starving, autoEat, toolSwitch, armorReplace } = this.modules;

    // 环境危险（硬中断）
    if (lavaVoid.check(now)) { this._activate('lava_void'); return true; }
    if (fallSave.check(now)) { this._activate('falling'); return true; }
    if (suffocation.check()) { this._activate('suffocation'); return true; }
    if (drowning.check(now)) { this._activate('drowning'); return true; }

    // 战斗危险（硬中断）
    // #2 残血优先：HP < 6 时用专门的逃脱逻辑
    if (lowHpFlee.check(now)) { this._activate('low_hp_flee'); return true; }
    // #1 通用受击闪避：已内置近战/远程/爆炸三分类
    if (damageDodge.check(now, this.lastDamageTime, this.lastDamageAmount, this.damageInLastSecond)) { this._activate('damage_dodge'); return true; }
    // #3 #4 作为补充（damageDodge 未激活时才独立触发）
    if (creeperWarning.check()) { this._activate('creeper_warning'); return true; }
    if (projectileDodge.check(now)) { this._activate('projectile_dodge'); return true; }

    // 生理维持（硬中断）
    if (starving.check()) { this._activate('starving'); return true; }

    // 被动检测（不中断）
    autoEat.check(now);
    toolSwitch.check(now);
    armorReplace.check(now);

    // 更新坠落追踪
    fallSave.track(now);

    return false;
  }

  /** 让当前激活的模块自己判断是否继续 */
  _checkActiveModule(now) {
    // 如果 HP < 6 且当前不是 low_hp_flee，降级到残血逃脱
    if (this.activeReason !== 'low_hp_flee' && this.bot.health < 6 && this.bot.health > 0) {
      const underAttack = this.deps.memory?.perception?.underAttack;
      if (underAttack) {
        console.log(`[Survival] ⬇️ Downgrade to low_hp_flee (HP=${Math.round(this.bot.health)})`);
        this._deactivate();
        if (this.modules.lowHpFlee.check(now)) {
          this._activate('low_hp_flee');
          return true;
        }
        return false;
      }
    }

    switch (this.activeReason) {
      case 'damage_dodge':
        return this.modules.damageDodge.check(now, this.lastDamageTime, this.lastDamageAmount, this.damageInLastSecond);
      case 'low_hp_flee':
        this.modules.lowHpFlee.continueFlee(now);
        return this.modules.lowHpFlee.fleeing;
      case 'creeper_warning':
        return this.modules.creeperWarning.check();
      case 'projectile_dodge':
        return this.modules.projectileDodge.check(now);
      case 'falling':
        return this.modules.fallSave.check(now);
      case 'lava_void':
        return this.modules.lavaVoid.check(now);
      case 'suffocation':
        return this.modules.suffocation.check();
      case 'drowning':
        return this.modules.drowning.check(now);
      case 'starving':
        return this.modules.starving.check();
      default:
        return false;
    }
  }

  _findThreat() {
    const harmless = /squid|bat|cod|salmon|tropical_fish|pufferfish|glow_squid|tadpole|axolotl|turtle|dolphin|villager|wandering_trader|iron_golem|snow_golem|cat|ocelot|wolf|fox|bee|chicken|cow|pig|sheep|rabbit|horse|donkey|mule|llama|trader_llama|parrot|panda|polar_bear|goat|frog|allay|camel|sniffer|armadillo/;
    return this.bot.nearestEntity(e => e.type === 'mob' && !harmless.test(e.name || '') && this.bot.entity.position.distanceTo(e.position) < 16);
  }

  _activate(reason) {
    this.active = true;
    this.activeReason = reason;
    console.log(`[Survival] 🔴 Activated: ${reason}`);
  }

  _deactivate() {
    this.active = false;
    this.activeReason = 'none';
    // 清理各模块的持续状态
    try { this.modules.lowHpFlee.fleeing = false; } catch {}
    try { this.modules.damageDodge.active = false; } catch {}
    try { this.bot?.pathfinder?.setGoal(null); } catch {}
    try { this.bot?.clearControlStates(); } catch {}
    try { this.deps.memory?.perception?.clearThreat(); } catch {}
    console.log('[Survival] 🟢 Deactivated');
  }

  /** 完全重置（死亡/重生时调用） */
  reset() {
    this.active = false;
    this.activeReason = 'none';
    this.lastDamageTime = 0;
    this.lastDamageAmount = 0;
    this.damageInLastSecond = 0;
    this._damageWindow = [];
    for (const m of Object.values(this.modules)) m.reset();
    try { this.bot?.pathfinder?.setGoal(null); } catch {}
    try { this.bot?.clearControlStates(); } catch {}
    console.log('[Survival] 🔄 Reset');
  }

  getStatus() {
    return {
      active: this.active,
      reason: this.activeReason,
      hp: Math.round(this.bot?.health || 0),
      food: Math.round(this.bot?.food || 0),
      lastDamage: this.lastDamageAmount,
      damageIn1s: this.damageInLastSecond,
    };
  }
}

module.exports = { SurvivalInstinct };

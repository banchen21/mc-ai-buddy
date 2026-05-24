/**
 * #1 受击闪避 (Damage Dodge) — 按威胁类型分类响应
 *
 * 【近战】僵尸/蜘蛛/末影人等：
 *   直接 lookAt 反方向 + 疾跑（不用 pathfinder，更快更流畅）
 *
 * 【远程】骷髅/烈焰人/恶魂/女巫等：
 *   蛇形走位（A/D 随机交替），并向最近掩体移动
 *
 * 【爆炸】苦力怕/TNT等：
 *   立刻向伤害来源反方向疾跑
 */

const { Movements, goals } = require('mineflayer-pathfinder');

const HARMLESS = /squid|bat|cod|salmon|tropical_fish|pufferfish|glow_squid|tadpole|axolotl|turtle|dolphin|villager|wandering_trader|iron_golem|snow_golem|cat|ocelot|wolf|fox|bee|chicken|cow|pig|sheep|rabbit|horse|donkey|mule|llama|trader_llama|parrot|panda|polar_bear|goat|frog|allay|camel|sniffer|armadillo/;

/** 远程攻击型生物 */
const RANGED_MOBS = /skeleton|stray|blaze|ghast|shulker|witch|guardian|elder_guardian|breeze|pillager|evoker|illusioner/;

/** 可作掩体的方块 */
const COVER_NAMES = [
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
  'stone', 'cobblestone', 'dirt', 'grass_block', 'sandstone',
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves',
  'deepslate', 'tuff', 'andesite', 'diorite', 'granite',
];

class DamageDodge {
  constructor(bot, deps) {
    this.bot = bot;
    this.deps = deps;
    this.active = false;
    this.threatType = null;   // 'melee' | 'ranged' | 'explosive'
    this.threat = null;
    this._activatedAt = 0;    // 激活时刻（30s 硬上限）
    this._lastRespond = 0;
    this._lastClassify = 0;
    this._safeSince = 0;
    this._lastStrafeSwitch = 0;
    this._strafeDir = 1;
    this._coverTarget = null;
    this._lastCoverScan = 0;
    this._lastFleeDir = null;
    this._lastRealDamageTime = 0; // 排除饥饿后的真实受伤时间
  }

  check(now, lastDamageTime, lastDamageAmount, damageInLastSecond) {
    // ===== 激活：受伤（排除饥饿/坠落/环境伤害）=====
    const isStarvation = this.bot.food === 0 && lastDamageAmount <= 1;
    // 只有 10 格内有威胁实体时才触发战斗闪避
    // 远处的实体不可能造成近战伤害，坠落/火焰等环境伤害不应触发
    const threat = this._findThreat();
    const hasNearThreat = threat && this.bot.entity.position.distanceTo(threat.position) <= 10;
    if (!this.active && lastDamageAmount > 0 && now - lastDamageTime < 500 && !isStarvation && hasNearThreat) {
      this.active = true;
      this._activatedAt = now;
      this._safeSince = 0;
      this._lastRespond = 0;
      this._lastClassify = 0;
      this._lastCoverScan = 0;
      this._lastStrafeSwitch = 0;
      this._coverTarget = null;
      this._lastFleeDir = null;
      this._classify();
      console.log(`[Survival] ⚔️ #1 Damage Dodge! Type=${this.threatType} Dmg=${lastDamageAmount}`);
    }

    if (!this.active) return false;

    // ===== 定期重新评估威胁类型（每 600ms）=====
    if (now - this._lastClassify > 600) {
      this._lastClassify = now;
      this._classify();
    }

    // ===== 安全判定 =====
    const isSafe = this._isNowSafe(now);
    if (isSafe) {
      if (this._safeSince === 0) {
        this._safeSince = now;
        console.log(`[Survival] ⚔️ #1 Safe countdown started`);
      }
      // 倒计时期间如果威胁靠近到 5 格内 → 重置，继续跑
      const threat = this._findThreat();
      if (threat && this.bot.entity.position.distanceTo(threat.position) <= 5) {
        this._safeSince = 0;
        console.log(`[Survival] ⚔️ #1 Threat nearby, reset countdown`);
      } else if (now - this._safeSince >= 1000) {
        this._stop();
        return false;
      }
    } else {
      this._safeSince = 0;
    }

    // ===== 执行分类响应 =====
    this._respond(now);
    return true;
  }

  // ──────────────────────────────────────
  //  威胁分类
  // ──────────────────────────────────────

  _classify() {
    const threat = this._findThreat();
    this.threat = threat;

    if (!threat) {
      this.threatType = this.threatType || 'melee';
      return;
    }

    const name = (threat.name || '').toLowerCase();
    const dist = this.bot.entity.position.distanceTo(threat.position);

    if (name === 'creeper') {
      if (this._isIgnited(threat)) {
        this.threatType = 'explosive';
        return;
      }
      if (dist <= 4) {
        this.threatType = 'explosive';
        return;
      }
    }

    if (name === 'tnt' || name === 'tnt_minecart') {
      this.threatType = 'explosive';
      return;
    }

    if (RANGED_MOBS.test(name)) {
      if (dist > 3 || name === 'blaze' || name === 'ghast') {
        this.threatType = 'ranged';
        return;
      }
    }

    this.threatType = 'melee';
  }

  // ──────────────────────────────────────
  //  安全判定
  // ──────────────────────────────────────

  _isNowSafe(now) {
    const threat = this._findThreat();

    // 威胁在 5 格内 → 永远不安全
    if (threat && this.bot.entity.position.distanceTo(threat.position) <= 5) return false;

    // 威胁存在但 > 5 格 → 跑了 3 秒就行
    if (threat) return now - this._activatedAt > 3000;

    // 无威胁 → 跑了 5 秒才行（扫不到不代表安全，可能只是超出渲染距离）
    return now - this._activatedAt > 5000;
  }

  // ──────────────────────────────────────
  //  分类响应调度
  // ──────────────────────────────────────

  _respond(now) {
    switch (this.threatType) {
      case 'melee':
        this._respondMelee(now);
        break;
      case 'ranged':
        this._respondRanged(now);
        break;
      case 'explosive':
        this._respondExplosive(now);
        break;
    }
  }

  // ──────────────────────────────────────
  //  近战响应：pathfinder 寻路逃跑（不跳跃，纯疾跑）
  // ──────────────────────────────────────

  _respondMelee(now) {
    // 每 250ms 更新寻路目标（但如果正在挖掘就跳过，避免打断挖掘动画）
    if (now - this._lastRespond < 250) return;
    if (this.bot.targetDigBlock) return; // 正在挖掘，等挖完再更新目标
    this._lastRespond = now;

    const pos = this.bot.entity.position;
    const threat = this._findThreat();

    let tx, tz;
    if (threat) {
      const away = pos.clone().subtract(threat.position);
      away.y = 0;
      const dir = away.normalize();
      tx = pos.x + dir.x * 20;
      tz = pos.z + dir.z * 20;
      this._lastFleeDir = { x: dir.x, z: dir.z };
    } else if (this._lastFleeDir) {
      tx = pos.x + this._lastFleeDir.x * 20;
      tz = pos.z + this._lastFleeDir.z * 20;
    } else {
      const a = Math.random() * Math.PI * 2;
      this._lastFleeDir = { x: Math.cos(a), z: Math.sin(a) };
      tx = pos.x + this._lastFleeDir.x * 20;
      tz = pos.z + this._lastFleeDir.z * 20;
    }

    try {
      const mcData = require('minecraft-data')(this.bot.version);
      const moves = new Movements(this.bot, mcData);
      moves.canDig = true;
      moves.canSwim = true;
      moves.allowParkour = true;
      moves.digCost = 1;       // 降低挖掘成本，优先挖而不是绕远路
      moves.placeCost = 1000;  // 不放方块
      this.bot.pathfinder.setMovements(moves);
      this.bot.pathfinder.setGoal(new goals.GoalNear(tx, pos.y, tz, 3));
      // 疾跑不跳跃
      this.bot.setControlState('sprint', true);
      this.bot.setControlState('jump', false);
    } catch (err) {
      console.error('[Survival] melee flee:', err.message);
    }
  }

  // ──────────────────────────────────────
  //  远程响应：蛇形走位 + 向掩体移动
  // ──────────────────────────────────────

  _respondRanged(now) {
    // 每 200~400ms 随机切换横移方向
    if (now - this._lastStrafeSwitch > 200 + Math.random() * 200) {
      this._strafeDir = Math.random() > 0.5 ? 1 : -1;
      this._lastStrafeSwitch = now;
    }

    this.bot.setControlState('forward', true);
    this.bot.setControlState('sprint', true);
    this.bot.setControlState('left', this._strafeDir < 0);
    this.bot.setControlState('right', this._strafeDir > 0);
    this.bot.setControlState('jump', Math.random() > 0.7);

    // 每 ~600ms 找掩体
    if (now - this._lastCoverScan > 600) {
      this._lastCoverScan = now;
      this._coverTarget = this._findCover();
      if (this._coverTarget) {
        console.log(`[Survival] 🛡️ #1 Cover: ${Math.round(this._coverTarget.x)},${Math.round(this._coverTarget.y)},${Math.round(this._coverTarget.z)}`);
      }
    }

    // 向掩体寻路
    if (this._coverTarget) {
      try {
        const mcData = require('minecraft-data')(this.bot.version);
        const moves = new Movements(this.bot, mcData);
        moves.canDig = true; moves.canSwim = true; moves.allowParkour = true;
        this.bot.pathfinder.setMovements(moves);
        this.bot.pathfinder.setGoal(
          new goals.GoalNear(this._coverTarget.x, this._coverTarget.y, this._coverTarget.z, 1)
        );
      } catch {}
    } else {
      this._movePerpendicular(now);
    }
  }

  _movePerpendicular(now) {
    if (now - this._lastRespond < 300) return;
    this._lastRespond = now;
    const threat = this._findThreat();
    if (!threat) return;

    const pos = this.bot.entity.position;
    const toThreat = threat.position.clone().subtract(pos);
    const perpX = -toThreat.z;
    const perpZ = toThreat.x;
    const len = Math.sqrt(perpX * perpX + perpZ * perpZ) || 1;

    try {
      const mcData = require('minecraft-data')(this.bot.version);
      const moves = new Movements(this.bot, mcData);
      moves.canDig = true; moves.canSwim = true; moves.allowParkour = true;
      this.bot.pathfinder.setMovements(moves);
      this.bot.pathfinder.setGoal(
        new goals.GoalNear(
          pos.x + (perpX / len) * this._strafeDir * 8,
          pos.y,
          pos.z + (perpZ / len) * this._strafeDir * 8,
          2
        )
      );
    } catch {}
  }

  // ──────────────────────────────────────
  //  爆炸响应：反方向疾跑
  // ──────────────────────────────────────

  _respondExplosive(now) {
    if (now - this._lastRespond < 100) return;
    this._lastRespond = now;

    const threat = this._findThreat();

    if (threat) {
      const pos = this.bot.entity.position;
      const away = pos.clone().subtract(threat.position);
      away.y = 0;
      const target = pos.clone().add(away.normalize().scale(10));
      this.bot.lookAt(target, true).catch(() => {});
    }

    this.bot.setControlState('forward', true);
    this.bot.setControlState('sprint', true);
    this.bot.setControlState('jump', true);
  }

  // ──────────────────────────────────────
  //  工具方法
  // ──────────────────────────────────────

  _findCover() {
    try {
      const mcData = require('minecraft-data')(this.bot.version);
      const ids = [];
      for (const name of COVER_NAMES) {
        const b = mcData.blocksByName[name];
        if (b) ids.push(b.id);
      }
      if (!ids.length) return null;

      const blocks = this.bot.findBlocks({
        matching: ids,
        maxDistance: 16,
        count: 15,
      });

      if (!blocks || !blocks.length) return null;

      const pos = this.bot.entity.position;
      let best = null;
      let bestScore = Infinity;

      for (const b of blocks) {
        const dist = pos.distanceTo(b);
        if (dist < 1) continue;
        const yDiff = Math.abs(b.y - pos.y);
        if (yDiff > 4) continue;
        let score = dist + yDiff * 2;
        if (this.threat) {
          const threatDir = this.threat.position.clone().subtract(pos).normalize();
          const coverDir = b.clone().subtract(pos).normalize();
          const dot = threatDir.x * coverDir.x + threatDir.z * coverDir.z;
          if (dot > 0.3) score += 10;
        }
        if (score < bestScore) {
          bestScore = score;
          best = b;
        }
      }
      return best;
    } catch {
      return null;
    }
  }

  _isIgnited(creeper) {
    try {
      if (creeper.metadata) {
        for (const [key, value] of creeper.metadata) {
          if ((key === 16 || key === 17) && value === true) return true;
        }
      }
      return this.bot.entity.position.distanceTo(creeper.position) <= 2;
    } catch {
      return this.bot.entity.position.distanceTo(creeper.position) <= 2;
    }
  }

  _findThreat() {
    const myPos = this.bot.entity.position;
    let closest = null;
    let closestDist = Infinity;
    for (const [, e] of Object.entries(this.bot.entities)) {
      if (!e || e === this.bot.entity) continue;
      // 扫描 mob 和 player（玩家也可能是攻击者）
      if (e.type !== 'mob' && e.type !== 'player') continue;
      if (e.username === this.bot.username) continue;
      if (HARMLESS.test(e.name || '')) continue;
      const dist = myPos.distanceTo(e.position);
      if (dist < closestDist) {
        closestDist = dist;
        closest = e;
      }
    }
    return closest;
  }

  _stop() {
    this.active = false;
    this.threat = null;
    this.threatType = null;
    this._coverTarget = null;
    this._lastFleeDir = null;
    try { this.bot?.stopDigging(); } catch {}
    try { this.bot?.pathfinder?.setGoal(null); } catch {}
    try { this.bot?.clearControlStates(); } catch {}
    console.log('[Survival] ⚔️ #1 Safe — deactivated');
  }

  reset() { this._stop(); }
}

module.exports = { DamageDodge };

/**
 * 被动子模块 — 战斗响应
 *
 * 职责：受伤反击、逃跑、苦力怕闪避、低血量警告、死亡记录
 */
const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'enderman', 'witch', 'slime', 'phantom', 'drowned',
  'husk', 'stray', 'blaze', 'ghast', 'wither_skeleton',
  'hoglin', 'piglin', 'piglin_brute', 'zoglin',
  'vindicator', 'pillager', 'evoker', 'ravager', 'vex',
  'guardian', 'elder_guardian', 'warden',
];

class CombatPassive {
  constructor(ctx) {
    this.ctx = ctx;
    /** 最后攻击者信息 { name, type, position } */
    this._lastAttacker = null;
    /** 最后受伤时间 */
    this._lastDamageTime = 0;
    /** 是否在战斗中 */
    this._isFighting = false;
  }

  /** 注册所有战斗相关事件 */
  init() {
    this._onDamaged();
    this._onLowHealth();
    this._onEntityNearby();
    this._onDeath();
  }

  // ===== 事件监听 =====

  /** 受伤时自动反击或逃跑 + 记录攻击者 */
  _onDamaged() {
    this.ctx.bot.on('entityHurt', (entity) => {
      if (!this.ctx.enabled) return;
      if (entity !== this.ctx.bot.entity) return;

      const hp = Math.round(this.ctx.bot.health);
      this._lastDamageTime = Date.now();

      // 追踪攻击者：优先找最近的敌对实体，其次找最近的玩家
      const hostiles = this._getNearbyHostiles(8);
      if (hostiles.length > 0) {
        const nearest = hostiles[0];
        this._lastAttacker = {
          name: nearest.displayName || nearest.name || '未知生物',
          type: nearest.name || 'unknown',
          position: nearest.position,
          isPlayer: false,
        };
      } else {
        // 没有敌对生物 → 可能是玩家攻击，找最近的玩家
        const nearbyPlayer = this._getNearestPlayer(8);
        if (nearbyPlayer) {
          this._lastAttacker = {
            name: nearbyPlayer.username || '未知玩家',
            type: 'player',
            position: nearbyPlayer.entity?.position || null,
            isPlayer: true,
          };
        }
      }

      const attackerName = this._lastAttacker?.name || '未知来源';
      const attackerType = this._lastAttacker?.isPlayer ? `玩家 ${attackerName}` : attackerName;

      if (hp <= this.ctx.dodgeHpThreshold) {
        this._tryDodge();
        this.ctx.injectEvent(`血量危险 (${hp}/20)，受到 ${attackerType} 攻击，已自动逃跑`);
        return;
      }

      this._tryRetaliate();
      this.ctx.injectEvent(`受到 ${attackerType} 攻击 (HP:${hp}/20)，已自动反击`);
    });
  }

  /** 低血量持续提醒 */
  _onLowHealth() {
    let lastWarn = 0;
    this.ctx.bot.on('health', () => {
      if (!this.ctx.enabled) return;
      const hp = Math.round(this.ctx.bot.health);
      if (hp > 0 && hp <= 6 && Date.now() - lastWarn > 10000) {
        lastWarn = Date.now();
        this.ctx.memory?.remember(`[危险] 血量降至 ${hp}`);
      }
    });
  }

  /** 敌对生物靠近时提醒 */
  _onEntityNearby() {
    let lastAlert = 0;
    this.ctx.bot.on('physicsTick', () => {
      if (!this.ctx.enabled) return;
      if (Date.now() - lastAlert < 1000) return;

      const threats = this._getNearbyHostiles(this.ctx.threatRadius);
      if (threats.length === 0) return;

      lastAlert = Date.now();

      const creepers = threats.filter(t => t.name === 'creeper');
      if (creepers.length > 0) {
        this._tryDodge();
        this.ctx.injectEvent('苦力怕靠近，已自动闪避');
        return;
      }

      if (threats.length >= 3) {
        const names = threats.map(t => t.displayName || t.name).join(', ');
        this.ctx.say(`⚠️ ${threats.length} 只怪物在附近！`);
        this.ctx.injectEvent(`${threats.length} 只怪物在附近: ${names}`);
      }
    });
  }

  /** 死亡记录 — 由 index.js 统一处理，此处仅做战斗相关补充 */
  _onDeath() {
    this.ctx.bot.on('death', () => {
      // 保存攻击者信息供 index.js 读取
      this.ctx.lastAttacker = this._lastAttacker;
      // 清除战斗状态
      this._isFighting = false;
      this._lastDamageTime = 0;
    });
  }

  /** 苦力怕靠近时紧急闪避 */

  // ===== 辅助方法 =====

  _getNearbyHostiles(radius) {
    const entities = Object.values(this.ctx.bot.entities || {});
    const pos = this.ctx.bot.entity?.position;
    if (!pos) return [];

    return entities.filter(e => {
      if (e === this.ctx.bot.entity) return false;
      const name = (e.name || '').toLowerCase();
      if (!HOSTILE_MOBS.some(m => name.includes(m))) return false;
      const dist = pos.distanceTo(e.position);
      return dist <= radius;
    });
  }

  _tryDodge() {
    // 防止重复启动
    if (this._dodging) return;

    const threats = this._getNearbyHostiles(this.ctx.threatRadius);
    if (threats.length === 0) return;

    this._dodging = true;
    // 持续更新逃跑目标 + 安全阈值检查
    this._startDodgeLoop();
  }

  /** 持续逃跑循环：每 300ms 重新计算远离方向并检查安全 */
  _startDodgeLoop() {
    const SAFE_RADIUS = 8;
    const { goals } = require('mineflayer-pathfinder');

    this._dodgeInterval = setInterval(() => {
      if (!this._dodging) return;

      // 安全检查：8 格内无威胁则停止
      const nearby = this._getNearbyHostiles(SAFE_RADIUS);
      if (nearby.length === 0) {
        this._stopDodging();
        return;
      }

      // 计算远离所有威胁的平均方向
      const pos = this.ctx.bot.entity.position;
      let avgDx = 0, avgDz = 0;
      for (const t of nearby) {
        avgDx += pos.x - t.position.x;
        avgDz += pos.z - t.position.z;
      }
      const len = Math.sqrt(avgDx * avgDx + avgDz * avgDz) || 1;
      const targetX = Math.round(pos.x + (avgDx / len) * 12);
      const targetZ = Math.round(pos.z + (avgDz / len) * 12);

      this.ctx.bot.pathfinder.setGoal(new goals.GoalNearXZ(targetX, targetZ, 2));
    }, 300);

    this.ctx.memory?.remember('[生存] 开始逃跑');
  }

  /** 停止逃跑并清理 */
  _stopDodging() {
    this._dodging = false;
    this.ctx.bot.pathfinder.setGoal(null);
    if (this._dodgeInterval) {
      clearInterval(this._dodgeInterval);
      this._dodgeInterval = null;
    }
    this.ctx.memory?.remember('[生存] 逃跑结束，已脱离危险');
  }

  async _tryRetaliate() {
    if (this.ctx.onCooldown('retaliate', 3000)) return;

    const threats = this._getNearbyHostiles(5);
    if (threats.length === 0) return;

    const target = threats.sort((a, b) => {
      const da = this.ctx.bot.entity.position.distanceTo(a.position);
      const db = this.ctx.bot.entity.position.distanceTo(b.position);
      return da - db;
    })[0];

    const weaponNames = [
      'diamond_sword', 'iron_sword', 'stone_sword',
      'diamond_axe', 'iron_axe', 'stone_axe',
      'wooden_sword', 'golden_sword',
    ];
    const weapon = this.ctx.bot.inventory.items().find(i =>
      weaponNames.some(w => i.name.includes(w))
    );
    if (weapon) {
      try {
        await this.ctx.bot.equip(weapon, 'hand');
        this.ctx.bot.attack(target);
      } catch {}
    } else {
      try { this.ctx.bot.attack(target); } catch {}
    }

    this.ctx.memory?.remember(`[战斗] 反击 ${target.name || '未知生物'}`);
  }

  /** 找最近的玩家（排除 bot 自己） */
  _getNearestPlayer(radius) {
    const players = this.ctx.bot.players || {};
    const pos = this.ctx.bot.entity?.position;
    if (!pos) return null;

    let nearest = null;
    let nearestDist = radius;

    for (const [name, player] of Object.entries(players)) {
      if (name === this.ctx.bot.username) continue;
      if (!player.entity) continue;
      const dist = pos.distanceTo(player.entity.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = player;
      }
    }

    return nearest;
  }
}

module.exports = { CombatPassive };

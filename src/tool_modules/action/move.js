/**
 * 移动模块 — 基于 mineflayer-pathfinder
 *
 * 工具：
 *   goto / follow / goto_player / wander / stop / look_at / jump / find_block / sleep
 *
 * 依赖注入：
 *   deps.passiveModule — 用于检查闪避冲突
 *   deps.movements    — Movements 实例（可选，未传则自动创建默认）
 */
const { goals } = require('mineflayer-pathfinder');
const { Movements } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

class MoveModule {
  constructor(bot, deps = {}) {
    this.bot = bot;
    this.deps = deps;

    /** Movements 实例（由 index.js 注入或自动创建） */
    this._movements = null;
  }

  /**
   * 获取或懒初始化 Movements
   */
  _getMovements() {
    if (this._movements) return this._movements;
    // 优先使用注入的 movements
    if (this.deps.movements) {
      this._movements = this.deps.movements;
      return this._movements;
    }
    // 自动创建默认 Movements
    const mcData = require('minecraft-data')(this.bot.version);
    this._movements = new Movements(this.bot, mcData);
    return this._movements;
  }

  /** 确保 pathfinder 使用正确的 Movements */
  _ensureMovements() {
    this.bot.pathfinder.setMovements(this._getMovements());
  }

  /** 检查是否与逃跑冲突，冲突时拒绝主动移动 */
  _checkDodgeConflict() {
    if (this.deps.passiveModule?._ctx?.isDodging) {
      return '⚠️ 正在闪避威胁，暂时无法执行移动指令';
    }
    return null;
  }

  // ==================== 工具定义 ====================

  getToolDefs() {
    return [
      {
        type: 'function',
        function: {
          name: 'goto',
          description: '移动到指定坐标（使用 A* 寻路）',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X 坐标' },
              y: { type: 'number', description: 'Y 坐标' },
              z: { type: 'number', description: 'Z 坐标' },
            },
            required: ['x', 'y', 'z'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'follow',
          description: '持续跟随指定玩家（动态目标，不会自动停止）',
          parameters: {
            type: 'object',
            properties: {
              player: { type: 'string', description: '玩家名' },
              range: { type: 'number', description: '跟随距离（默认 2）' },
            },
            required: ['player'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'goto_player',
          description: '走到指定玩家旁边后自动停止（一次性目标）',
          parameters: {
            type: 'object',
            properties: {
              player: { type: 'string', description: '玩家名' },
              range: { type: 'number', description: '到达距离（默认 2）' },
            },
            required: ['player'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'wander',
          description: '随机探索周围区域',
          parameters: {
            type: 'object',
            properties: {
              radius: { type: 'number', description: '探索半径（默认 20）' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'stop',
          description: '停止所有移动',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'look_at',
          description: '看向指定坐标或玩家',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
              player: { type: 'string' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'jump',
          description: '跳跃一次',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'find_block',
          description: '寻找附近的指定方块并走过去',
          parameters: {
            type: 'object',
            properties: {
              block: { type: 'string', description: '方块名，如 oak_log, crafting_table, chest' },
              maxDistance: { type: 'number', description: '最大搜索距离（默认 64）' },
            },
            required: ['block'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'sleep',
          description: '在附近的床上睡觉',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ];
  }

  // ==================== 执行器映射 ====================

  getExecutors() {
    return {
      goto:        (p) => this._goto(p),
      follow:      (p) => this._follow(p),
      goto_player: (p) => this._gotoPlayer(p),
      wander:      (p) => this._wander(p),
      stop:        ()  => this._stop(),
      look_at:     (p) => this._lookAt(p),
      jump:        ()  => this._jump(),
      find_block:  (p) => this._findBlock(p),
      sleep:       ()  => this._sleep(),
    };
  }

  // ==================== 移动实现 ====================

  /**
   * goto — 智能寻路到目标坐标附近
   * - 已在范围内则跳过
   * - 用 GoalNear 代替 GoalBlock（不要求站在方块上）
   * - 10 秒超时，避免卡死
   */
  async _goto({ x, y, z }) {
    const conflict = this._checkDodgeConflict();
    if (conflict) return conflict;

    // 参数校验
    if (x === undefined || y === undefined || z === undefined ||
        typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' ||
        !isFinite(x) || !isFinite(y) || !isFinite(z)) {
      return '请提供有效的 x, y, z 坐标';
    }

    // 覆盖 follow 时清除视角锁定
    this._clearLookAt();

    const tx = Math.round(x);
    const ty = Math.round(y);
    const tz = Math.round(z);

    // 已在 2 格内 → 跳过
    const dist = this.bot.entity.position.distanceTo(new Vec3(tx, ty, tz));
    if (dist <= 2) return `已在目标附近 (${tx},${ty},${tz})`;

    this._ensureMovements();
    // GoalNear：走到目标 2 格范围内即可，不要求站在方块上
    const goal = new goals.GoalNear(tx, ty, tz, 2);

    try {
      await this.bot.pathfinder.goto(goal);
      return `已到达 ${tx},${ty},${tz} 附近`;
    } catch (err) {
      this.bot.pathfinder.setGoal(null);
      return `移动失败: ${err.message}`;
    }
  }

  /**
   * follow — 动态目标，持续跟随 + 视角锁定玩家
   */
  async _follow({ player, range = 2 }) {
    const conflict = this._checkDodgeConflict();
    if (conflict) return conflict;

    const target = this.bot.players[player]?.entity;
    if (!target) return `找不到玩家 ${player}`;

    this._ensureMovements();
    // dynamic=true：到达后目标保持活跃，不会触发 goal_reached
    this.bot.pathfinder.setGoal(new goals.GoalFollow(target, range), true);

    // 持续看向玩家（physicsTick 每 tick 触发）
    this._clearLookAt();
    this._lookAtTarget = target;
    this._lookAtHandler = () => {
      if (this._lookAtTarget && this._lookAtTarget.isValid) {
        this.bot.lookAt(this._lookAtTarget.position.offset(0, 1.6, 0));
      }
    };
    this.bot.on('physicsTick', this._lookAtHandler);

    return `正在跟随 ${player}（距离 ${range} 格）`;
  }

  /** 清除跟随视角锁定 */
  _clearLookAt() {
    if (this._lookAtHandler) {
      this.bot.removeListener('physicsTick', this._lookAtHandler);
      this._lookAtHandler = null;
    }
    this._lookAtTarget = null;
  }

  /**
   * goto_player — 一次性目标，走到玩家旁边后自动停止
   */
  async _gotoPlayer({ player, range = 2 }) {
    const conflict = this._checkDodgeConflict();
    if (conflict) return conflict;

    // 覆盖 follow 时清除视角锁定
    this._clearLookAt();

    const target = this.bot.players[player]?.entity;
    if (!target) return `找不到玩家 ${player}`;

    // 已在范围内 → 跳过
    const dist = this.bot.entity.position.distanceTo(target.position);
    if (dist <= range) return `已在 ${player} 身边`;

    this._ensureMovements();
    const p = target.position;
    const goal = new goals.GoalNear(p.x, p.y, p.z, range);

    try {
      await this.bot.pathfinder.goto(goal);
      return `已到达 ${player} 身边`;
    } catch (err) {
      this.bot.pathfinder.setGoal(null);
      return `走向 ${player} 失败: ${err.message}`;
    }
  }

  /**
   * wander — 随机探索
   */
  async _wander({ radius = 20 } = {}) {
    const conflict = this._checkDodgeConflict();
    if (conflict) return conflict;

    const p = this.bot.entity.position;
    const dx = (Math.random() - 0.5) * radius * 2;
    const dz = (Math.random() - 0.5) * radius * 2;
    const tx = Math.round(p.x + dx);
    const tz = Math.round(p.z + dz);

    this._ensureMovements();
    // GoalXZ 不关心 Y，让寻路自动处理
    this.bot.pathfinder.setGoal(new goals.GoalXZ(tx, tz));
    return `开始探索，目标区域 (${tx}, ~, ${tz})`;
  }

  /**
   * stop — 立即停止所有移动 + 清除视角锁定
   */
  _stop() {
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
    this._clearLookAt();
    return '已停止';
  }

  /**
   * look_at — 看向坐标或玩家
   */
  async _lookAt({ x, y, z, player }) {
    if (player) {
      const target = this.bot.players[player]?.entity;
      if (target) {
        await this.bot.lookAt(target.position.offset(0, 1.6, 0));
        return `看向 ${player}`;
      }
      return `找不到玩家 ${player}`;
    }
    if (x !== undefined && y !== undefined && z !== undefined) {
      if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' ||
          !isFinite(x) || !isFinite(y) || !isFinite(z)) {
        return '请提供有效的 x, y, z 坐标';
      }
      await this.bot.lookAt(new Vec3(x, y, z));
      return `看向 ${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    }
    return '请指定坐标或玩家';
  }

  /**
   * jump — 跳跃一次
   */
  async _jump() {
    this.bot.setControlState('jump', true);
    setTimeout(() => this.bot.setControlState('jump', false), 300);
    return '跳了一下';
  }

  /**
   * find_block — 搜索方块并使用 goto() 走过去
   */
  async _findBlock({ block, maxDistance = 64 }) {
    const conflict = this._checkDodgeConflict();
    if (conflict) return conflict;

    // 覆盖 follow 时清除视角锁定
    this._clearLookAt();

    // 兼容新旧版 mineflayer：优先用 registry，回退用 mcData
    let blockIds;
    try {
      const byName = this.bot.registry?.blocksByName
        || require('minecraft-data')(this.bot.version).blocksByName;
      blockIds = Object.keys(byName).filter(k => k.includes(block));
      if (blockIds.length === 0) return `不认识方块: ${block}`;
      blockIds = blockIds.map(k => byName[k].id);
    } catch {
      return `无法查询方块注册表`;
    }

    const found = this.bot.findBlock({
      matching: blockIds,
      maxDistance,
    });
    if (!found) return `附近 ${maxDistance} 格内没有 ${block}`;

    // 已在旁边 → 跳过
    const dist = this.bot.entity.position.distanceTo(found.position);
    if (dist <= 3) return `已在 ${block} 旁边 (${found.position.x},${found.position.y},${found.position.z})`;

    this._ensureMovements();
    const goal = new goals.GoalNear(
      found.position.x, found.position.y, found.position.z, 2
    );

    try {
      await this.bot.pathfinder.goto(goal);
      return `已到达 ${block} (${found.position.x},${found.position.y},${found.position.z})`;
    } catch (err) {
      this.bot.pathfinder.setGoal(null);
      return `走向 ${block} 失败: ${err.message}`;
    }
  }

  /**
   * sleep — 在附近的床上睡觉
   */
  async _sleep() {
    const bed = this.bot.findBlock({
      matching: block => this.bot.isABed(block),
      maxDistance: 32,
    });
    if (!bed) return '附近没有床';

    try {
      await this.bot.sleep(bed);
      return '正在睡觉';
    } catch (err) {
      if (err.message === 'already sleep') return '已经在睡觉了';
      return `无法睡觉: ${err.message}`;
    }
  }
}

module.exports = { MoveModule };

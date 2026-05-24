/**
 * 移动模块 — goto / follow / wander / stop / lookAt / jump / findBlock / sleep
 */
const { goals } = require('mineflayer-pathfinder');

class MoveModule {
  constructor(bot) {
    this.bot = bot;
  }

  getToolDefs() {
    return [
      {
        type: 'function',
        function: {
          name: 'goto',
          description: '移动到指定坐标',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
            },
            required: ['x', 'y', 'z'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'follow',
          description: '持续跟随指定玩家',
          parameters: {
            type: 'object',
            properties: {
              player: { type: 'string' },
            },
            required: ['player'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'goto_player',
          description: '走到指定玩家旁边后自动停止',
          parameters: {
            type: 'object',
            properties: {
              player: { type: 'string' },
            },
            required: ['player'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'wander',
          description: '随机探索周围',
          parameters: { type: 'object', properties: {}, required: [] },
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
              x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
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

  getExecutors() {
    return {
      goto: (p) => this._goto(p),
      follow: (p) => this._follow(p),
      goto_player: (p) => this._gotoPlayer(p),
      wander: () => this._wander(),
      stop: () => this._stop(),
      look_at: (p) => this._lookAt(p),
      jump: () => this._jump(),
      find_block: (p) => this._findBlock(p),
      sleep: () => this._sleep(),
    };
  }

  async _goto({ x, y, z }) {
    this.bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
    return `前往 ${x},${y},${z}`;
  }

  async _follow({ player }) {
    const target = this.bot.players[player]?.entity;
    if (!target) return `找不到玩家 ${player}`;
    this.bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
    return `正在跟随 ${player}`;
  }

  async _gotoPlayer({ player }) {
    const target = this.bot.players[player]?.entity;
    if (!target) return `找不到玩家 ${player}`;
    const pos = target.position;
    this.bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
    // 到达后自动停止
    const checkArrived = setInterval(() => {
      const dist = this.bot.entity.position.distanceTo(target.position);
      if (dist <= 3) {
        this.bot.pathfinder.setGoal(null);
        clearInterval(checkArrived);
      }
    }, 500);
    // 30秒超时
    setTimeout(() => clearInterval(checkArrived), 30000);
    return `走向 ${player}`;
  }

  async _wander() {
    const p = this.bot.entity.position;
    const dx = (Math.random() - 0.5) * 40;
    const dz = (Math.random() - 0.5) * 40;
    this.bot.pathfinder.setGoal(new goals.GoalBlock(
      Math.round(p.x + dx), Math.round(p.y), Math.round(p.z + dz)
    ));
    return '开始探索';
  }

  _stop() {
    try { this.bot.pathfinder?.setGoal(null); } catch {}
    this.bot.clearControlStates();
    return '已停止';
  }

  async _lookAt({ x, y, z, player }) {
    if (player) {
      const target = this.bot.players[player]?.entity;
      if (target) {
        await this.bot.lookAt(target.position.offset(0, 1.6, 0));
        return `看向 ${player}`;
      }
      return `找不到玩家 ${player}`;
    }
    if (x !== undefined) {
      const { Vec3 } = require('vec3');
      await this.bot.lookAt(new Vec3(x, y, z));
      return `看向 ${x},${y},${z}`;
    }
    return '请指定坐标或玩家';
  }

  async _jump() {
    this.bot.setControlState('jump', true);
    setTimeout(() => this.bot.setControlState('jump', false), 300);
    return '跳了一下';
  }

  async _findBlock({ block }) {
    const blockIds = Object.keys(this.bot.registry.blocksByName).filter(k => k.includes(block));
    if (blockIds.length === 0) return `不认识方块: ${block}`;
    const found = this.bot.findBlock({
      matching: blockIds.map(k => this.bot.registry.blocksByName[k].id),
      maxDistance: 64,
    });
    if (!found) return `附近没有 ${block}`;
    this.bot.pathfinder.setGoal(new goals.GoalBlock(found.position.x, found.position.y, found.position.z));
    return `找到 ${block} 在 ${found.position.x},${found.position.y},${found.position.z}`;
  }

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
      return `无法睡觉: ${err.message}`;
    }
  }
}

module.exports = { MoveModule };

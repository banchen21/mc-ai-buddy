/**
 * 动作模块 — 提供 bot 行为工具（移动、交互等）
 */
const { goals } = require('mineflayer-pathfinder');

class MoveModule {
  constructor(bot) {
    this.bot = bot;
  }

  /** 获取所有动作工具定义 */
  getToolDefs() {
    return [
      {
        type: 'function',
        function: {
          name: 'follow',
          description: '跟随指定玩家',
          parameters: {
            type: 'object',
            properties: {
              player: { type: 'string', description: '要跟随的玩家名' },
            },
            required: ['player'],
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
    ];
  }

  /** 获取所有动作执行器 */
  getExecutors() {
    return {
      follow: (params) => this._follow(params),
      stop: () => this._stop(),
    };
  }

  // ===== 动作实现 =====

  async _follow({ player }) {
    const target = this.bot.players[player]?.entity;
    if (!target) return `找不到玩家 ${player}`;

    const { pathfinder, goals } = require('mineflayer-pathfinder');
    this.bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
    return `正在跟随 ${player}`;
  }

  _stop() {
    try {
      this.bot.pathfinder?.setGoal(null);
    } catch {}
    this.bot.clearControlStates();
    return '已停止';
  }
}

module.exports = { MoveModule };

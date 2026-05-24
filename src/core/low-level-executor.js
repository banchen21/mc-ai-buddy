/**
 * ⚙️ LowLevelExecutor — 低层执行器
 *
 * 职责：
 * - 执行原子动作（寻路、挖掘、合成、放置方块、战斗）
 * - 区分瞬时动作和持续性动作
 * - 返回执行结果给调度器
 *
 * 不调用 LLM，纯本地逻辑
 */

const logger = require('./logger');

// 持续性动作：调用后立即返回 "running"，不阻塞队列
const ONGOING_ACTIONS = new Set([
  'wander', 'follow', 'dodge', 'tower', 'goto',
]);

// 动作默认超时 (ms)
const ACTION_TIMEOUTS = {
  left_click: 5000,
  use: 8000,
  place: 5000,
  craft: 10000,
  sleep: 15000,
  goto: 30000,
  search_wiki: 10000,
  chat: 3000,
  give: 5000,
  stop: 2000,
  default: 15000,
};

class LowLevelExecutor {
  constructor(bot, deps) {
    this.bot = bot;
    this.deps = deps;

    /** 所有可用的动作处理器（从插件收集） */
    this.actionHandlers = {};

    /** 当前正在执行的动作 */
    this.currentAction = null;

    /** 持续性动作的引用（用于取消） */
    this._ongoingActions = new Set();
  }

  /**
   * 从插件收集所有动作处理器
   * 自动 bind actions 对象，确保内部 this._xxx() 调用正确
   */
  collectActions(plugins) {
    this.actionHandlers = {};
    for (const plugin of plugins) {
      if (plugin.actions) {
        for (const [name, handler] of Object.entries(plugin.actions)) {
          if (typeof handler !== 'function') continue;
          // bind 到 actions 对象，保证 this._equipItem 等内部调用不丢失
          this.actionHandlers[name] = handler.bind(plugin.actions);
        }
      }
    }
  }

  /**
   * 执行单个动作
   * @param {object} action - { action: 'left_click', params: { target: 'zombie', ... } }
   * @returns {any} 执行结果：true/false/数字/字符串
   *   - 持续性动作返回 'running'
   */
  async execute(action) {
    if (!action || !action.action) return false;

    const name = action.action;
    const params = action.params || {};

    this.currentAction = action;

    const handler = this.actionHandlers[name];
    if (!handler) {
      logger.error('lowlevel', `Unknown action: ${name}`);
      this.currentAction = null;
      return false;
    }

    // 持续性动作：触发后立即返回
    if (ONGOING_ACTIONS.has(name)) {
      console.log(`[LowLevel] ▶ ${name} (ongoing)`);
      const promise = handler(params).catch(err => logger.error(`lowlevel/${name}`, err));
      this._ongoingActions.add(promise);
      promise.finally(() => this._ongoingActions.delete(promise));
      this.currentAction = null;
      return 'running';
    }

    const timeout = ACTION_TIMEOUTS[name] || ACTION_TIMEOUTS.default;

    try {
      console.log(`[LowLevel] ▶ ${name}(${JSON.stringify(params).substring(0, 60)})`);
      const result = await this._withTimeout(handler(params), timeout);
      const s = result === true ? '✅' : result === false ? '❌' : typeof result === 'number' ? `✅${result}` : `⚠️${String(result).substring(0,20)}`;
      console.log(`[LowLevel] ◀ ${name} → ${s}`);
      if (result === false || (typeof result === 'string' && result.startsWith('need_'))) {
        logger.action('lowlevel', name, result);
      }
      return result;
    } catch (err) {
      const isTimeout = err.message?.includes('timeout');
      console.log(`[LowLevel] ◀ ${name} → ❌ ${isTimeout ? 'timeout' : err.message}`);
      logger.error(`lowlevel/${name}`, err);
      return isTimeout ? 'timeout' : false;
    } finally {
      this.currentAction = null;
    }
  }

  /**
   * 取消当前动作
   */
  cancel() {
    try { this.bot.pathfinder?.setGoal(null); } catch {}
    try { this.bot.pvp?.stop(); } catch {}
    try { this.bot.clearControlStates(); } catch {}

    this.currentAction = null;
  }

  /**
   * 判断动作是否可恢复
   */
  isRecoverable(error) {
    const err = String(error || '').toLowerCase();
    const recoverable = [
      'need_tier', 'too weak', 'no_food', 'no_bed',
      'not_night', 'path', 'stuck', 'timeout',
      'no_block', 'unreachable', 'no_item', 'no_target',
      'no crafting', 'no furnace', 'inventory full',
    ];
    return recoverable.some(r => err.includes(r));
  }

  /**
   * 判断动作是否是持续性动作
   */
  isOngoing(actionName) {
    return ONGOING_ACTIONS.has(actionName);
  }

  /** Promise 超时包装 */
  _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms)
      ),
    ]);
  }
}

module.exports = { LowLevelExecutor };

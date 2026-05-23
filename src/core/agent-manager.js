/**
 * 🎯 AgentManager — 单代理管理器
 * 接收玩家指令 → 创建单个代理执行
 */
const { SubAgent } = require('./sub-agent');
const logger = require('./logger');

class AgentManager {
  constructor(bot, deps) {
    this.bot = bot;
    this.deps = deps;
    this.agent = null;        // 当前唯一代理
    this.tickInterval = null;
    this.running = false;
  }

  /** 启动管理器 */
  start(intervalMs = 1500) {
    this.running = true;
    this.tickInterval = setInterval(() => this.tick(), intervalMs);
    console.log(`[AgentManager] Started (tick=${intervalMs}ms, single agent mode)`);
  }

  stop() {
    this.running = false;
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.agent = null;
  }

  /** 每 tick：推进当前代理 */
  async tick() {
    if (!this.running || !this.agent) return;

    if (this.agent.status === 'done' || this.agent.status === 'failed') {
      console.log(`[AgentManager] Agent finished: ${this.agent.name} → ${this.agent.status} (${this.agent.steps.length} steps)`);
      this.agent = null;
      return;
    }

    await this.agent.step();

    if (this.agent && (this.agent.status === 'done' || this.agent.status === 'failed')) {
      console.log(`[AgentManager] Agent finished: ${this.agent.name} → ${this.agent.status} (${this.agent.steps.length} steps)`);
      this.agent = null;
    }
  }

  /** 是否有活跃代理 */
  get hasAgent() {
    return this.agent !== null && this.agent.status !== 'done' && this.agent.status !== 'failed';
  }

  /**
   * 根据玩家指令创建单个代理（不再拆解为多个子任务）
   */
  async dispatch(message, username) {
    // 如果已有代理在运行，先取消
    if (this.agent) {
      console.log(`[AgentManager] Cancelling previous agent: ${this.agent.name}`);
      this.agent = null;
    }

    // 创建单个代理，给全部工具
    const agent = new SubAgent(
      'task',
      message,
      this.bot,
      this.deps,
      []  // 空数组 = 使用全部工具
    );
    this.agent = agent;
    console.log(`[AgentManager] Created agent: ${message}`);
    // 不再聊天，直接开始执行

    return agent;
  }

  /** 获取状态摘要 */
  getStatus() {
    if (!this.agent) return { active: [], done: [] };
    return {
      active: [`${this.agent.name}(${this.agent.status},${this.agent.steps.length}步)`],
      done: [],
    };
  }
}

module.exports = { AgentManager };

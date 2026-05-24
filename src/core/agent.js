/**
 * Agent — 统一入口，管理工具注册、系统提示、任务编排
 *
 * 职责：
 *   1. 工具注册与管理
 *   2. 构建系统提示（人格 + 工具列表 + 规则）
 *   3. 委托 TaskOrchestrator 执行任务流
 *   4. 管理 LLM 对话历史
 */
const { TaskOrchestrator } = require('./task-orchestrator');
const logger = require('./logger');

class Agent {
  constructor(llm, options = {}) {
    this.llm = llm;

    /** 工具定义列表 */
    this._tools = [];

    /** 工具执行器 { name: fn } */
    this._executors = {};

    /** 人格设定 */
    this._persona = '';

    /** 编排器配置 */
    this._maxRounds = options.maxRounds || 5;

    /** 任务编排器（延迟初始化） */
    this._orchestrator = null;
  }

  // ===== 配置 =====

  /** 设置人格 */
  setPersona(persona) {
    this._persona = persona;
  }

  /** 注册工具 */
  registerTool(toolDef, executor) {
    this._tools.push(toolDef);
    this._executors[toolDef.function.name] = executor;
  }

  /** 批量注册（从模块） */
  registerModule(module) {
    for (const toolDef of module.getToolDefs()) {
      const executors = module.getExecutors();
      this.registerTool(toolDef, executors[toolDef.function.name]);
    }
  }

  // ===== 编排器 =====

  _getOrchestrator() {
    if (!this._orchestrator) {
      this._orchestrator = new TaskOrchestrator(this.llm, this._executors, {
        maxRounds: this._maxRounds,
        onChat: this._onChat.bind(this),
      });
    }
    return this._orchestrator;
  }

  /** 中间回复回调（由编排器在工具执行间隙调用） */
  _onChat(msg) {
    // 子类或外部可覆盖
  }

  // ===== 系统提示 =====

  _buildSystemPrompt(username) {
    const toolNames = this._tools.map(t => t.function.name).join('、');
    return (this._persona || '你是 Minecraft 中的 AI 助手。') +
      `\n\n当前对话玩家: ${username}\n可用工具: ${toolNames}` +
      `\n规则：问状态→调查询工具，给指令→调动作工具，纯聊天→不调工具。给物品前先走到玩家旁边。回复256字内。`;
  }

  // ===== 主入口 =====

  /**
   * 被动模块注入事件 — 将游戏事件写入 LLM history
   * 让 LLM 在后续对话中感知到已发生的被动事件
   * @param {string} eventSummary — 事件摘要，如 "[系统] 被僵尸攻击，已自动逃跑"
   */
  injectEvent(eventSummary) {
    // 作为 system 角色注入，不影响 user/assistant 对话流
    this.llm.history.push({
      role: "system",
      content: `[系统通知] ${eventSummary}`,
      name: "system",
    });
    // 追加一个空的 assistant 确认，保持对话结构
    this.llm.history.push({
      role: "assistant",
      content: "（已自动处理）",
    });
    this.llm._trimHistory();
    if (this.llm._onHistoryChange) {
      this.llm._onHistoryChange(this.llm.history);
    }
  }

  /**
   * 处理用户消息
   * @param {string} username
   * @param {string} message
   * @returns {{ reply: string, rounds: number, results: string[] } | null}
   */
  async handle(username, message) {
    if (this._tools.length === 0) return null;

    const system = this._buildSystemPrompt(username);
    const orch = this._getOrchestrator();
    return orch.run(system, message, username, this._tools);
  }
}

module.exports = { Agent };

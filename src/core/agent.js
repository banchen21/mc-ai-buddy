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
    this._maxRounds = options.maxRounds || 50;

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

  // ===== 工具格式转换 =====

  /** OpenAI 工具定义 → Anthropic 工具定义 */
  _toAnthropicTools() {
    return this._tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  // ===== 系统提示 =====

  _buildSystemPrompt(username) {
    // 按类别分组工具
    const queryTools = [];
    const moveTools = [];
    const actionTools = [];
    const craftTools = [];
    const memoryTools = [];
    for (const t of this._tools) {
      const name = t.function.name;
      if (['get_inventory','get_armor','get_held_item','get_offhand','get_health','get_position','get_nearby_entities','get_block','get_surrounding_blocks','scan_surroundings','look_at_block','get_time','get_chest','get_furnace','get_container','search_web'].includes(name)) {
        queryTools.push(name);
      } else if (['goto','follow','goto_player','wander','stop','look_at','jump','find_block','sleep'].includes(name)) {
        moveTools.push(name);
      } else if (['dig','place','pillar_up','attack','give','equip','drop','collect','use_item','activate_block','take_from_chest','put_to_chest','take_from_furnace','send_chat'].includes(name)) {
        actionTools.push(name);
      } else if (['craft','search_recipe','smelt'].includes(name)) {
        craftTools.push(name);
      } else if (['remember','recall','forget'].includes(name)) {
        memoryTools.push(name);
      }
    }

    const toolSection = [
      queryTools.length && `🔍 查询: ${queryTools.join('、')}`,
      moveTools.length && `🚶 移动: ${moveTools.join('、')}`,
      actionTools.length && `⛏️ 交互: ${actionTools.join('、')}`,
      craftTools.length && `🔧 合成: ${craftTools.join('、')}`,
      memoryTools.length && `🧠 记忆: ${memoryTools.join('、')}`,
    ].filter(Boolean).join('\n');

    return (this._persona || '你是 Minecraft 中的 AI 助手。') +
      `\n\n## 当前对话玩家\n${username}` +
      `\n\n## 可用工具\n${toolSection}` +
      `\n\n## 工具使用规则\n` +
      `1. 玩家问状态/信息（背包、血量、坐标、周围环境等）→ 先调用查询工具获取数据，再基于数据回复。不要凭空编造。\n` +
      `2. 玩家给指令（来我这里、挖矿、合成、给物品等）→ 调用对应的动作/移动/合成工具执行。\n` +
      `3. 给物品(give)之前，必须先调用 goto_player 走到玩家旁边，再 give。\n` +
      `4. 纯聊天/闲聊/问知识类问题 → 直接文字回复，不要调用任何工具。Minecraft 知识类问题可用 search_web。\n` +
      `5. 每次只调用必要的工具，不要过度调用。能 1 个工具解决的不要调 2 个。\n` +
      `6. 工具执行完毕后，用自然语言总结结果告诉玩家。不要只返回工具原始输出。\n` +
      `7. 如果玩家指令不明确（如"挖矿"但没说挖什么），先问清楚再行动。`;
  }

  // ===== 主入口 =====

  /**
   * 被动模块注入事件 — 将游戏事件写入 LLM history
   * 让 LLM 在后续对话中感知到已发生的被动事件
   * @param {string} eventSummary — 事件摘要，如 "[系统] 被僵尸攻击，已自动逃跑"
   */
  injectEvent(eventSummary) {
    this.llm.history.push({
      role: 'user',
      content: `[系统通知] ${eventSummary}`,
    });
    this.llm.history.push({
      role: 'assistant',
      content: '（已自动处理）',
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
  async handle(username, message, opts = {}) {
    if (this._tools.length === 0) return null;

    const system = this._buildSystemPrompt(username);
    const orch = this._getOrchestrator();
    const anthropicTools = this._toAnthropicTools();
    // 聊天模式限制轮次加快响应，自主模式保留完整轮次
    const maxRounds = username === 'system' ? this._maxRounds : Math.min(this._maxRounds, 5);
    return orch.run(system, message, username, anthropicTools, maxRounds, opts.abortSignal);
  }
}

module.exports = { Agent };

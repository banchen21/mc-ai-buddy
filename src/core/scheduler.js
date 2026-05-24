/**
 * 🎯 Scheduler — 智能任务调度器
 *
 * 职责：
 * 1. 维护任务队列 [动作1, 动作2, ...]
 * 2. 遇到失败先查经验库，没有再问 LLM 规划
 * 3. 将 LLM 规划结果展开为低层动作
 *
 * 核心思想：LLM 只在"解决新问题"时被调用
 */

const { ExperienceDB } = require('./experience-db');
const logger = require('./logger');

class Scheduler {
  constructor(bot, deps) {
    this.bot = bot;
    this.deps = deps;

    // 根据服务器地址+端口生成存档 ID
    const host = bot._client?.socket?.remoteAddress || deps.config?.bot?.host || 'localhost';
    const port = bot._client?.socket?.remotePort || deps.config?.bot?.port || '25565';
    const worldId = `${host}:${port}`;

    this.experienceDB = new ExperienceDB(worldId);

    /** 任务队列：待执行的低层动作 */
    this.taskQueue = [];

    /** 当前正在执行的动作 */
    this.currentAction = null;

    /** 当前任务的目标描述 */
    this.currentGoal = null;

    /** 统计 */
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      cacheHits: 0,
      experienceHits: 0,
      llmPlans: 0,
    };
  }

  // ===== 公共 API =====

  /**
   * 接收指令，生成任务队列
   * @param {object} routed - 来自 InputRouter 的路由结果
   *   { type: 'command', intent, steps: [{action, params}], strategy, raw }
   * @param {object} context - 环境上下文
   */
  async planCommand(routed, context) {
    this.stats.totalTasks++;
    this.currentGoal = routed.raw;
    console.log(`[Scheduler] 📋 Plan: "${routed.raw}" (${routed.intent})`);

    // 1. InputRouter 已经给了 steps → 直接入队
    if (routed.steps && routed.steps.length > 0) {
      console.log(`[Scheduler] ✅ Using LLM plan from Router: ${routed.steps.length} steps`);
      this.taskQueue = [...routed.steps];

      // 缓存动作链（供后续复用）
      const goalHash = this._hashGoal(routed.raw);
      this.experienceDB.cacheActionChain(goalHash, {
        steps: routed.steps,
        description: routed.strategy || routed.raw,
      });

      return {
        source: 'router',
        queue: [...this.taskQueue],
        strategy: routed.strategy,
      };
    }

    // 2. Router 没给 steps → 查经验库
    const intent = routed.intent || 'move';
    const problem = this._intentToProblem(intent);
    const experience = this.experienceDB.findSolution(problem, context);

    if (experience && experience.success_rate >= 0.7) {
      console.log(`[Scheduler] 📚 Experience HIT: ${problem} → ${experience.solution.strategy}`);
      this.stats.experienceHits++;
      this.taskQueue = this._parseSteps(experience.solution);
      return {
        source: 'experience',
        queue: [...this.taskQueue],
        strategy: experience.solution.strategy,
      };
    }

    // 3. 查动作缓存
    const goalHash = this._hashGoal(routed.raw);
    const cached = this.experienceDB.findActionCache(goalHash);
    if (cached) {
      console.log(`[Scheduler] ⚡ Cache HIT: "${routed.raw}"`);
      this.stats.cacheHits++;
      this.taskQueue = [...cached.steps];
      return {
        source: 'cache',
        queue: [...this.taskQueue],
        strategy: cached.description,
      };
    }

    // 4. 都没有 → 问 LLM 规划（兜底）
    console.log(`[Scheduler] 🤖 LLM planning (fallback): "${routed.raw}"`);
    this.stats.llmPlans++;

    try {
      const plan = await this._askLLMToPlan(routed, context);

      if (plan && plan.steps && plan.steps.length > 0) {
        const entry = await this.experienceDB.learn(problem, context, plan);
        this.experienceDB.cacheActionChain(goalHash, {
          steps: plan.steps,
          description: plan.strategy || routed.raw,
        });
        if (entry.success_rate >= 0.8) {
          await this.experienceDB.generalize(entry);
        }

        this.taskQueue = this._parseSteps(plan);
        return {
          source: 'llm',
          queue: [...this.taskQueue],
          strategy: plan.strategy,
          plan,
        };
      }

      console.log(`[Scheduler] ⚠️ LLM returned no valid plan, using default`);
      this.taskQueue = this._defaultPlan(intent, {});
      return { source: 'default', queue: [...this.taskQueue], strategy: 'default fallback' };
    } catch (err) {
      console.error(`[Scheduler] LLM plan error: ${err.message}`);
      this.taskQueue = this._defaultPlan(intent, {});
      return { source: 'default', queue: [...this.taskQueue], strategy: 'error fallback' };
    }
  }

  /**
   * 获取下一个待执行的动作
   * @returns {object|null} { action, params } 或 null
   */
  nextAction() {
    if (this.taskQueue.length === 0) return null;
    this.currentAction = this.taskQueue[0];
    return this.currentAction;
  }

  /**
   * 标记当前动作完成
   */
  markComplete() {
    if (this.taskQueue.length > 0) {
      this.taskQueue.shift();
    }
    this.currentAction = null;

    if (this.taskQueue.length === 0) {
      this.stats.completedTasks++;
      this.currentGoal = null;
    }
  }

  /**
   * 处理动作失败
   * @param {string} error - 错误描述
   * @param {object} context - 环境上下文
   * @returns {object} { handled, newActions }
   */
  async handleFailure(error, context) {
    const action = this.currentAction;
    const problem = this._inferProblemFromError(action, error);

    console.log(`[Scheduler] 🔧 Failure: ${action?.action || '?'} → ${error} (problem: ${problem})`);

    // 1. 查经验库
    const experience = this.experienceDB.findSolution(problem, context);
    if (experience && experience.success_rate >= 0.6) {
      console.log(`[Scheduler] 📚 Failure resolved from experience: ${experience.solution.strategy}`);
      this.stats.experienceHits++;

      const newSteps = this._parseSteps(experience.solution);
      this.taskQueue = [...newSteps, ...this.taskQueue.slice(1)];
      return { handled: true, source: 'experience', newActions: newSteps };
    }

    // 2. 问 LLM
    console.log(`[Scheduler] 🤖 Asking LLM to handle failure: ${problem}`);
    this.stats.llmPlans++;

    try {
      const solution = await this._askLLMForFailure(action, error, problem, context);

      if (solution && solution.steps && solution.steps.length > 0) {
        await this.experienceDB.learn(problem, context, solution);

        const newSteps = this._parseSteps(solution);
        this.taskQueue = [...newSteps, ...this.taskQueue.slice(1)];
        return { handled: true, source: 'llm', newActions: newSteps };
      }
    } catch (err) {
      console.error(`[Scheduler] Failure LLM error: ${err.message}`);
    }

    // 3. 无法处理 → 放弃当前动作
    console.log(`[Scheduler] ❌ Unresolved, skipping`);
    this.taskQueue.shift();
    this.stats.failedTasks++;
    return { handled: false, source: 'none' };
  }

  clear() {
    if (this.taskQueue.length > 0) {
      console.log(`[Scheduler] 🗑️ Cleared ${this.taskQueue.length} tasks`);
    }
    this.taskQueue = [];
    this.currentAction = null;
    this.currentGoal = null;
  }

  /**
   * 直接设置任务队列（供自主决策使用）
   * @param {array} steps - [{action, params}, ...]
   */
  setQueue(steps) {
    this.taskQueue = [...steps];
    this.currentGoal = `autonomous: ${steps.map(s => s.action).join(' → ')}`;
    console.log(`[Scheduler] 🧠 Autonomous queue: ${steps.map(s => s.action).join(' → ')}`);
  }

  /** 是否有待执行任务 */
  get hasTasks() {
    return this.taskQueue.length > 0;
  }

  /** 获取队列长度 */
  get queueLength() {
    return this.taskQueue.length;
  }

  // ===== 内部方法 =====

  /** 问 LLM 制定计划 */
  async _askLLMToPlan(routed, context) {
    const system = `你是 Minecraft 任务规划器。根据玩家指令，输出一个低层动作序列。

**可用动作（共14个）：**

移动类：
- follow(player) — 跟随玩家
- wander() — 随机漫游探索
- goto(x, y, z) — 导航到指定坐标
- stop() — 停止所有移动
- dodge() — 紧急闪避
- tower(height) — 垫方块向上爬

交互类：
- left_click(target, action, item, count) — 左键。action: attack(攻击实体) | dig(挖掘方块) | click(单次点击)
  - 攻击: left_click({ target: "zombie", action: "attack", item: "iron_sword" })
  - 挖掘: left_click({ target: "100,64,200", action: "dig", item: "iron_pickaxe", count: 5 })
- use(block, action, item, input, fuel, count) — 右键使用
  - 方块: use({ block: "crafting_table" })
  - 烧炼: use({ block: "furnace", action: "smelt", input: "iron_ore", fuel: "coal", count: 8 })
  - 箱子: use({ block: "chest", action: "deposit", item: "cobblestone", count: 64 })
  - 进食: use({ action: "eat" })
  - 长按: use({ action: "hold", item: "bow" })

建造/合成类：
- place(block, x, y, z, direction) — 放置方块
- craft(item, count) — 合成物品
- sleep() — 在附近床上睡觉

社交/信息类：
- chat(message) — 发送聊天消息
- give(item, count, player) — 给玩家物品
- search_wiki(query) — 搜索 Minecraft 知识库

**输出格式（纯 JSON）：**
{
  "diagnosis": "简短分析",
  "strategy": "一句话策略",
  "steps": [
    {"action": "动作名", "params": {"key": "value"}},
    ...
  ],
  "fallback": "如果失败怎么办"
}

**规则：**
- 步骤要具体，参数要明确
- 考虑工具等级：木<石<铁<钻石
- 3-8 步为宜
- 挖掘必须指定 item（如 iron_pickaxe）
- 攻击必须指定 item（如 iron_sword）`;

    const prompt = `玩家指令: "${routed.raw}"
意图: ${routed.intent}
参数: ${JSON.stringify(routed.params)}
环境:
- 生物群系: ${context.biome || '?'}
- 地下: ${context.isUnderground ? '是' : '否'}
- HP: ${context.health || '?'}/20 | 饱食度: ${context.food || '?'}
- 手持: ${context.equipped || '?'}
- 背包: ${context.inventory || '空'}
- 附近方块: ${context.blocks || '无'}
- 附近实体: ${context.entities || '无'}
- 时间: ${context.dayPhase || '?'}

输出 JSON 计划:`;

    try {
      const response = await this._withTimeout(
        this.deps.llm.client.chat.completions.create({
          model: this.deps.llm.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: 'json_object' },
          extra_body: this.deps.llm._extraBody(),
        }),
        20000,
      );

      return JSON.parse(response.choices[0].message.content);
    } catch (err) {
      console.error(`[Scheduler] Plan parse error: ${err.message}`);
      return null;
    }
  }

  /** 问 LLM 处理失败 */
  async _askLLMForFailure(action, error, problem, context) {
    const system = `你是 Minecraft 问题解决器。一个动作失败了，诊断原因并提供替代方案。

**可用动作：** follow, wander, goto, stop, dodge, tower, left_click, use, place, craft, sleep, chat, give, search_wiki

**输出格式（纯 JSON）：**
{
  "diagnosis": "失败原因分析",
  "strategy": "替代策略",
  "steps": [{"action": "...", "params": {...}}, ...],
  "fallback": "最后手段"
}`;

    const prompt = `失败动作: ${JSON.stringify(action)}
错误: ${error}
问题类型: ${problem}
环境:
- 生物群系: ${context.biome || '?'}
- HP: ${context.health || '?'}/20 | 饱食度: ${context.food || '?'}
- 手持: ${context.equipped || '?'}
- 背包: ${context.inventory || '空'}
- 附近: ${context.blocks || '无'}

输出 JSON:`;

    try {
      const response = await this._withTimeout(
        this.deps.llm.client.chat.completions.create({
          model: this.deps.llm.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 400,
          response_format: { type: 'json_object' },
          extra_body: this.deps.llm._extraBody(),
        }),
        15000,
      );

      return JSON.parse(response.choices[0].message.content);
    } catch (err) {
      return null;
    }
  }

  /** 意图 → 问题类型 */
  _intentToProblem(intent) {
    const map = {
      gather: 'gather_resource',
      craft: 'craft_item',
      move: 'navigate',
      combat: 'combat',
      build: 'build',
      give: 'give_item',
      survive: 'survive',
      smelt: 'smelt',
      search: 'search',
      stop: 'stop',
    };
    return map[intent] || 'unknown';
  }

  /** 从错误推断问题类型 */
  _inferProblemFromError(action, error) {
    const err = (error || '').toLowerCase();
    const act = action?.action || '';

    if (err.includes('need_tier') || err.includes('too weak')) return 'tool_too_weak';
    if (err.includes('no food')) return 'no_food';
    if (err.includes('no bed')) return 'no_bed';
    if (err.includes('not_night')) return 'not_night';
    if (act === 'mine' && (err.includes('0') || err.includes('fail'))) return 'find_nearest_ore_failed';
    if (act === 'chop' && (err.includes('0') || err.includes('fail'))) return 'find_nearest_tree_failed';
    if (act === 'craft' && err.includes('need')) return 'craft_missing_materials';

    return `${act}_failed`;
  }

  /** 解析解决方案中的步骤 */
  _parseSteps(solution) {
    if (!solution?.steps) return [];
    const validActions = new Set([
      'follow', 'wander', 'goto', 'stop', 'dodge', 'tower',
      'left_click', 'use', 'place', 'craft', 'sleep', 'chat', 'give', 'search_wiki',
    ]);
    return solution.steps
      .map(s => {
        if (typeof s === 'string') return { action: s, params: {} };
        const action = s.action || s.tool;
        if (!action || !validActions.has(action)) {
          console.log(`[Scheduler] ⚠️ Unknown action skipped: ${action}`);
          return null;
        }
        return { action, params: s.params || s.args || {} };
      })
      .filter(Boolean);
  }

  /** 默认计划（LLM 不可用时的回退） */
  _defaultPlan(intent, params) {
    const msg = params?.message || '';
    const plans = {
      gather: [
        { action: 'search_wiki', params: { query: msg } },
        { action: 'wander', params: {} },
      ],
      craft: [
        { action: 'search_wiki', params: { query: msg } },
        { action: 'wander', params: {} },
      ],
      move: [{ action: 'follow', params: { player: params?.player || 'nearest' } }],
      combat: [{ action: 'dodge', params: {} }],
      build: [{ action: 'wander', params: {} }],
      give: [{ action: 'chat', params: { message: '我背包里没有这个物品' } }],
      survive: [{ action: 'use', params: { action: 'eat' } }],
      smelt: [{ action: 'wander', params: {} }],
      search: [{ action: 'search_wiki', params: { query: msg } }],
      stop: [{ action: 'stop', params: {} }],
    };
    return plans[intent] || [{ action: 'wander', params: {} }];
  }

  /** 目标哈希 */
  _hashGoal(goal) {
    return goal.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '_').substring(0, 48);
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

  // ===== 查询 =====

  getStatus() {
    return {
      queueLength: this.taskQueue.length,
      currentGoal: this.currentGoal,
      currentAction: this.currentAction,
      stats: { ...this.stats },
      experienceDB: this.experienceDB.getSummary(),
    };
  }
}

module.exports = { Scheduler };

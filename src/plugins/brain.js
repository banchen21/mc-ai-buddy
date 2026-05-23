/**
 * 🧠 brain 插件 — 大脑：心跳驱动 + 事件路由 + 子代理调度
 * 简单指令 → 直接执行 | 复杂指令 → AgentManager 拆解并行
 */
const logger = require('../core/logger');
const { AgentManager } = require('../core/agent-manager');
const { StatusIndicator } = require('../core/status-indicator');

let bot, deps;
let allTools = [];
let lastToolResult = '';
let agentManager = null;
let status = null;
let emptyResponseCount = 0;
let MAX_EMPTY_RESPONSES = 3;
let tickRunning = false;
let chatRunning = false;
let lastChatTime = 0;
let MIN_CHAT_INTERVAL = 2000;

// tool → 状态映射
const TOOL_STATUS = {
  mine: 'mining', chop: 'chopping', craft: 'crafting', smelt: 'smelting',
  place: 'building', attack: 'fighting', dodge: 'fighting',
  collect: 'collecting', give: 'giving', follow: 'following',
  wander: 'wandering', eat: 'eating', sleep: 'sleeping',
  goto: 'moving', stop: 'idle',
};

module.exports = {
  name: 'brain',
  version: '2.0.0',

  init(_bot, _deps) {
    bot = _bot;
    deps = _deps;
    logger.attach(bot);

    // 从配置读取常量
    MAX_EMPTY_RESPONSES = deps.config.brain?.maxEmptyResponses ?? 3;
    MIN_CHAT_INTERVAL = deps.config.brain?.minChatInterval ?? 2000;

    status = new StatusIndicator(bot);

    allTools = [];
    for (const plugin of deps.plugins) {
      if (plugin.tools?.length) allTools.push(...plugin.tools);
    }
    console.log(`[Brain] Collected ${allTools.length} tools`);

    // 初始化子代理管理器
    agentManager = new AgentManager(bot, deps);
  },

  start() {
    // 先停止旧循环（防止重生后双重循环）
    this.stop();
    const hb = deps.config.heartbeat || { interval: 15 };
    agentManager.start(2000);
    status.startReporting(deps.config.status?.reportInterval ?? 8000);

    this._autoLoop(hb.interval);
    logger.info('brain', `Auto-loop ${hb.interval}s | AgentManager 2s`);
  },

  stop() {
    this._stopped = true;
    agentManager.stop();
    status.stopReporting();
  },

  /** 自驱动循环：空闲就工作 */
  async _autoLoop(delaySec) {
    this._stopped = false;
    const loopId = Date.now();
    while (!this._stopped) {
      // 等待空闲：bot 在线、无 agent、无 tick 在跑、血量正常
      if (bot?.entity && bot.health > 0 && !agentManager.hasAgent && !tickRunning) {
        await this.tick();
      }
      // tick 执行完后等配置间隔再继续
      await new Promise(r => setTimeout(r, Math.max(delaySec * 1000, 3000)));
    }
    console.log(`[Brain] Auto-loop ${loopId} stopped`);
  },

  /** 心跳：自主决策 */
  async tick() {
    if (!bot?.entity || bot.health <= 0) return;
    if (agentManager.hasAgent) return;
    if (tickRunning) return;
    tickRunning = true;

    try {
      status.set('thinking', '自主决策');
      const ctx = deps.memory.getContext(bot);
      const result = await deps.llm.decideWithTools(ctx, allTools, lastToolResult);

      // LLM 调用期间可能死了，再次检查
      if (!bot?.entity || bot.health <= 0) {
        console.log('[Brain] Died during LLM call, discarding result');
        return;
      }

      if (result.reply) {
        console.log(`[Brain] Auto thought: ${result.reply.substring(0, 80)}`);
      }

      if (result.tool_calls) {
        emptyResponseCount = 0;
        const results = [];
        for (const tc of result.tool_calls) {
          if (!bot?.entity || bot.health <= 0) break;
          results.push(await this.executeToolCall(tc));
        }
        deps.llm.addToolResults(result.tool_calls, results);
        lastToolResult = this._formatResults(result.tool_calls, results);
      } else {
        emptyResponseCount++;
        if (emptyResponseCount >= MAX_EMPTY_RESPONSES) {
          console.log('[Brain] Too many empty responses, forcing wander');
          deps.llm.history = [];
          emptyResponseCount = 0;
          // 强制漫游打破死循环
          try { await this.executeToolCall({ function: { name: 'wander', arguments: '{}' } }); } catch {}
          lastToolResult = 'wander → forced';
        }
        lastToolResult = lastToolResult || '';
      }

      logger.llm('decide', ctx.position, result);
    } catch (err) {
      logger.error('brain', err);
    } finally {
      tickRunning = false;
    }
  },

  /** 处理玩家聊天 */
  async onChat(username, message) {
    if (!bot?.entity) return;
    if (chatRunning) return;  // 正在处理上一条消息
    chatRunning = true;

    try {
      deps.memory.addChat(username, message);
      logger.chat(username, message);

      // 统一走 LLM 理解 → 执行，不再区分简单/复杂
      await this._handleSimple(username, message);
    } finally {
      chatRunning = false;
    }
  },

  /** 简单指令：直接执行 */
  async _handleSimple(username, message) {
    try {
      status.set('thinking', `理解: "${message}"`);
      const ctx = deps.memory.getContext(bot);
      let result = await deps.llm.understandWithTools(message, ctx, allTools);

      // 空响应 → 重试一次
      if (!result.tool_calls && !result.reply) {
        console.log('[Brain] Empty response, retrying...');
        result = await deps.llm.understandWithTools(message, ctx, allTools);
      }

      // 还是空 → 强制回复
      if (!result.tool_calls && !result.reply) {
        bot.chat('嗯？');
        return;
      }

      // 纯对话 → chat reply
      if (result.reply && !result.tool_calls) {
        bot.chat(result.reply);
        lastChatTime = Date.now();
        return;
      }

      // 有工具调用 → 执行
      if (result.tool_calls) {
        const results = [];
        for (const tc of result.tool_calls) results.push(await this.executeToolCall(tc));
        deps.llm.addToolResults(result.tool_calls, results);
        lastToolResult = this._formatResults(result.tool_calls, results);
      }

      logger.llm('understand', message, result);
    } catch (err) {
      logger.error('brain/chat', err);
    }
  },

  _formatResults(toolCalls, results) {
    return toolCalls.map((tc, i) => {
      const r = results[i];
      const name = tc.function.name;
      // 持续性操作标记为 running，避免 LLM 重复调用
      const ongoing = ['follow', 'wander', 'goto'].includes(name);
      if (ongoing) return `${name} → running`;
      const s = r === true ? 'ok' : r === false ? 'fail' : typeof r === 'string' ? r.substring(0, 30) : `${r}`;
      return `${name} → ${s}`;
    }).join('; ');
  },

  async executeToolCall(tc) {
    const name = tc.function.name;
    let args = {};
    try {
      args = JSON.parse(tc.function.arguments || '{}');
    } catch (e) {
      const raw = (tc.function.arguments || '{}').trim();
      console.log(`[Brain] JSON parse failed, raw: ${raw.substring(0, 100)}`);
      try {
        // 修复尾部多余逗号
        args = JSON.parse(raw.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
      } catch {
        logger.error('brain/parseArgs', e);
      }
    }

    // 更新状态
    const stateName = TOOL_STATUS[name] || name;
    status.set(stateName, JSON.stringify(args).substring(0, 60));

    console.log(`[ToolCall] ${name}(${JSON.stringify(args)})`);

    for (const plugin of deps.plugins) {
      if (plugin.actions?.[name]) {
        logger.action(plugin.name, name);
        try {
          const r = await plugin.actions[name](args);
          logger.action(plugin.name, name, r);
          deps.memory.lastAction = name;
          status.set('idle');
          return r;
        } catch (err) {
          logger.error(`${plugin.name}/${name}`, err);
          status.set('error', err.message);
          return false;
        }
      }
    }

    console.log(`[Brain] No handler: "${name}"`);
    status.set('idle');
    return false;
  },
};

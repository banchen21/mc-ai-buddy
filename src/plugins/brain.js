/**
 * 🧠 brain 插件 — 大脑：心跳驱动 + 事件路由 + 子代理调度
 * 简单指令 → 直接执行 | 复杂指令 → AgentManager 拆解并行
 */
const logger = require('../core/logger');
const { AgentManager } = require('../core/agent-manager');
const { StatusIndicator } = require('../core/status-indicator');

let bot, deps, interval;
let allTools = [];
let lastToolResult = '';
let agentManager = null;
let status = null;
let emptyResponseCount = 0;   // 空响应计数器（防止死循环）
const MAX_EMPTY_RESPONSES = 3;
let tickRunning = false;      // 防止心跳重叠
let chatRunning = false;      // 防止聊天处理和心跳重叠
let lastChatTime = 0;         // 上次聊天时间（防 spam）
const MIN_CHAT_INTERVAL = 2000; // 最小聊天间隔 2 秒

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
    const hb = deps.config.heartbeat || { interval: 30 };

    interval = setInterval(() => this.tick(), hb.interval * 1000);
    agentManager.start(2000);
    status.startReporting(8000);

    logger.info('brain', `Heartbeat ${hb.interval}s | AgentManager 2s`);
  },

  stop() {
    clearInterval(interval);
    agentManager.stop();
    status.stopReporting();
  },

  /** 心跳：自主决策 */
  async tick() {
    if (!bot?.entity) return;
    if (agentManager.hasAgent) return;  // 代理执行中，心跳跳过
    if (tickRunning) return;  // 防止重叠调用导致 LLM history 污染
    tickRunning = true;

    try {
      status.set('thinking', '自主决策');
      const ctx = deps.memory.getContext(bot);
      const result = await deps.llm.decideWithTools(ctx, allTools, lastToolResult);

      if (result.reply) {
        // 心跳自主决策不聊天，只记日志
        console.log(`[Brain] Auto thought: ${result.reply.substring(0, 80)}`);
      }

      if (result.tool_calls) {
        emptyResponseCount = 0;
        const results = [];
        for (const tc of result.tool_calls) results.push(await this.executeToolCall(tc));
        deps.llm.addToolResults(result.tool_calls, results);
        lastToolResult = this._formatResults(result.tool_calls, results);
      } else {
        emptyResponseCount++;
        if (emptyResponseCount >= MAX_EMPTY_RESPONSES) {
          console.log('[Brain] Too many empty responses, clearing LLM history');
          deps.llm.history = [];
          emptyResponseCount = 0;
        }
        lastToolResult = '';
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
      const result = await deps.llm.understandWithTools(message, ctx, allTools);

      // 有工具调用时，reply 只是 LLM 的思考过程，不 chat
      // 只有纯对话（无 tool_calls）时才 chat reply
      if (result.reply && !result.tool_calls) {
        bot.chat(result.reply);
        lastChatTime = Date.now();
      }

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
      const s = r === true ? '✅' : r === false ? '❌' : r === 0 ? '⚠️0' : `${r}`;
      return `${tc.function.name} → ${s}`;
    }).join('; ');
  },

  async executeToolCall(tc) {
    const name = tc.function.name;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { logger.error('brain/parseArgs', e); }

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

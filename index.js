/**
 * MC AI Buddy v3.0 — 分层架构
 *
 * 架构：
 *   玩家输入 → 输入路由器 → 调度器/对话管理器
 *                                │
 *                           任务队列
 *                                │
 *                           低层执行器
 *                                │
 *                           生存本能 (每50ms)
 *                                │
 *                         Minecraft 客户端
 *
 * LLM 调用点（共 4 个）：
 *   1. 输入路由器 — 分类 + 规划（一次性）
 *   2. 自主决策 — 空闲时观察环境并行动（心跳驱动）
 *   3. 调度器 — 遇到新问题时规划（兜底）
 *   4. 对话管理器 — 生成聊天回复
 */

const mineflayer = require('mineflayer');
const config = require('./config.json');
const { LLM } = require('./src/core/llm');
const { Memory } = require('./src/core/memory');
const { InputRouter } = require('./src/core/input-router');
const { Scheduler } = require('./src/core/scheduler');
const { LowLevelExecutor } = require('./src/core/low-level-executor');
const { SurvivalInstinct } = require('./src/core/survival-instinct');
const { DialogueManager } = require('./src/core/dialogue-manager');
const logger = require('./src/core/logger');

// ===== 插件列表 =====
const PLUGINS = [
  require('./src/plugins/chat'),
  require('./src/plugins/move'),
  require('./src/plugins/craft'),
  require('./src/plugins/build'),
  require('./src/plugins/give'),
  require('./src/plugins/use'),
  require('./src/plugins/left-click'),
  require('./src/plugins/search'),
];

// ===== 全局状态 =====
let globalReconnectCount = 0;
let reconnecting = false;
const MAX_RECONNECT = config.reconnect?.maxAttempts ?? 5;

// ===== 主循环状态 =====
let gameLoopRunning = false;
let gameLoopId = null;
let lastHealth = 0;
let healthReady = false;
let lastLoopTime = 0;
let loopStallCount = 0;

// ===== 自主决策状态 =====
let allTools = [];                  // 所有插件的 tools 定义
let lastAutonomousDecision = 0;    // 上次自主决策时间戳
const AUTONOMOUS_COOLDOWN = 5000;  // 自主决策冷却 (ms)
let autonomousBusy = false;        // 自主决策进行中
let lastActionResult = '';         // 上次动作结果（反馈给 LLM）

// ===== 核心模块引用 =====
let llm, memory, inputRouter, scheduler, lowLevel, survival, dialogue;

async function main() {
  const { host, port, username, version } = config.bot;

  console.log(`[MC AI Buddy v3] Connecting to ${host}:${port} as "${username}"...`);

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    version: version || false,
    auth: host === 'localhost' || host === '127.0.0.1' ? 'offline' : 'microsoft',
    reconnect: false,
  });

  // ===== 初始化核心模块 =====
  llm = new LLM(config.deepseek);
  memory = new Memory();
  logger.attach(bot);

  inputRouter = new InputRouter(llm);
  dialogue = new DialogueManager(llm, memory);

  const deps = { llm, memory, config, plugins: PLUGINS };

  scheduler = new Scheduler(bot, deps);
  lowLevel = new LowLevelExecutor(bot, deps);
  survival = new SurvivalInstinct(bot, deps);

  // 注册插件（静默加载）
  for (const plugin of PLUGINS) {
    plugin.init(bot, deps);
  }

  // 收集所有动作处理器
  lowLevel.collectActions(PLUGINS);

  // 收集所有插件的 tools 定义（供自主决策用）
  allTools = PLUGINS.flatMap(p => p.tools || []);

  // ===== 事件路由 =====

  bot.once('spawn', () => {
    console.log(`[MC AI Buddy] Spawned at ${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)}`);
    globalReconnectCount = 0;

    // 启动插件
    for (const plugin of PLUGINS) plugin.start();

    // 启动主循环
    startGameLoop(bot);
  });

  // 聊天 → 输入路由器
  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;
    await handleChatMessage(bot, username, message);
  });

  // 死亡
  bot.on('death', () => {
    const cause = memory.perception.lastAttacker || 'unknown';
    const pos = bot.entity?.position;
    const loc = pos ? `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}` : '?';
    console.log(`[MC AI Buddy] 💀 Died at ${loc}, cause: ${cause}`);
    memory.recordDeath(`at ${cause}`);
    memory.learnLesson('death', `Died at ${loc} - ${cause}`);

    scheduler.clear();
    llm.history = [];
    memory.perception.clearThreat();
    survival.reset();
  });

  // 重生
  bot.on('respawn', () => {
    console.log('[MC AI Buddy] 🔄 Respawned');
    scheduler.clear();
    llm.history = [];
    memory.perception.clearThreat();
    survival.reset();
    lowLevel.collectActions(PLUGINS);
  });

  // 踢出/断线
  bot.on('kicked', (reason) => {
    console.log(`[MC AI Buddy] 👢 Kicked: ${JSON.stringify(reason)}`);
    handleDisconnect(bot, reason, 'kicked');
  });
  bot.on('end', (reason) => {
    console.log(`[MC AI Buddy] 🔌 Disconnected: ${reason}`);
    if (!reconnecting) handleDisconnect(bot, reason, 'end');
  });
  bot.on('error', (err) => console.error(`[MC AI Buddy] ❌ ${err.message}`));

  // 优雅退出
  if (!main._sigintRegistered) {
    main._sigintRegistered = true;
    process.on('SIGINT', () => {
      console.log('\n[MC AI Buddy] Shutting down...');
      for (const plugin of PLUGINS) plugin.stop?.();
      process.exit(0);
    });
  }
}

// ===== 主循环 =====

function startGameLoop(bot) {
  if (gameLoopRunning) return;
  gameLoopRunning = true;
  lastLoopTime = Date.now();
  loopStallCount = 0;

  const TICK_MS = 50; // 20 FPS

  const loop = async () => {
    if (!gameLoopRunning) return;

    const loopStart = Date.now();
    try {
      // ========== 伤害检测 ==========
      if (bot?.entity && typeof bot.health === 'number' && bot.health > 0) {
        if (!healthReady) {
          healthReady = true;
          lastHealth = bot.health;
        } else if (bot.health < lastHealth - 0.1) {
          const dmg = Math.round((lastHealth - bot.health) * 10) / 10;
          if (dmg > 0) {
            survival.recordDamage(dmg);
            memory.perception.underAttack = true;
          }
        }
        lastHealth = bot.health;
      }

      // ========== 第 0 优先级：生存本能 ==========
      const survivalTriggered = survival.check();
      if (survivalTriggered) {
        scheduler.clear();
        gameLoopId = setTimeout(loop, TICK_MS);
        return;
      }

      // ========== 第 1 优先级：执行任务队列 ==========
      if (scheduler.hasTasks) {
        const action = scheduler.nextAction();
        if (action) {
          const result = await lowLevel.execute(action);

          if (result === 'running') {
            scheduler.markComplete();
            lastActionResult = '';
          } else if (result === true || (typeof result === 'number' && result > 0)) {
            scheduler.markComplete();
            lastActionResult = `✅ ${action.action} succeeded`;
          } else if (lowLevel.isRecoverable(result)) {
            const ctx = memory.getContext(bot);
            const fix = await scheduler.handleFailure(String(result), ctx);
            lastActionResult = `⚠️ ${action.action}: ${result}`;
            if (!fix.handled) {
              scheduler.markComplete();
            }
          } else {
            const ctx = memory.getContext(bot);
            await scheduler.handleFailure(String(result), ctx);
            lastActionResult = `❌ ${action.action}: ${result}`;
          }
        }
      }

      // ========== 第 1.5 优先级：自主决策（空闲时） ==========
      if (!scheduler.hasTasks && !autonomousBusy) {
        const now = Date.now();
        if (now - lastAutonomousDecision >= AUTONOMOUS_COOLDOWN) {
          lastAutonomousDecision = now;
          autonomousBusy = true;

          try {
            const ctx = memory.getContext(bot);
            const decision = await llm.decideWithTools(ctx, allTools, lastActionResult);

            if (decision?.tool_calls?.length > 0) {
              // 将 LLM 返回的 tool_calls 转为任务队列
              const steps = [];
              for (const tc of decision.tool_calls) {
                try {
                  steps.push({
                    action: tc.function.name,
                    params: JSON.parse(tc.function.arguments || '{}'),
                  });
                } catch (parseErr) {
                  console.error(`[Autonomous] JSON parse error for ${tc.function.name}: ${parseErr.message}`);
                  steps.push({ action: tc.function.name, params: {} });
                }
              }
              console.log(`[Autonomous] 🧠 Decided: ${steps.map(s => s.action).join(' → ')}`);

              // 追加 tool 结果到 LLM 历史（DeepSeek 要求 tool_calls 后必须有 tool 消息）
              llm.addToolResults(decision.tool_calls, steps.map(() => 'ok'));
              scheduler.setQueue(steps);
              lastActionResult = '';
            } else {
              // LLM 觉得没事做，延长冷却
              lastAutonomousDecision = now - AUTONOMOUS_COOLDOWN + 10000;
              lastActionResult = '';
            }
          } catch (err) {
            logger.error('autonomous', err);
            lastAutonomousDecision = now - AUTONOMOUS_COOLDOWN + 15000;
          } finally {
            autonomousBusy = false;
          }
        }
      }

      // ========== 第 2 优先级：发送对话回复 ==========
      _flushReplies(bot);
    } catch (err) {
      logger.error('gameLoop', err);
    }

    // ========== 心跳监控 ==========
    const elapsed = Date.now() - loopStart;
    if (elapsed > TICK_MS * 3) {
      loopStallCount++;
      if (loopStallCount > 10) {
        console.log(`[MC AI Buddy] ⚠️ Loop stalled ${loopStallCount} times (${elapsed}ms)`);
      }
    } else {
      loopStallCount = Math.max(0, loopStallCount - 1);
    }
    lastLoopTime = Date.now();

    gameLoopId = setTimeout(loop, TICK_MS);
  };

  gameLoopId = setTimeout(loop, TICK_MS);
}

function stopGameLoop() {
  gameLoopRunning = false;
  if (gameLoopId) {
    clearTimeout(gameLoopId);
    gameLoopId = null;
  }
}

/** 发送对话回复（去重逻辑集中） */
function _flushReplies(bot) {
  if (!dialogue.hasPendingReplies) return;
  const reply = dialogue.nextReply();
  if (reply) {
    const clean = reply.replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '').substring(0, 80);
    if (clean) bot.chat(clean);
  }
}

// ===== 聊天处理 =====

async function handleChatMessage(bot, username, message) {
  memory.addChat(username, message);
  logger.chat(username, message);

  // 调试命令
  if (message.startsWith('!exp')) {
    const status = scheduler.getStatus();
    const edb = status.experienceDB;
    bot.chat(`📚 经验库: ${edb.active}条活跃/${edb.total}条总计 | 废弃:${edb.deprecated} | 均成功率:${edb.avgSuccessRate}`);
    bot.chat(`📊 调度: L1缓存:${status.stats.cacheHits} L2经验:${status.stats.experienceHits} L3-LLM:${status.stats.llmPlans}`);
    return;
  }
  if (message.startsWith('!status')) {
    const s = scheduler.getStatus();
    bot.chat(`📡 队列:${s.queueLength} | 目标:${s.currentGoal || '无'} | 当前:${s.currentAction?.action || '无'}`);
    return;
  }
  if (message.startsWith('!stop')) {
    scheduler.clear();
    lowLevel.cancel();
    bot.chat('已停止所有任务');
    return;
  }

  // 输入路由
  const ctx = memory.getContext(bot);
  const routed = await inputRouter.route(message, username, ctx);

  if (routed.type === 'command') {
    const plan = await scheduler.planCommand(routed, ctx);
    if (plan.queue.length > 0) {
      console.log(`[Scheduler] Queue: ${plan.queue.map(a => a.action).join(' → ')}`);
    }
  } else if (routed.type === 'dialogue') {
    await dialogue.handleDialogue(message, username, ctx);
    _flushReplies(bot);
  }
}

// ===== 断线重连 =====

function handleDisconnect(bot, reason, type) {
  const reasonStr = JSON.stringify(reason);
  if (reconnecting) return;

  stopGameLoop();
  scheduler.clear();
  healthReady = false;

  globalReconnectCount++;
  if (globalReconnectCount > MAX_RECONNECT) {
    console.log(`[MC AI Buddy] Max reconnect (${MAX_RECONNECT}) reached. Giving up.`);
    process.exit(1);
  }

  reconnecting = true;

  for (const plugin of PLUGINS) {
    try { plugin.stop?.(); } catch (e) { logger.error('plugin/stop', e); }
  }

  // 先移除所有监听，防止后续 error 事件导致崩溃
  try { bot._client?.removeAllListeners?.(); } catch {}
  bot.removeAllListeners();

  const isDup = reasonStr.includes('duplicate_login');
  const delay = isDup
    ? (config.reconnect?.duplicateLoginDelay ?? 30000)
    : (config.reconnect?.normalDelay ?? 5000);

  console.log(`[MC AI Buddy] Reconnecting in ${delay / 1000}s... (${globalReconnectCount}/${MAX_RECONNECT})`);

  setTimeout(() => {
    try { bot._client?.end(); } catch {}
    try { bot.end?.(); } catch {}
  }, 100);

  setTimeout(async () => {
    reconnecting = false;
    try { await main(); } catch (e) { logger.error('main/reconnect', e); }
  }, delay);
}

// ===== 启动 =====

main().catch((err) => {
  logger.error('main/fatal', err);
  console.error('[MC AI Buddy] Fatal:', err.message);
  process.exit(1);
});

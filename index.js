/**
 * MC AI Buddy — Mineflayer + OpenAI-compatible LLM
 */

const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder');
const config = require('./config.json');
const { LLM } = require('./src/core/llm');
const { Agent } = require('./src/core/agent');
const logger = require('./src/core/logger');
const { MessageModule } = require('./src/tool_modules/chat/message');
const { Journal } = require('./src/tool_modules/chat/journal');
const { MemoryModule } = require('./src/tool_modules/chat/memory');
const { ActionModule } = require('./src/tool_modules/action/action');
const { QueryModule } = require('./src/tool_modules/query/query');
const { MoveModule } = require('./src/tool_modules/action/move');
const { InteractModule } = require('./src/tool_modules/action/interact');
const { CraftModule } = require('./src/tool_modules/action/craft');
const { PassiveModule } = require('./src/tool_modules/passive/passive');
const { VoiceModule } = require('./src/tool_modules/chat/voice');
const { STTModule } = require('./src/tool_modules/chat/stt');

// ===== 全局状态 =====
let globalReconnectCount = 0;
let reconnecting = false;
const MAX_RECONNECT = config.reconnect?.maxAttempts ?? 5;

// ===== 核心模块引用 =====
let llm, agent, messageModule, journal, actionModule;

async function main() {
  const { host, port, username, version } = config.bot;

  console.log(`[MC AI Buddy] Connecting to ${host}:${port} as "${username}"...`);

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    version: version || false,
    auth: host === 'localhost' || host === '127.0.0.1' ? 'offline' : 'microsoft',
    reconnect: false,
  });

  // ===== 初始化核心模块 =====
  llm = new LLM(config.llm);
  agent = new Agent(llm, { maxRounds: config.llm.maxRounds ?? 50 });
  logger.attach(bot);
  bot.loadPlugin(pathfinder.pathfinder);

  const deps = { llm, agent, config };

  // ===== 初始化日志记忆模块 =====
  journal = new Journal(bot, deps);
  journal.init();
  deps.journal = journal;

  // 恢复 LLM 对话历史
  llm.history = journal.loadHistory();
  // 每次 LLM 调用后自动保存历史
  llm._onHistoryChange = (history) => journal.saveHistory(history);

  // ===== 初始化消息模块 =====
  messageModule = new MessageModule(bot, deps);
  messageModule.init();
  deps.messageModule = messageModule;

  // ===== 初始化语音模块 =====
  const voiceModule = new VoiceModule(bot, deps);
  voiceModule.init();
  deps.voiceModule = voiceModule;

  // ===== 初始化行为模块（Agent 模式） =====
  actionModule = new ActionModule(bot, deps);

  // 注册工具到 Agent
  agent.registerModule(new QueryModule(bot, deps));
  agent.registerModule(new MoveModule(bot, deps));
  agent.registerModule(new InteractModule(bot, deps));
  agent.registerModule(new CraftModule(bot));
  const memoryModule = new MemoryModule(bot, deps);
  memoryModule.init();
  agent.registerModule(memoryModule);

  // 注入人格到 Agent
  agent.setPersona(messageModule._persona);

  // 中间回复实时发送到游戏 + 语音
  agent._onChat = (msg) => {
    messageModule.send(msg);
    voiceModule.speak(msg);
  };

  // ===== 初始化 STT 语音识别 =====
  const sttModule = new STTModule(bot, deps);
  sttModule.init();
  sttModule.onTranscription(async (text, playerName) => {
    const result = await handleUserInput('voice', playerName, text);
    return result;
  });
  deps.sttModule = sttModule;

  // ===== 初始化被动模块（事件驱动，不经过 LLM） =====
  const passiveModule = new PassiveModule(bot, deps);
  passiveModule.init();
  deps.passiveModule = passiveModule;

  // 处理器链：action 统一处理（工具调用 + 纯聊天）
  messageModule.use(async (username, message) => {
    return await handleUserInput('text', username, message);
  });

  // ===== 优先级抢占：文字 > 语音 > 自主决策 =====
  let currentInteraction = null; // { type: 'text'|'voice', abort: { cancelled: false } }

  async function handleUserInput(type, username, message) {
    // 如果当前正在处理文字消息，语音不能抢占
    if (currentInteraction && currentInteraction.type === 'text' && type === 'voice') {
      console.log(`[Input] 🔇 语音忽略（文字消息处理中）`);
      return false;
    }

    // 打断当前交互（文字打断语音或自主决策，语音打断语音或自主决策）
    if (currentInteraction) {
      currentInteraction.abort.cancelled = true;
      console.log(`[Input] ⏹️ 打断当前 ${currentInteraction.type} 任务`);
    }

    const abort = { cancelled: false };
    currentInteraction = { type, abort };

    // 同时打断自主决策
    autoAbort.cancelled = true;
    if (autoDecisionTimer) {
      clearTimeout(autoDecisionTimer);
      autoDecisionTimer = null;
    }

    try {
      const result = await actionModule.handleCommand(username, message, { abortSignal: abort });
      return result;
    } finally {
      if (currentInteraction?.abort === abort) {
        currentInteraction = null;
      }
      autoAbort.cancelled = false;
      if (config.autoDecision?.enabled && !autoDecisionRunning) {
        autoDecisionTimer = setTimeout(autoDecisionLoop, 10000);
      }
    }
  }

  // ===== 自主决策循环 =====
  let autoDecisionRunning = false;
  let autoDecisionTimer = null;
  const autoAbort = { cancelled: false };

  async function autoDecisionLoop() {
    if (!config.autoDecision?.enabled) return;
    if (autoDecisionRunning) return;
    // 玩家交互中或语音处理中，等空闲再启动
    if (currentInteraction) {
      autoDecisionTimer = setTimeout(autoDecisionLoop, 5000);
      return;
    }

    // 检查是否有活跃的 pathfinder 目标（跟随中等）
    const hasActiveGoal = bot.pathfinder?.goal && !bot.pathfinder?.goal?.reached;

    // 只在空闲时启动自主决策
    if (hasActiveGoal) {
      autoDecisionTimer = setTimeout(autoDecisionLoop, 5000);
      return;
    }

    autoDecisionRunning = true;
    try {
      console.log('[Auto] 🤔 自主决策：思考下一步...');
      autoAbort.cancelled = false;
      const result = await agent.handle('system',
        '请自行决策',
        { abortSignal: autoAbort }
      );
      if (result?.reply) {
        messageModule.send(result.reply);
      }
      // 清理自主决策产生的 history（不污染对话记忆）
      // stripToolHistory 会保留纯文本 user/assistant，但自主决策中
      // LLM 可能产生纯文本"幻觉回复"（如"烧好了！我们有铁锭了！"），
      // 这些也必须清理。最简单的方式：直接移除所有 system 用户的消息
      // 以及紧随其后的 assistant 回复。
      agent.llm.history = agent.llm.history.filter((msg, i, arr) => {
        // 移除 system 用户消息
        if (msg.role === 'user' && msg.name === 'system') return false;
        // 移除紧跟在 system 用户消息后的 assistant 回复（幻觉文本）
        if (msg.role === 'assistant' && i > 0 &&
            arr[i - 1].role === 'user' && arr[i - 1].name === 'system') {
          return false;
        }
        return true;
      });
      agent.llm.stripToolHistory();
    } catch (err) {
      console.log(`[Auto] ❌ ${err.message}`);
    } finally {
      autoDecisionRunning = false;
      // 完成后等待一段时间再检查
      autoDecisionTimer = setTimeout(autoDecisionLoop, 8000);
    }
  }

  // ===== 事件路由 =====

  bot.once('spawn', () => {
    console.log(`[MC AI Buddy] Spawned at ${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)}`);

    // 初始化 Pathfinder Movements（spawn 后 bot.pathfinder 才可用）
    const mcData = require('minecraft-data')(bot.version);
    const movements = new pathfinder.Movements(bot, mcData);
    bot.pathfinder.setMovements(movements);
    deps.movements = movements;

    globalReconnectCount = 0;

    // 延迟启动自主决策，等初始化完成
    setTimeout(() => {
      if (config.autoDecision?.enabled) {
        console.log('[Auto] 🧠 自主决策模式已启动');
        autoDecisionLoop();
      }
    }, 3000);
  });

  // 死亡
  bot.on('death', () => {
    const pos = bot.entity?.position;
    const loc = pos ? `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}` : '?';

    // 收集背包信息
    const items = bot.inventory?.items() || [];
    const invSummary = items.length > 0
      ? items.slice(0, 10).map(i => `${i.name} x${i.count}`).join(', ')
      : '空背包';
    const totalItems = items.length;

    // 收集装备信息
    const held = bot.heldItem ? `${bot.heldItem.name} x${bot.heldItem.count}` : '空手';

    // 获取击杀者（来自 combat 被动模块追踪的最后攻击者）
    const attacker = deps.passiveModule?._ctx?.lastAttacker;
    let killerInfo = '';
    if (attacker) {
      const aPos = attacker.position;
      const aLoc = aPos ? `(${Math.round(aPos.x)},${Math.round(aPos.y)},${Math.round(aPos.z)})` : '';
      const prefix = attacker.isPlayer ? '玩家 ' : '';
      killerInfo = `，击杀者: ${prefix}${attacker.name}${aLoc ? ` ${aLoc}` : ''}`;
    }

    console.log(`[MC AI Buddy] 💀 Died at ${loc}${killerInfo}`);

    // 注入事件到 LLM 记忆
    if (agent) {
      agent.injectEvent(
        `bot 已死亡！死亡位置: (${loc})` +
        `死亡后物品会掉落，需要尽快回去捡。`
      );
    }

    // 记录到日志
    if (journal) {
      journal.remember(`[死亡] 位置: (${loc})`);
      journal.incStat('deaths');
    }
  });

  // 重生
  bot.on('respawn', () => {
    const pos = bot.entity?.position;
    const loc = pos ? `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}` : '?';
    console.log(`[MC AI Buddy] 🔄 Respawned at ${loc}`);

    if (agent) {
      agent.injectEvent(`bot 已重生，当前位置: (${loc})。背包已清空，需要捡回死亡掉落的物品。`);
    }
    if (journal) {
      journal.remember(`[重生] 位置: (${loc})`);
    }
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
      process.exit(0);
    });
  }
}

// ===== 断线重连 =====

function handleDisconnect(bot, reason, type) {
  const reasonStr = JSON.stringify(reason);
  if (reconnecting) return;

  globalReconnectCount++;
  if (globalReconnectCount > MAX_RECONNECT) {
    console.log(`[MC AI Buddy] Max reconnect (${MAX_RECONNECT}) reached. Giving up.`);
    process.exit(1);
  }

  reconnecting = true;

  // 彻底关闭旧连接，防止 keepalive 超时等残留事件
  try { bot._client?.end(); } catch {}
  try { bot.end?.(); } catch {}
  try { bot._client?.removeAllListeners?.(); } catch {}
  bot.removeAllListeners();

  const isDup = reasonStr.includes('duplicate_login');
  const delay = isDup
    ? (config.reconnect?.duplicateLoginDelay ?? 30000)
    : (config.reconnect?.normalDelay ?? 5000);

  console.log(`[MC AI Buddy] Reconnecting in ${delay / 1000}s... (${globalReconnectCount}/${MAX_RECONNECT})`);

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

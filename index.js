/**
 * MC AI Buddy — Mineflayer + DeepSeek LLM
 */

const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder');
const config = require('./config.json');
const { LLM } = require('./src/core/llm');
const { Agent } = require('./src/core/agent');
const logger = require('./src/core/logger');
const { MessageModule } = require('./src/tool_modules/chat/message');
const { Memory } = require('./src/tool_modules/chat/memory');
const { ActionModule } = require('./src/tool_modules/action/action');
const { QueryModule } = require('./src/tool_modules/query/query');
const { MoveModule } = require('./src/tool_modules/action/move');
const { InteractModule } = require('./src/tool_modules/action/interact');
const { CraftModule } = require('./src/tool_modules/action/craft');

// ===== 全局状态 =====
let globalReconnectCount = 0;
let reconnecting = false;
const MAX_RECONNECT = config.reconnect?.maxAttempts ?? 5;

// ===== 核心模块引用 =====
let llm, agent, messageModule, memory, actionModule;

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
  llm = new LLM(config.deepseek);
  agent = new Agent(llm, { maxRounds: config.deepseek.maxRounds ?? 5 });
  logger.attach(bot);
  bot.loadPlugin(pathfinder.pathfinder);

  const deps = { llm, agent, config };

  // ===== 初始化记忆模块 =====
  memory = new Memory(bot, deps);
  memory.init();
  deps.memory = memory;

  // 恢复 LLM 对话历史（多轮对话记忆）
  llm.history = memory.loadHistory();
  // 每次 LLM 调用后自动保存历史
  llm._onHistoryChange = (history) => memory.saveHistory(history);

  // ===== 初始化消息模块 =====
  messageModule = new MessageModule(bot, deps);
  messageModule.init();
  deps.messageModule = messageModule;

  // ===== 初始化行为模块（Agent 模式） =====
  actionModule = new ActionModule(bot, deps);

  // 注册工具到 Agent
  agent.registerModule(new QueryModule(bot));
  agent.registerModule(new MoveModule(bot));
  agent.registerModule(new InteractModule(bot));
  agent.registerModule(new CraftModule(bot));

  // 注入人格到 Agent
  agent.setPersona(messageModule._persona);

  // 中间回复实时发送到游戏
  agent._onChat = (msg) => {
    messageModule.send(msg);
  };

  // 处理器链：action 统一处理（工具调用 + 纯聊天）
  messageModule.use(async (username, message) => {
    return actionModule.handleCommand(username, message);
  });

  // ===== 事件路由 =====

  bot.once('spawn', () => {
    console.log(`[MC AI Buddy] Spawned at ${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)}`);
    globalReconnectCount = 0;
  });

  // 死亡
  bot.on('death', () => {
    const pos = bot.entity?.position;
    const loc = pos ? `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}` : '?';
    console.log(`[MC AI Buddy] 💀 Died at ${loc}`);
  });

  // 重生
  bot.on('respawn', () => {
    console.log('[MC AI Buddy] 🔄 Respawned');
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

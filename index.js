/**
 * MC AI Buddy — 插件式自主 AI 伙伴
 * 入口：连接服务器 + 加载插件 + 事件路由
 */
const mineflayer = require('mineflayer');
const config = require('./config.json');
const { LLM } = require('./src/core/llm');
const { Memory } = require('./src/core/memory');
const logger = require('./src/core/logger');

// ===== 插件列表（注释即禁用） =====
const PLUGINS = [
  require('./src/plugins/brain'),
  require('./src/plugins/chat'),
  require('./src/plugins/move'),
  require('./src/plugins/gather'),
  require('./src/plugins/craft'),
  require('./src/plugins/build'),
  require('./src/plugins/combat'),
  require('./src/plugins/survive'),
  require('./src/plugins/give'),
  require('./src/plugins/use'),
  require('./src/plugins/search'),
];

// ===== 全局重连计数（跨 main() 调用持久化） =====
let globalReconnectCount = 0;
let reconnecting = false;
const MAX_RECONNECT = 5;

async function main() {
  const { host, port, username, version } = config.bot;

  console.log(`[MC AI Buddy] Connecting to ${host}:${port} as "${username}"...`);

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    version: version || false,
    auth: host === 'localhost' || host === '127.0.0.1' ? 'offline' : 'microsoft',
    // 禁用 mineflayer 自动重连，由我们自己的 kicked 事件统一管理
    reconnect: false,
  });

  // 初始化核心模块
  const llm = new LLM(config.deepseek);
  const memory = new Memory();
  logger.attach(bot);

  // 依赖注入
  const deps = { llm, memory, config, plugins: PLUGINS };

  // 注册所有插件
  for (const plugin of PLUGINS) {
    plugin.init(bot, deps);
    console.log(`[Plugin] ${plugin.name} v${plugin.version} loaded`);
  }

  // ===== 事件路由 =====

  bot.once('spawn', () => {
    console.log(`[MC AI Buddy] Spawned at ${bot.entity.position}`);

    // 成功连接 → 重置重连计数
    globalReconnectCount = 0;

    // 启动所有插件
    for (const plugin of PLUGINS) plugin.start();

    // 打招呼
    setTimeout(() => bot.chat('嘿！我是你的AI伙伴~'), 1000);
  });

  // 聊天 → brain 统一处理
  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const brain = PLUGINS.find(p => p.name === 'brain');
    brain?.onChat(username, message);
  });

  // 受伤 → 感知层记录 + combat 处理
  bot.on('entityHurt', (entity) => {
    if (entity && entity !== bot.entity) {
      memory.perception.recordDamage(
        { name: entity.name || entity.username || 'unknown', type: entity.type },
        0
      );
      // 把攻击者传给 combat，让它优先响应
      const combat = PLUGINS.find(p => p.name === 'combat');
      combat?.tick(entity);
    }
  });

  // 自身受到伤害
  bot.on('damage', (source) => {
    if (source) {
      memory.perception.recordDamage(
        { name: source?.name || source?.username || 'unknown', type: source?.type },
        0
      );
    }
  });

  // 死亡
  bot.on('death', () => {
    logger.info('bot', 'Died! Respawning...');
    memory.recordDeath(`at ${memory.perception.lastAttacker || 'unknown cause'}`);
    memory.learnLesson('death', `Died at ${Math.round(bot.entity?.position?.x || 0)},${Math.round(bot.entity?.position?.y || 0)},${Math.round(bot.entity?.position?.z || 0)} - be more careful`);
  });

  bot.on('kicked', (reason) => {
    const reasonStr = JSON.stringify(reason);
    logger.info('bot', `Kicked: ${reasonStr}`);
    if (reconnecting) return;

    globalReconnectCount++;
    if (globalReconnectCount > MAX_RECONNECT) {
      console.log(`[MC AI Buddy] Max reconnect attempts (${MAX_RECONNECT}) reached. Giving up.`);
      process.exit(1);
    }

    reconnecting = true;

    // 立即停掉所有插件
    for (const plugin of PLUGINS) {
      try { plugin.stop?.(); } catch (e) { logger.error('plugin/stop', e); }
    }

    // 移除所有事件监听
    bot.removeAllListeners();

    const isDup = reasonStr.includes('duplicate_login');
    // duplicate_login 需要更长的冷却时间，让服务端清理旧 session
    const delay = isDup ? 30000 : 5000;
    console.log(`[MC AI Buddy] Reconnecting in ${delay/1000}s... (attempt ${globalReconnectCount}/${MAX_RECONNECT})`);

    // 先等 2 秒确保 socket 完全关闭，再等 delay 后重连
    setTimeout(() => {
      try { bot._client?.end(); } catch {}
      try { bot.end?.(); } catch {}
    }, 100);

    setTimeout(async () => {
      try { await main(); } catch (e) { logger.error('main/reconnect', e); }
    }, delay);
  });

  bot.on('error', (err) => logger.error('bot', err));

  bot.on('end', (reason) => {
    logger.info('bot', `Disconnected: ${reason}`);
    // 如果 kicked 已经处理了重连，这里不再重复
    if (reconnecting) return;

    // 非主动断开的 end（如 socketClosed）→ 也尝试重连
    for (const plugin of PLUGINS) {
      try { plugin.stop?.(); } catch (e) { logger.error('plugin/stop', e); }
    }
    bot.removeAllListeners();

    if (reason === 'socketClosed' || reason === 'error') {
      reconnecting = true;
      globalReconnectCount++;
      if (globalReconnectCount > MAX_RECONNECT) {
        console.log(`[MC AI Buddy] Max reconnect attempts (${MAX_RECONNECT}) reached. Giving up.`);
        process.exit(1);
      }
      const delay = 5000;
      console.log(`[MC AI Buddy] Connection lost, reconnecting in ${delay/1000}s... (attempt ${globalReconnectCount}/${MAX_RECONNECT})`);
      setTimeout(async () => {
        try { await main(); } catch (e) { logger.error('main/reconnect', e); }
      }, delay);
    }
  });

  // 优雅退出（只注册一次）
  if (!main._sigintRegistered) {
    main._sigintRegistered = true;
    process.on('SIGINT', () => {
      console.log('\n[MC AI Buddy] Shutting down...');
      for (const plugin of PLUGINS) plugin.stop?.();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  logger.error('main/fatal', err);
  console.error('[MC AI Buddy] Fatal:', err.message);
  process.exit(1);
});

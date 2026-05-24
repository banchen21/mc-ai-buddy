/**
 * 💬 chat 插件 — 纯聊天能力
 */
const logger = require('../core/logger');

let bot, deps;

module.exports = {
  name: 'chat',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() {},
  stop() {},

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'chat',
        description: '在游戏公屏发送聊天消息',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: '要发送的消息，简短自然 ≤20字' },
          },
          required: ['message'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'inventory',
        description: '查看并报告背包物品',
        parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'status',
        description: '报告当前状态：位置、血量、饱食度',
        parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
      },
    },
  ],

  actions: {
    /** 纯聊天回复 */
    async chat(params) {
      const msg = params.message || params.question || '';
      if (msg) {
        bot.chat(msg);
        return true;
      }
      return false;
    },

    /** 报告背包 */
    async inventory() {
      const items = bot.inventory.items().map(i => `${i.name}×${i.count}`).join(', ');
      console.log(`[Chat] Inventory: ${items || 'empty'}`);
      return items || 'empty';
    },

    /** 报告状态 */
    async status() {
      const p = bot.entity.position;
      const s = `(${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}) HP:${Math.round(bot.health)} Food:${Math.round(bot.food)}`;
      console.log(`[Chat] Status: ${s}`);
      return s;
    },
  },
};

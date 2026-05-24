/**
 * 🚶 move 插件 — 移动：跟随、漫游、导航
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const logger = require('../core/logger');

let bot, deps;
let followTarget = null;
let followInterval = null;
let wanderInterval = null;

function stopFollow() {
  if (followInterval) { clearInterval(followInterval); followInterval = null; }
  followTarget = null;
  if (bot?.pathfinder) bot.pathfinder.setGoal(null);
}

function makeMovements() {
  const mcData = require('minecraft-data')(bot.version);
  const moves = new Movements(bot, mcData);
  moves.canDig = true;
  moves.allowParkour = true;
  moves.allow1by1towers = true;
  moves.canSwim = true;
  moves.digCost = 2;
  moves.placeCost = 2;

  // 实时检测背包中可用的垫脚方块
  const scaffoldItems = bot.inventory.items().filter(i =>
    /dirt|cobblestone|stone|netherrack|sandstone|planks|wool|deepslate|tuff|gravel/.test(i.name)
  );
  if (scaffoldItems.length > 0) {
    const ids = scaffoldItems.map(i => mcData.itemsByName[i.name]?.id).filter(Boolean);
    moves.scaffoldingBlocks = ids;
  } else {
    moves.scaffoldingBlocks = [];
  }
  return moves;
}

module.exports = {
  name: 'move',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() {
    bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
    // ready
  },
  stop() { this.actions.stop(); },

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'follow',
        description: '跟随指定玩家',
        parameters: {
          type: 'object',
          properties: {
            player: { type: 'string', description: '要跟随的玩家名' },
          },
          required: ['player'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'wander',
        description: '在附近随机漫游探索',
        parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'goto',
        description: '导航到指定坐标',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: '目标 X 坐标' },
            y: { type: 'number', description: '目标 Y 坐标' },
            z: { type: 'number', description: '目标 Z 坐标' },
          },
          required: ['x', 'y', 'z'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'stop',
        description: '停止所有移动（跟随/漫游/导航）',
        parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'dodge',
        description: '紧急闪避，随机方向跑15格',
        parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'tower',
        description: '在脚下垫方块向上爬（用于从坑里出来或爬高）',
        parameters: {
          type: 'object',
          properties: {
            height: { type: 'number', description: '要爬升的高度（格数），默认3' },
          },
          required: ['height'],
          additionalProperties: false,
        },
      },
    },
  ],

  actions: {
    /** 跟随玩家 */
    async follow(params) {
      const targetName = params?.player || params?.target;

      // 先停掉之前的跟随
      if (followInterval) { clearInterval(followInterval); followInterval = null; }
      followTarget = null;

      // 找目标玩家
      let target = null;
      if (targetName) {
        target = bot.players[targetName];
      }

      // 没指定或找不到 → 找最近的
      if (!target?.entity) {
        let nearest = null, nearestDist = Infinity;
        for (const [name, p] of Object.entries(bot.players)) {
          if (name === bot.username || !p.entity) continue;
          const d = bot.entity.position.distanceTo(p.entity.position);
          if (d < nearestDist) { nearestDist = d; nearest = p; }
        }
        target = nearest;
      }

      if (!target?.entity) {
        console.log('[Move] follow: no player entity found');
        return;
      }

      followTarget = target;
      bot.pathfinder.setMovements(makeMovements());

      console.log(`[Move] Following ${target.username || 'player'} at ${target.entity.position}`);

      followInterval = setInterval(() => {
        if (!followTarget?.entity) {
          stopFollow();
          console.log('[Move] follow: target lost');
          return;
        }

        const dist = bot.entity.position.distanceTo(followTarget.entity.position);

        // 到达 3 格内 → 停止跟随
        if (dist <= 3) {
          stopFollow();
          console.log('[Move] follow: arrived');
          return;
        }

        const goal = new goals.GoalFollow(followTarget.entity, 2);
        bot.pathfinder.setGoal(goal);
      }, 1000);
    },

    /** 漫游探索 */
    async wander() {
      bot.pathfinder.setMovements(makeMovements());

      const pos = bot.entity.position;
      const angle = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 40;
      const x = pos.x + Math.cos(angle) * dist;
      const z = pos.z + Math.sin(angle) * dist;

      bot.pathfinder.setGoal(new goals.GoalNear(x, pos.y, z, 2));
      logger.action('move', 'wander', `${Math.round(x)},${Math.round(z)}`);

      // 15 秒后自动停止漫游
      setTimeout(() => {
        try { bot.pathfinder?.setGoal(null); } catch {}
      }, 15000);
    },

    /** 导航到坐标 */
    async goto(params) {
      if (!params?.x && params?.x !== 0) return false;
      bot.pathfinder.setMovements(makeMovements());
      const goal = new goals.GoalNear(params.x, params.y ?? bot.entity.position.y, params.z, 2);
      bot.pathfinder.setGoal(goal);
      return 'running';
    },

    /** 停止移动 */
    async stop() {
      if (bot?.pathfinder) {
        stopFollow();
        if (wanderInterval) { clearInterval(wanderInterval); wanderInterval = null; }
        bot.pathfinder.setGoal(null);
      }
    },

    /** 闪避 */
    async dodge() {
      bot.pathfinder.setMovements(makeMovements());
      const pos = bot.entity.position;
      const angle = Math.random() * Math.PI * 2;
      const x = pos.x + Math.cos(angle) * 15;
      const z = pos.z + Math.sin(angle) * 15;
      bot.pathfinder.setGoal(new goals.GoalNear(x, pos.y, z, 2));
      logger.action('move', 'dodge');
    },

    /** 垫方块向上爬 */
    async tower(params) {
      const height = params?.height || 3;

      const scaffoldItem = bot.inventory.items().find(i =>
        /dirt|cobblestone|stone|netherrack|sandstone|planks|wool|deepslate/.test(i.name)
      );

      if (!scaffoldItem) {
        console.log('[Move] tower: no scaffold blocks');
        return false;
      }

      console.log(`[Move] Towering ${height} blocks`);

      for (let i = 0; i < height; i++) {
        const item = bot.inventory.items().find(it => it.name === scaffoldItem.name);
        if (!item) break;

        try {
          await bot.equip(item, 'hand');

          // 先跳起来，在空中看脚下放方块
          bot.setControlState('jump', true);
          await new Promise(r => setTimeout(r, 150));

          const pos = bot.entity.position.floored();
          const belowBlock = bot.blockAt(pos.offset(0, -1, 0));
          if (belowBlock && belowBlock.name !== 'air') {
            await bot.lookAt(pos.offset(0, -1, 0), true);
            await bot.placeBlock(belowBlock, new (require('vec3'))(0, 1, 0));
          }

          bot.setControlState('jump', false);
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          logger.error('move/tower', err);
          break;
        }
      }

      logger.action('move', 'tower', `${height} blocks`);
      return true;
    },
  },
};

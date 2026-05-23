/**
 * 🚶 move 插件 — 移动：跟随、漫游、导航
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const logger = require('../core/logger');

let bot, deps;
let followTarget = null;
let followInterval = null;
let wanderInterval = null;

function makeMovements() {
  const mcData = require('minecraft-data')(bot.version);
  const moves = new Movements(bot, mcData);
  moves.canDig = true;          // 允许挖掘挡路方块
  moves.allowParkour = true;    // 允许跑酷
  moves.allow1by1towers = true; // 允许垫方块爬升
  moves.digCost = 2;            // 降低挖掘成本，更愿意挖路
  moves.placeCost = 2;          // 降低放置成本，更愿意垫脚

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
    logger.info('move', 'ready');
  },
  stop() { this.actions.stop(); },

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'follow',
        description: '跟随指定玩家，不指定则跟随最近的玩家',
        parameters: {
          type: 'object',
          properties: {
            player: { type: 'string', description: '要跟随的玩家名（可选，不填则跟最近的人）' },
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
          this._stopFollow();
          console.log('[Move] follow: target lost');
          return;
        }

        const dist = bot.entity.position.distanceTo(followTarget.entity.position);

        // 到达 3 格内 → 停止跟随
        if (dist <= 3) {
          this._stopFollow();
          console.log('[Move] follow: arrived');
          return;
        }

        const goal = new goals.GoalFollow(followTarget.entity, 2);
        bot.pathfinder.setGoal(goal);
      }, 1000);
    },

    _stopFollow() {
      if (followInterval) { clearInterval(followInterval); followInterval = null; }
      followTarget = null;
      if (bot?.pathfinder) bot.pathfinder.setGoal(null);
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

      // 到达后自动停止
      setTimeout(() => {
        if (bot.pathfinder.goal) {
          bot.pathfinder.setGoal(null);
        }
      }, 15000);
    },

    /** 导航到坐标 */
    async goto(params) {
      if (!params?.x && params?.x !== 0) return;
      bot.pathfinder.setMovements(makeMovements());
      const goal = new goals.GoalNear(params.x, params.y ?? bot.entity.position.y, params.z, 2);
      bot.pathfinder.setGoal(goal);
    },

    /** 停止移动 */
    async stop() {
      if (bot?.pathfinder) {
        this._stopFollow();
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

        const pos = bot.entity.position.floored();
        // 参考方块：脚下那一格
        const refBlock = bot.blockAt(pos.offset(0, -1, 0));
        if (!refBlock || refBlock.name === 'air') {
          console.log('[Move] tower: no solid block below feet');
          break;
        }

        try {
          await bot.equip(item, 'hand');
          // 把方块放在参考方块的上方 = 自己脚下
          await bot.placeBlock(refBlock, new (require('vec3'))(0, 1, 0));
          // 等方块放置完成
          await new Promise(r => setTimeout(r, 200));
          // 跳跃到新放的方块上
          bot.setControlState('jump', true);
          await new Promise(r => setTimeout(r, 200));
          bot.setControlState('jump', false);
          await new Promise(r => setTimeout(r, 200));
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

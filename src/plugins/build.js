/**
 * 🏗️ build 插件 — 建造：放置方块
 * 支持指定坐标、朝向、相对位置放置
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const logger = require('../core/logger');

let bot, deps;

function makeMovements() {
  const mcData = require('minecraft-data')(bot.version);
  const moves = new Movements(bot, mcData);
  moves.canDig = false;
  moves.canSwim = true;
  return moves;
}

module.exports = {
  name: 'build',
  version: '2.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() {},
  stop() {},

  tools: [
    {
      type: 'function',
      function: {
        name: 'place',
        description: '在指定位置放置方块。支持绝对坐标(x,y,z)、相对方向(forward/back/left/right/up/down)、或面前自动找空地',
        parameters: {
          type: 'object',
          properties: {
            block: { type: 'string', description: '方块英文名，如 crafting_table, furnace, torch, oak_planks, stone, cobblestone' },
            x: { type: 'number', description: '目标 X 坐标（绝对坐标模式）' },
            y: { type: 'number', description: '目标 Y 坐标（绝对坐标模式）' },
            z: { type: 'number', description: '目标 Z 坐标（绝对坐标模式）' },
            direction: { type: 'string', description: '相对方向：forward(面前), back(身后), left, right, up(头顶), down(脚下)。与坐标二选一' },
            face: { type: 'string', description: '放置面朝向：north, south, east, west, up, down。默认根据方向自动判断' },
          },
          required: ['block'],
          additionalProperties: false,
        },
      },
    },
  ],

  actions: {
    /**
     * 放置方块
     * 支持三种模式：
     *   1. 绝对坐标：place({ block: 'stone', x: 100, y: 64, z: 200 })
     *   2. 相对方向：place({ block: 'torch', direction: 'forward' })
     *   3. 自动找空地：place({ block: 'crafting_table' })  ← 默认
     */
    async place(params) {
      const blockName = (params.block || '').toLowerCase().replace(/\s+/g, '_');

      // 找物品
      const item = bot.inventory.items().find(i =>
        i.name === blockName || i.name.includes(blockName)
      );

      if (!item) {
        console.log(`[Build] No ${blockName} in inventory`);
        return false;
      }

      // 模式 1：绝对坐标
      if (params.x !== undefined && params.y !== undefined && params.z !== undefined) {
        return this._placeAt(item, params);
      }

      // 模式 2：相对方向
      if (params.direction) {
        return this._placeDirection(item, params);
      }

      // 模式 3：自动找空地（默认）
      return this._placeAuto(item, blockName);
    },

    /**
     * 在绝对坐标放置方块
     */
    async _placeAt(item, params) {
      const { x, y, z, face } = params;
      const targetPos = new (require('vec3'))(Math.floor(x), Math.floor(y), Math.floor(z));

      // 检查目标位置是否为空
      const targetBlock = bot.blockAt(targetPos);
      if (!targetBlock) {
        console.log(`[Build] Cannot see block at ${x},${y},${z}`);
        return false;
      }

      if (targetBlock.name !== 'air' && targetBlock.name !== 'cave_air' && targetBlock.name !== 'water') {
        console.log(`[Build] Target occupied: ${targetBlock.name} at ${x},${y},${z}`);
        return false;
      }

      // 找放置的参考面（目标位置相邻的固体方块）
      const refBlock = this._findAdjacentSolid(targetPos, face);
      if (!refBlock) {
        console.log(`[Build] No solid face to place against at ${x},${y},${z}`);
        return false;
      }

      // 走到目标旁边
      const dist = bot.entity.position.distanceTo(targetPos);
      if (dist > 4) {
        bot.pathfinder.setMovements(makeMovements());
        try {
          await bot.pathfinder.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2));
        } catch {
          bot.pathfinder.setGoal(null);
          console.log('[Build] Cannot reach target');
          return false;
        }
        bot.pathfinder.setGoal(null);
      }

      // 放置
      try {
        await bot.equip(item, 'hand');
        const placeVec = targetPos.clone().subtract(refBlock.position);
        await bot.placeBlock(refBlock, placeVec);
        console.log(`[Build] Placed ${item.name} at ${targetPos.x},${targetPos.y},${targetPos.z}`);
        logger.action('build', 'place', `${item.name}@${targetPos.x},${targetPos.y},${targetPos.z}`);
        return true;
      } catch (err) {
        logger.error('build/placeAt', err);
        return false;
      }
    },

    /**
     * 按相对方向放置方块
     */
    async _placeDirection(item, params) {
      const dir = params.direction.toLowerCase();
      const pos = bot.entity.position.floored();
      const yaw = bot.entity.yaw;

      // 计算方向偏移
      let dx = 0, dy = 0, dz = 0;
      switch (dir) {
        case 'forward':
        case 'front':
          dx = -Math.sin(yaw);
          dz = -Math.cos(yaw);
          break;
        case 'back':
        case 'behind':
          dx = Math.sin(yaw);
          dz = Math.cos(yaw);
          break;
        case 'left':
          dx = -Math.cos(yaw);
          dz = Math.sin(yaw);
          break;
        case 'right':
          dx = Math.cos(yaw);
          dz = -Math.sin(yaw);
          break;
        case 'up':
        case 'above':
          dy = 1;
          break;
        case 'down':
        case 'below':
          dy = -1;
          break;
        default:
          console.log(`[Build] Unknown direction: ${dir}`);
          return false;
      }

      const targetPos = pos.offset(Math.round(dx), dy, Math.round(dz));
      const targetBlock = bot.blockAt(targetPos);

      if (!targetBlock || (targetBlock.name !== 'air' && targetBlock.name !== 'cave_air' && targetBlock.name !== 'water')) {
        console.log(`[Build] ${dir} occupied: ${targetBlock?.name || '?'}`);
        return false;
      }

      // 找参考面
      const refBlock = this._findAdjacentSolid(targetPos, params.face);
      if (!refBlock) {
        console.log(`[Build] No solid face ${dir}`);
        return false;
      }

      try {
        await bot.equip(item, 'hand');
        const placeVec = targetPos.clone().subtract(refBlock.position);
        await bot.placeBlock(refBlock, placeVec);
        console.log(`[Build] Placed ${item.name} ${dir}`);
        logger.action('build', 'place', `${item.name} ${dir}`);
        return true;
      } catch (err) {
        logger.error('build/placeDir', err);
        return false;
      }
    },

    /**
     * 自动在脚下周围找空地放置（默认模式）
     */
    async _placeAuto(item, blockName) {
      const pos = bot.entity.position.floored();
      const offsets = [
        { dx: 1, dy: 0, dz: 0 }, { dx: -1, dy: 0, dz: 0 },
        { dx: 0, dy: 0, dz: 1 }, { dx: 0, dy: 0, dz: -1 },
      ];

      for (const off of offsets) {
        const targetPos = pos.offset(off.dx, off.dy, off.dz);
        const targetBlock = bot.blockAt(targetPos);
        const belowBlock = bot.blockAt(targetPos.offset(0, -1, 0));

        if (targetBlock && (targetBlock.name === 'air' || targetBlock.name === 'cave_air') &&
            belowBlock && belowBlock.name !== 'air' && belowBlock.name !== 'cave_air') {
          try {
            await bot.equip(item, 'hand');
            await bot.placeBlock(belowBlock, new (require('vec3'))(0, 1, 0));
            console.log(`[Build] Placed ${blockName}`);
            logger.action('build', 'place', blockName);
            return true;
          } catch (err) {
            logger.error('build/place', err);
          }
        }
      }

      console.log(`[Build] No spot to place ${blockName}`);
      return false;
    },

    /**
     * 找目标位置相邻的固体方块（作为放置参考面）
     * @param {Vec3} targetPos - 要放置方块的位置
     * @param {string} preferredFace - 优先面：north/south/east/west/up/down
     */
    _findAdjacentSolid(targetPos, preferredFace) {
      // 面方向 → 偏移
      const faceOffsets = {
        north: { dx: 0, dy: 0, dz: -1 },
        south: { dx: 0, dy: 0, dz: 1 },
        east:  { dx: 1, dy: 0, dz: 0 },
        west:  { dx: -1, dy: 0, dz: 0 },
        up:    { dx: 0, dy: 1, dz: 0 },
        down:  { dx: 0, dy: -1, dz: 0 },
      };

      // 优先检查指定面
      if (preferredFace && faceOffsets[preferredFace]) {
        const off = faceOffsets[preferredFace];
        const refPos = targetPos.offset(off.dx, off.dy, off.dz);
        const refBlock = bot.blockAt(refPos);
        if (refBlock && refBlock.name !== 'air' && refBlock.name !== 'cave_air' && refBlock.name !== 'water') {
          return refBlock;
        }
      }

      // 遍历所有 6 个面
      for (const [face, off] of Object.entries(faceOffsets)) {
        const refPos = targetPos.offset(off.dx, off.dy, off.dz);
        const refBlock = bot.blockAt(refPos);
        if (refBlock && refBlock.name !== 'air' && refBlock.name !== 'cave_air' && refBlock.name !== 'water' && refBlock.boundingBox === 'block') {
          return refBlock;
        }
      }

      return null;
    },
  },
};

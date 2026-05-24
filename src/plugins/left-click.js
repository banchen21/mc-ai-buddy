/**
 * 👆 left-click 插件 — 左键交互
 *
 * 四种模式：
 *   1. 攻击实体 — 装备武器后左键攻击（支持持续攻击直到死亡）
 *   2. 点击方块 — 空手或有物品左键点击方块
 *   3. 长按挖掘 — 持续挖掘方块直到破坏（= 长按左键）
 *   4. 单次攻击 — 只攻击一次
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
  name: 'left-click',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() {},
  stop() {},

  tools: [
    {
      type: 'function',
      function: {
        name: 'left_click',
        description: '左键交互。支持：attack(攻击实体)、dig(长按挖掘方块)、click(单次点击方块/实体)',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: '目标：实体名(zombie/cow) 或 方块坐标("100,64,200") 或 nearest_hostile' },
            action: { type: 'string', description: 'attack(攻击实体,默认) | dig(长按挖掘方块) | click(单次点击)' },
            item: { type: 'string', description: '主手物品名。不填或"hand"/"空手"则空手' },
            enchant: { type: 'string', description: '附魔名(可选)，如 sharpness, fortune, silk_touch' },
            continuous: { type: 'boolean', description: '[attack] 是否持续攻击直到死亡。默认true' },
            count: { type: 'number', description: '[dig] 挖掘数量，默认1' },
          },
          required: ['target'],
          additionalProperties: false,
        },
      },
    },
  ],

  actions: {
    /**
     * 左键交互
     *
     * 攻击实体：
     *   left_click({ target: 'zombie', item: 'iron_sword' })
     *   left_click({ target: 'nearest_hostile', item: 'diamond_sword', enchant: 'sharpness' })
     *   left_click({ target: 'creeper', item: 'stone_axe', continuous: false })  // 单次
     *
     * 长按挖掘：
     *   left_click({ target: '100,64,200', action: 'dig', item: 'iron_pickaxe', count: 5 })
     *   left_click({ target: '100,64,200', action: 'dig', item: 'diamond_pickaxe', enchant: 'fortune' })
     *
     * 单次点击：
     *   left_click({ target: '100,64,200', action: 'click' })
     *   left_click({ target: '100,64,200', action: 'click', item: 'hand' })
     */
    async left_click(params) {
      const targetStr = params.target || '';
      const action = params.action || 'attack';
      const itemName = params.item || null;
      const enchant = params.enchant || null;

      // ===== 装备物品 =====
      const isHand = !itemName || itemName === 'hand' || itemName === '空手';
      if (!isHand) {
        const equipped = this._equipItem(itemName, enchant);
        if (!equipped) return `no_item:${itemName}`;
      }

      // ===== 解析目标 =====
      const target = this._resolveTarget(targetStr);
      if (!target) {
        console.log(`[LeftClick] Target not found: ${targetStr}`);
        return 'no_target';
      }

      // ===== 路由 =====
      switch (action) {
        case 'dig':
          // 长按挖掘方块
          if (target.type !== 'block') return 'dig_requires_block';
          return this._digBlock(target.block, params.count || 1);

        case 'click':
          // 单次点击
          if (target.type === 'entity') {
            return this._attackEntity(target.entity, false);
          } else {
            return this._clickBlock(target.block);
          }

        case 'attack':
        default:
          // 攻击实体
          if (target.type !== 'entity') return 'attack_requires_entity';
          const continuous = params.continuous !== false;
          return this._attackEntity(target.entity, continuous);
      }
    },

    /**
     * 解析目标：实体名 / nearest_hostile / 坐标
     */
    _resolveTarget(targetStr) {
      // nearest_hostile
      if (targetStr === 'nearest_hostile') {
        const harmless = /squid|bat|cod|salmon|tropical_fish|pufferfish|glow_squid|tadpole|axolotl|turtle|dolphin|villager|wandering_trader|iron_golem|snow_golem|cat|ocelot|wolf|fox|bee|chicken|cow|pig|sheep|rabbit|horse|donkey|mule|llama|parrot|panda|polar_bear|goat|frog|allay|camel|sniffer|armadillo/;
        const entity = bot.nearestEntity(e =>
          e.type === 'mob' && !harmless.test(e.name || '')
        );
        if (entity) return { type: 'entity', entity };
        return null;
      }

      // 坐标格式 "x,y,z"
      const coordMatch = targetStr.match(/^(-?\d+)\s*[,，]\s*(-?\d+)\s*[,，]\s*(-?\d+)$/);
      if (coordMatch) {
        const x = parseInt(coordMatch[1]);
        const y = parseInt(coordMatch[2]);
        const z = parseInt(coordMatch[3]);
        const block = bot.blockAt(new (require('vec3'))(x, y, z));
        if (block) return { type: 'block', block };
        return null;
      }

      // 实体名
      const player = bot.players[targetStr];
      if (player?.entity) return { type: 'entity', entity: player.entity };

      const entity = bot.nearestEntity(e =>
        (e.name === targetStr || e.username === targetStr ||
         (e.name || '').includes(targetStr) || (e.username || '').includes(targetStr))
      );
      if (entity) return { type: 'entity', entity };

      return null;
    },

    /**
     * 装备物品并检查附魔
     */
    _equipItem(itemName, enchant) {
      const item = bot.inventory.items().find(i =>
        i.name === itemName || i.name.includes(itemName)
      );

      if (!item) {
        console.log(`[LeftClick] No ${itemName} in inventory`);
        return false;
      }

      // 检查附魔
      if (enchant && item.nbt?.value?.Enchantments?.value?.value) {
        const enchantments = item.nbt.value.Enchantments.value.value;
        const hasEnchant = enchantments.some(e => {
          const enchName = (e.id?.value || '').replace('minecraft:', '');
          return enchName === enchant || enchName.includes(enchant);
        });
        if (!hasEnchant) {
          console.log(`[LeftClick] ${item.name} lacks enchant: ${enchant}`);
          return false;
        }
      }

      bot.equip(item, 'hand').catch(() => {});
      console.log(`[LeftClick] Equipped ${item.name}` +
        (enchant ? ` (${enchant})` : ''));
      return true;
    },

    /**
     * 攻击实体
     */
    async _attackEntity(entity, continuous) {
      const name = entity.name || entity.username || '目标';
      const dist = bot.entity.position.distanceTo(entity.position);

      console.log(`[LeftClick] ⚔️ Attacking ${name} (dist: ${Math.round(dist)}m)`);

      // 走到攻击范围
      if (dist > 3.5) {
        bot.pathfinder.setMovements(makeMovements());
        const goal = new goals.GoalNear(
          entity.position.x, entity.position.y, entity.position.z, 2
        );
        try {
          await bot.pathfinder.goto(goal);
        } catch {
          bot.pathfinder.setGoal(null);
          return 'unreachable';
        }
        bot.pathfinder.setGoal(null);
      }

      // 看向目标
      await bot.lookAt(entity.position.offset(0, 1.6, 0)).catch(() => {});

      if (continuous) {
        // 持续攻击直到目标死亡
        return this._attackUntilDead(entity, name);
      } else {
        // 单次攻击
        try {
          await bot.attack(entity);
          logger.action('left-click', 'attack', name);
          return true;
        } catch (err) {
          logger.error('left-click/attack', err);
          return false;
        }
      }
    },

    /**
     * 持续攻击直到目标死亡
     */
    async _attackUntilDead(entity, name) {
      const timeout = Date.now() + 30000; // 最多 30 秒
      let hits = 0;

      while (Date.now() < timeout) {
        // 检查目标是否还活着
        try {
          const current = bot.entities[entity.id];
          if (!current || current === bot.entity) {
            console.log(`[LeftClick] ${name} defeated (${hits} hits)`);
            logger.action('left-click', 'attack', `${name} defeated`);
            return hits;
          }
          entity = current;
        } catch {
          return hits;
        }

        const dist = bot.entity.position.distanceTo(entity.position);

        // 太远 → 追击
        if (dist > 3.5) {
          bot.pathfinder.setMovements(makeMovements());
          const goal = new goals.GoalNear(
            entity.position.x, entity.position.y, entity.position.z, 2
          );
          try {
            await bot.pathfinder.goto(goal);
          } catch {
            bot.pathfinder.setGoal(null);
            break;
          }
          bot.pathfinder.setGoal(null);
        }

        // 攻击
        try {
          await bot.lookAt(entity.position.offset(0, 1.6, 0));
          await bot.attack(entity);
          hits++;
        } catch (err) {
          logger.error('left-click/attack', err);
        }

        // 攻击冷却 ~0.6s
        await new Promise(r => setTimeout(r, 600));
      }

      console.log(`[LeftClick] Timeout attacking ${name} (${hits} hits)`);
      return hits;
    },

    /**
     * 单次点击方块
     */
    async _clickBlock(block) {
      const dist = bot.entity.position.distanceTo(block.position);
      console.log(`[LeftClick] 👆 Clicking ${block.name} at ${block.position}`);

      if (dist > 4) {
        if (!(await this._walkTo(block.position, 2))) return 'unreachable';
      }

      try {
        await bot.lookAt(block.position);
        await bot.activateBlock(block);
        logger.action('left-click', 'click', `${block.name}@${block.position}`);
        return true;
      } catch (err) {
        logger.error('left-click/click', err);
        return false;
      }
    },

    // ================================================================
    //  长按挖掘模式：持续挖掘方块直到破坏（= 长按左键）
    // ================================================================

    /**
     * 长按挖掘方块
     * 使用 bot.dig() 持续挖掘，内部会自动处理"长按"
     */
    async _digBlock(block, count) {
      console.log(`[LeftClick] ⛏️ Digging ${count}x ${block.name} at ${block.position}`);

      let dug = 0;
      const timeout = Date.now() + 60000;
      let consecutiveErrors = 0;

      for (let i = 0; i < count * 3 && dug < count; i++) {
        if (Date.now() > timeout) break;
        if (consecutiveErrors >= 5) {
          console.log(`[LeftClick] Too many errors, stopping`);
          break;
        }

        // 重新获取方块引用（可能已被破坏）
        const currentBlock = bot.blockAt(block.position);
        if (!currentBlock || currentBlock.name === 'air' || currentBlock.name === 'cave_air') {
          // 方块已破坏，找下一个同类型
          if (dug < count) {
            const mcData = require('minecraft-data')(bot.version);
            const blockId = mcData.blocksByName[block.name]?.id;
            if (blockId) {
              const next = bot.findBlock({ matching: [blockId], maxDistance: 32, count: 1 });
              if (next) {
                block = next;
                continue;
              }
            }
          }
          break;
        }

        // 走到方块旁
        const dist = bot.entity.position.distanceTo(currentBlock.position);
        if (dist > 4) {
          if (!(await this._walkTo(currentBlock.position, 2))) {
            consecutiveErrors++;
            continue;
          }
        }

        try {
          await bot.lookAt(currentBlock.position);
          // bot.dig() = 长按左键直到破坏
          await bot.dig(currentBlock);
          dug++;
          consecutiveErrors = 0;

          // 短暂等待掉落物生成
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          consecutiveErrors++;
          if (consecutiveErrors === 1) {
            logger.error('left-click/dig', err);
          }
          await new Promise(r => setTimeout(r, 200));
        }
      }

      bot.pathfinder.setGoal(null);
      logger.action('left-click', 'dig', `${dug}x ${block.name}`);
      if (dug > 0) console.log(`[LeftClick] Dug ${dug}x ${block.name}`);
      return dug;
    },

    /**
     * 走到指定位置
     */
    async _walkTo(pos, range) {
      bot.pathfinder.setMovements(makeMovements());
      const goal = new goals.GoalNear(pos.x, pos.y, pos.z, range);
      try {
        await bot.pathfinder.goto(goal);
        bot.pathfinder.setGoal(null);
        return true;
      } catch {
        bot.pathfinder.setGoal(null);
        return false;
      }
    },
  },
};

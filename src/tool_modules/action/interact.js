/**
 * 交互模块 — 挖掘 / 放置 / 攻击 / 给予 / 装备 / 丢弃 / 拾取 / 使用 / 右键交互 / 聊天
 */
const { Vec3 } = require('vec3');

class InteractModule {
  constructor(bot) {
    this.bot = bot;
  }

  getToolDefs() {
    return [
      {
        type: 'function',
        function: {
          name: 'dig',
          description: '挖掘指定坐标的方块',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
            },
            required: ['x', 'y', 'z'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'place',
          description: '在指定坐标旁边放置方块',
          parameters: {
            type: 'object',
            properties: {
              block: { type: 'string' },
              x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
            },
            required: ['block', 'x', 'y', 'z'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'attack',
          description: '攻击指定实体',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string' },
            },
            required: ['target'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'give',
          description: '把物品丢给指定玩家',
          parameters: {
            type: 'object',
            properties: {
              item: { type: 'string' },
              player: { type: 'string' },
              count: { type: 'number' },
            },
            required: ['item', 'player'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'equip',
          description: '装备指定物品到手上',
          parameters: {
            type: 'object',
            properties: { item: { type: 'string' } },
            required: ['item'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'drop',
          description: '丢弃手持物品',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'collect',
          description: '拾取附近掉落物',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'use_item',
          description: '使用手持物品（吃食物、放船等）',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'activate_block',
          description: '右键点击方块（开门、开箱、按按钮等）',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
            },
            required: ['x', 'y', 'z'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'send_chat',
          description: '在公屏发送聊天消息',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: '要发送的消息' },
            },
            required: ['message'],
          },
        },
      },
    ];
  }

  getExecutors() {
    return {
      dig: (p) => this._dig(p),
      place: (p) => this._place(p),
      attack: (p) => this._attack(p),
      give: (p) => this._give(p),
      equip: (p) => this._equip(p),
      drop: () => this._drop(),
      collect: () => this._collect(),
      use_item: () => this._useItem(),
      activate_block: (p) => this._activateBlock(p),
      send_chat: (p) => this._sendChat(p),
    };
  }

  async _dig({ x, y, z }) {
    const { Vec3 } = require('vec3');
    const block = this.bot.blockAt(new Vec3(x, y, z));
    if (!block || block.name === 'air') return '那里没有方块';
    // 先看向方块再挖
    await this.bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
    try {
      await this.bot.dig(block);
      return `挖掘了 ${block.displayName || block.name}`;
    } catch (err) {
      return `挖掘失败: ${err.message}`;
    }
  }

  async _place({ block, x, y, z }) {
    const ref = this.bot.blockAt(new Vec3(x, y, z));
    if (!ref) return '找不到参照方块';
    const item = this.bot.inventory.items().find(i => i.name.includes(block));
    if (!item) return `背包没有 ${block}`;
    await this.bot.equip(item, 'hand');
    await this.bot.placeBlock(ref, new Vec3(0, 1, 0));
    return `放置了 ${block}`;
  }

  async _attack({ target }) {
    const entity = Object.values(this.bot.entities).find(e =>
      e.name === target || e.username === target ||
      (e.displayName && e.displayName.includes(target))
    );
    if (!entity) return `找不到 ${target}`;
    await this.bot.attack(entity);
    return `攻击 ${target}`;
  }

  async _give({ item, player, count = 1 }) {
    const invItem = this.bot.inventory.items().find(i => i.name.includes(item));
    if (!invItem) return `背包没有 ${item}`;
    const target = this.bot.players[player]?.entity;
    if (!target) return `找不到玩家 ${player}`;
    await this.bot.lookAt(target.position.offset(0, 1.6, 0));
    await this.bot.toss(invItem.type, null, count);
    return `给了 ${player} ${item} x${count}`;
  }

  async _equip({ item }) {
    const invItem = this.bot.inventory.items().find(i => i.name.includes(item));
    if (!invItem) return `背包没有 ${item}`;
    await this.bot.equip(invItem, 'hand');
    return `装备了 ${item}`;
  }

  async _drop() {
    const item = this.bot.heldItem;
    if (!item) return '手上没有东西';
    await this.bot.tossStack(item);
    return `丢弃了 ${item.name}`;
  }

  async _collect() {
    const drops = Object.values(this.bot.entities).filter(e => e.name === 'item');
    if (drops.length === 0) return '附近没有掉落物';
    const { goals } = require('mineflayer-pathfinder');
    const nearest = drops.sort((a, b) =>
      this.bot.entity.position.distanceTo(a.position) -
      this.bot.entity.position.distanceTo(b.position)
    )[0];
    this.bot.pathfinder.setGoal(new goals.GoalFollow(nearest, 0.5), false);
    return `正在拾取掉落物`;
  }

  async _useItem() {
    await this.bot.activateItem();
    return '使用了手持物品';
  }

  async _activateBlock({ x, y, z }) {
    const block = this.bot.blockAt(new Vec3(x, y, z));
    if (!block) return '那里没有方块';
    try {
      await this.bot.activateBlock(block);
      return `右键了 ${block.name}`;
    } catch (err) {
      return `无法交互: ${err.message}`;
    }
  }

  async _sendChat({ message }) {
    const clean = message.substring(0, 80);
    this.bot.chat(clean);
    return `发送了: ${clean}`;
  }
}

module.exports = { InteractModule };

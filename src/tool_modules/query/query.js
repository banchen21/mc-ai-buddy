/**
 * 查询模块 — 提供 bot 自身状态查询工具
 * 供 action 模块注册使用
 */
class QueryModule {
  constructor(bot) {
    this.bot = bot;
  }

  /** 获取所有查询工具定义 */
  getToolDefs() {
    return [
      {
        type: 'function',
        function: {
          name: 'get_inventory',
          description: '查询背包中所有物品的名称和数量',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_armor',
          description: '查询当前穿戴的护甲（头盔、胸甲、护腿、靴子）',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_held_item',
          description: '查询主手手持物品的名称、数量和附魔',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_offhand',
          description: '查询副手物品',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_health',
          description: '查询当前血量和饱食度',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_position',
          description: '查询当前坐标',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_nearby_entities',
          description: '查询附近所有实体（生物、玩家、掉落物）',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_block',
          description: '查询指定坐标的方块类型',
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
          name: 'get_surrounding_blocks',
          description: '查询周围 5x5x5 范围内的方块（用于了解地形）',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_time',
          description: '查询当前游戏时间和天气',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ];
  }

  /** 获取所有查询执行器 { name: () => resultString } */
  getExecutors() {
    return {
      get_inventory: () => this._inventory(),
      get_armor: () => this._armor(),
      get_held_item: () => this._heldItem(),
      get_offhand: () => this._offhand(),
      get_health: () => this._health(),
      get_position: () => this._position(),
      get_nearby_entities: () => this._nearbyEntities(),
      get_block: (p) => this._getBlock(p),
      get_surrounding_blocks: () => this._surroundingBlocks(),
      get_time: () => this._getTime(),
    };
  }

  // ===== 查询实现 =====

  _inventory() {
    const items = this.bot.inventory.items();
    if (items.length === 0) return '背包为空';
    return items.map(i => `${this._displayName(i)} x${i.count}`).join(', ');
  }

  _armor() {
    const slots = [
      { name: '头盔', slot: this.bot.getEquipmentDestSlot('head') },
      { name: '胸甲', slot: this.bot.getEquipmentDestSlot('torso') },
      { name: '护腿', slot: this.bot.getEquipmentDestSlot('legs') },
      { name: '靴子', slot: this.bot.getEquipmentDestSlot('feet') },
    ];
    const parts = [];
    for (const { name, slot } of slots) {
      const item = this.bot.inventory.slots[slot];
      parts.push(item ? `${name}: ${this._displayName(item)}` : `${name}: 无`);
    }
    return parts.join(' | ');
  }

  _heldItem() {
    const item = this.bot.heldItem;
    if (!item) return '空手';
    const ench = this._getEnchants(item);
    return `${this._displayName(item)} x${item.count}${ench ? ` (${ench})` : ''}`;
  }

  _offhand() {
    const item = this.bot.inventory.slots[this.bot.getEquipmentDestSlot('off-hand')];
    if (!item) return '空';
    return `${this._displayName(item)} x${item.count}`;
  }

  /** 将 minecraft 内部 ID 转为可读名称 */
  _displayName(item) {
    const raw = (item.name || item.displayName || '').replace(/^minecraft:/, '');
    const map = {
      'chainmail_helmet': '锁链头盔', 'chainmail_chestplate': '锁链胸甲',
      'chainmail_leggings': '锁链护腿', 'chainmail_boots': '锁链靴子',
      'iron_helmet': '铁头盔', 'iron_chestplate': '铁胸甲',
      'iron_leggings': '铁护腿', 'iron_boots': '铁靴子',
      'diamond_helmet': '钻石头盔', 'diamond_chestplate': '钻石胸甲',
      'diamond_leggings': '钻石护腿', 'diamond_boots': '钻石靴子',
      'golden_helmet': '金头盔', 'golden_chestplate': '金胸甲',
      'leather_helmet': '皮革头盔', 'leather_chestplate': '皮革胸甲',
      'iron_pickaxe': '铁镐', 'iron_sword': '铁剑', 'iron_axe': '铁斧',
      'iron_shovel': '铁锹', 'iron_hoe': '铁锄',
      'stone_pickaxe': '石镐', 'stone_sword': '石剑', 'stone_axe': '石斧',
      'stone_shovel': '石锹', 'stone_hoe': '石锄',
      'diamond_pickaxe': '钻石镐', 'diamond_sword': '钻石剑',
      'diamond_axe': '钻石斧', 'diamond_shovel': '钻石锹',
      'wooden_pickaxe': '木镐', 'wooden_sword': '木剑', 'wooden_axe': '木斧',
      'golden_pickaxe': '金镐', 'golden_sword': '金剑',
      'torch': '火把', 'bread': '面包', 'cobblestone': '圆石',
      'dirt': '泥土', 'stone': '石头', 'coal': '煤炭',
      'iron_ingot': '铁锭', 'diamond': '钻石', 'stick': '木棍',
      'oak_planks': '橡木板', 'crafting_table': '工作台',
      'furnace': '熔炉', 'chest': '箱子', 'bed': '床',
      'bow': '弓', 'arrow': '箭', 'shield': '盾牌',
      'fishing_rod': '钓鱼竿', 'bucket': '桶', 'water_bucket': '水桶',
      'lava_bucket': '岩浆桶', 'flint_and_steel': '打火石',
      'ender_pearl': '末影珍珠', 'apple': '苹果', 'golden_apple': '金苹果',
      'cooked_beef': '熟牛肉', 'cooked_porkchop': '熟猪排',
    };
    if (map[raw]) return map[raw];
    return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  _health() {
    return `HP: ${Math.round(this.bot.health)}/20 | 饱食度: ${Math.round(this.bot.food)}/20`;
  }

  _position() {
    const p = this.bot.entity?.position;
    if (!p) return '未知';
    return `${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`;
  }

  _nearbyEntities() {
    const entities = Object.values(this.bot.entities || {});
    if (entities.length === 0) return '附近没有实体';
    const list = entities.slice(0, 10).map(e => {
      const name = e.username || e.displayName || e.name || '未知';
      const dist = this.bot.entity?.position?.distanceTo(e.position);
      return `${name}(${Math.round(dist || 0)}m)`;
    });
    return list.join(', ');
  }

  _getBlock({ x, y, z }) {
    const { Vec3 } = require('vec3');
    const block = this.bot.blockAt(new Vec3(x, y, z));
    if (!block) return `(${x},${y},${z}): 未加载`;
    return `(${x},${y},${z}): ${block.displayName || block.name}`;
  }

  _surroundingBlocks() {
    const p = this.bot.entity?.position;
    if (!p) return '未知';
    const { Vec3 } = require('vec3');
    const counts = {};
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          const block = this.bot.blockAt(new Vec3(
            Math.round(p.x) + dx, Math.round(p.y) + dy, Math.round(p.z) + dz
          ));
          if (block && block.name !== 'air') {
            const name = block.displayName || block.name;
            counts[name] = (counts[name] || 0) + 1;
          }
        }
      }
    }
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (entries.length === 0) return '周围全是空气';
    return entries.map(([k, v]) => `${k} x${v}`).join(', ');
  }

  _getTime() {
    const time = this.bot.time;
    if (!time) return '未知';
    const dayTime = time.timeOfDay;
    const hour = Math.floor(dayTime / 1000);
    const isRaining = this.bot.isRaining || false;
    const isThundering = this.bot.thunderState > 0 || false;
    let weather = '晴天';
    if (isThundering) weather = '雷暴';
    else if (isRaining) weather = '下雨';
    let period = '白天';
    if (hour > 18 || hour < 6) period = '夜晚';
    return `${period} ${hour}:00 | ${weather}`;
  }

  /** 解析物品附魔 */
  _getEnchants(item) {
    try {
      const enchList = item.nbt?.value?.Enchantments?.value?.value;
      if (!enchList) return '';
      return enchList.map(e =>
        `${e.id?.value?.replace('minecraft:', '')} ${e.lvl?.value}`
      ).join(', ');
    } catch {
      return '';
    }
  }
}

module.exports = { QueryModule };

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

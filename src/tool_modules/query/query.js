/**
 * 查询模块 — 提供 bot 自身状态查询工具
 * 供 action 模块注册使用
 */
const OpenAI = require('openai');

class QueryModule {
  constructor(bot, deps) {
    this.bot = bot;
    this.llm = deps?.llm || null;
    // 独立的搜索客户端（保持 MiMo/OpenAI 兼容接口）
    const voiceCfg = deps?.config?.voice || {};
    this._searchClient = new OpenAI({
      apiKey: voiceCfg.apiKey || deps?.config?.llm?.apiKey || '',
      baseURL: voiceCfg.baseUrl || 'https://api.xiaomimimo.com/v1',
    });
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
          description: '视线检测前方可见的实体（生物、玩家），被方块遮挡的不可见',
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
          description: '从眼睛位置发射射线扫描周围可见方块（视线检测），返回方块名和坐标',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'look_at_block',
          description: '看向指定坐标或玩家（仅调整视角，不移动）。用于在查询周围方块前先转向目标方向',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number', description: '目标 X 坐标' },
              y: { type: 'number', description: '目标 Y 坐标' },
              z: { type: 'number', description: '目标 Z 坐标' },
              player: { type: 'string', description: '目标玩家名（与坐标二选一）' },
            },
            required: [],
          },
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
      {
        type: 'function',
        function: {
          name: 'get_chest',
          description: '查询附近箱子里有什么物品（普通箱子、陷阱箱）',
          parameters: {
            type: 'object',
            properties: {
              maxDistance: { type: 'number', description: '最大搜索距离，默认 8' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_furnace',
          description: '查询附近熔炉的烧炼状态（输入、燃料、输出）',
          parameters: {
            type: 'object',
            properties: {
              maxDistance: { type: 'number', description: '最大搜索距离，默认 8' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_container',
          description: '查询附近任意容器（末影箱、木桶、漏斗、发射器、投掷器、潜影盒等）',
          parameters: {
            type: 'object',
            properties: {
              maxDistance: { type: 'number', description: '最大搜索距离，默认 8' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'scan_surroundings',
          description: '以玩家头部为中心向周围辐射扫描，识别所有与空气接触的可见方块和实体。遇到方块自动停止射线，能快速感知周围环境全貌。返回方块列表和实体列表。',
          parameters: {
            type: 'object',
            properties: {
              radius: { type: 'number', description: '扫描半径（格），默认 8，最大 16' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_web',
          description: '上网搜索 Minecraft 相关的知识（合成配方、机制、攻略等）。当玩家问游戏知识类问题时使用。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词，如 "如何驯服马"、"下界合金锭合成配方"' },
            },
            required: ['query'],
          },
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
      look_at: (p) => this._lookAt(p),
      look_at_block: (p) => this._lookAt(p),
      get_time: () => this._getTime(),
      get_chest: (p) => this._getChest(p),
      get_furnace: (p) => this._getFurnace(p),
      get_container: (p) => this._getContainer(p),
      scan_surroundings: (p) => this._scanSurroundings(p),
      search_web: (p) => this._searchWeb(p),
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
      if (!item) {
        parts.push(`${name}: 无`);
      } else {
        parts.push(`${name}: ${this._describeItem(item)}`);
      }
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
    return this._describeItem(item);
  }

  /** 将 minecraft 内部 ID 转为可读名称（优先使用 mcData.displayName） */
  _displayName(item) {
    const raw = (item.name || item.displayName || '').replace(/^minecraft:/, '');
    // 优先从 minecraft-data 获取官方 displayName
    try {
      const mcData = this._mcData();
      const dataItem = mcData.itemsByName[raw];
      if (dataItem && dataItem.displayName) return dataItem.displayName;
    } catch {}
    // fallback: 下划线转空格 + 首字母大写
    return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  /** 描述物品的完整属性（名称、耐久、附魔、护甲值/攻击力） */
  _describeItem(item) {
    const name = this._displayName(item);
    const parts = [name];

    // 数量
    if (item.count > 1) parts.push(`x${item.count}`);

    // 耐久度
    if (item.maxDurability) {
      const used = item.durabilityUsed || 0;
      const remaining = item.maxDurability - used;
      parts.push(`[${remaining}/${item.maxDurability}]`);
    }

    // 附魔
    const ench = this._getEnchants(item);
    if (ench) parts.push(`(${ench})`);

    // 护甲值
    const armorVal = this._getArmorValue(item.name);
    if (armorVal) parts.push(`armor:${armorVal}`);

    // 盔甲韧性
    const toughness = this._getArmorToughness(item.name);
    if (toughness) parts.push(`toughness:${toughness}`);

    // 攻击伤害
    const atkDmg = this._getAttackDamage(item.name);
    if (atkDmg) parts.push(`atk:${atkDmg}`);

    // 攻击速度
    const atkSpeed = this._getAttackSpeed(item.name);
    if (atkSpeed) parts.push(`spd:${atkSpeed}`);

    return parts.join(' ');
  }

  /** 护甲值映射（头盔/胸甲/护腿/靴子） */
  _getArmorValue(itemName) {
    const map = {
      'leather_helmet': 1, 'leather_chestplate': 3, 'leather_leggings': 2, 'leather_boots': 1,
      'chainmail_helmet': 2, 'chainmail_chestplate': 5, 'chainmail_leggings': 4, 'chainmail_boots': 1,
      'iron_helmet': 2, 'iron_chestplate': 6, 'iron_leggings': 5, 'iron_boots': 2,
      'golden_helmet': 2, 'golden_chestplate': 5, 'golden_leggings': 3, 'golden_boots': 1,
      'diamond_helmet': 3, 'diamond_chestplate': 8, 'diamond_leggings': 6, 'diamond_boots': 3,
      'netherite_helmet': 3, 'netherite_chestplate': 8, 'netherite_leggings': 6, 'netherite_boots': 3,
      'turtle_helmet': 2,
    };
    return map[itemName] || null;
  }

  /** 盔甲韧性映射 */
  _getArmorToughness(itemName) {
    if (itemName.startsWith('diamond_')) return 2;
    if (itemName.startsWith('netherite_')) return 3;
    return null;
  }

  /** 攻击伤害映射 */
  _getAttackDamage(itemName) {
    const map = {
      'wooden_sword': 4, 'wooden_axe': 7, 'wooden_pickaxe': 2, 'wooden_shovel': 2.5, 'wooden_hoe': 1,
      'stone_sword': 5, 'stone_axe': 9, 'stone_pickaxe': 3, 'stone_shovel': 3.5, 'stone_hoe': 1,
      'iron_sword': 6, 'iron_axe': 9, 'iron_pickaxe': 4, 'iron_shovel': 4.5, 'iron_hoe': 1,
      'golden_sword': 4, 'golden_axe': 7, 'golden_pickaxe': 2, 'golden_shovel': 2.5, 'golden_hoe': 1,
      'diamond_sword': 7, 'diamond_axe': 9, 'diamond_pickaxe': 5, 'diamond_shovel': 5.5, 'diamond_hoe': 1,
      'netherite_sword': 8, 'netherite_axe': 10, 'netherite_pickaxe': 6, 'netherite_shovel': 6.5, 'netherite_hoe': 1,
      'trident': 9, 'bow': 0, 'crossbow': 0, 'shield': 0,
    };
    return map[itemName] ?? null;
  }

  /** 攻击速度映射 */
  _getAttackSpeed(itemName) {
    if (itemName.includes('_sword')) return 1.6;
    if (itemName.includes('_axe')) return itemName.startsWith('golden_') ? 1.0 : (itemName.startsWith('wooden_') || itemName.startsWith('stone_') ? 0.8 : 1.0);
    if (itemName.includes('_pickaxe')) return 1.2;
    if (itemName.includes('_shovel')) return 1.0;
    if (itemName.includes('_hoe')) return itemName.startsWith('netherite_') ? 4.0 : (itemName.startsWith('diamond_') || itemName.startsWith('golden_') ? 3.5 : (itemName.startsWith('iron_') ? 3.0 : (itemName.startsWith('stone_') ? 2.0 : 1.0)));
    if (itemName === 'trident') return 1.1;
    return null;
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
    const p = this.bot.entity?.position;
    if (!p) return '未知';
    const { Vec3 } = require('vec3');
    const eyePos = new Vec3(p.x, p.y + 1.6, p.z);
    const yaw = this.bot.entity.yaw;
    const pitch = this.bot.entity.pitch;

    // 视线方向向量
    const lookDir = new Vec3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    );

    const seen = new Map(); // entityId -> { name, dist }
    const maxDist = 16;

    // 前方扇形射线（120° 视野，50 条射线）
    for (let i = 0; i < 50; i++) {
      // 在视线方向周围随机偏移（前方扇形）
      const spreadYaw = yaw + (Math.random() - 0.5) * (Math.PI * 2 / 3); // ±60°
      const spreadPitch = pitch + (Math.random() - 0.5) * (Math.PI / 3); // ±30°
      const dir = new Vec3(
        -Math.sin(spreadYaw) * Math.cos(spreadPitch),
        Math.sin(spreadPitch),
        -Math.cos(spreadYaw) * Math.cos(spreadPitch)
      );

      // 沿射线步进，检测实体碰撞
      let pos = eyePos.clone();
      for (let step = 0; step < maxDist * 2; step++) {
        pos = pos.plus(dir.scaled(0.5));

        // 检查方块遮挡
        const blockPos = new Vec3(Math.round(pos.x), Math.round(pos.y), Math.round(pos.z));
        const block = this.bot.blockAt(blockPos);
        if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
          break; // 被方块挡住，停止射线
        }

        // 检查实体碰撞（用包围盒近似）
        const entities = Object.values(this.bot.entities || {});
        for (const e of entities) {
          if (e === this.bot.entity) continue;
          if (seen.has(e.id)) continue;
          const ePos = e.position;
          const dx = pos.x - ePos.x;
          const dy = pos.y - (ePos.y + (e.height || 1.8) / 2);
          const dz = pos.z - ePos.z;
          const hitDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (hitDist < 1.0) { // 1 格碰撞半径
            const dist = eyePos.distanceTo(ePos);
            const name = e.username || e.displayName || e.name || '未知';
            const ex = Math.round(ePos.x);
            const ey = Math.round(ePos.y);
            const ez = Math.round(ePos.z);
            seen.set(e.id, { name, dist: Math.round(dist), x: ex, y: ey, z: ez });
            break;
          }
        }
      }
    }

    if (seen.size === 0) return '视野内无实体';

    const sorted = [...seen.values()].sort((a, b) => a.dist - b.dist).slice(0, 10);
    return sorted.map(e => `${e.name}(${e.dist}m, ${e.x},${e.y},${e.z})`).join(', ');
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
    const eyePos = new Vec3(p.x, p.y + 1.6, p.z);
    const blocks = new Map();
    const maxDist = 8;
    const rayCount = 200;

    // 斐波那契球面均匀分布射线
    for (let i = 0; i < rayCount; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / rayCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const dx = Math.sin(phi) * Math.cos(theta);
      const dy = Math.sin(phi) * Math.sin(theta);
      const dz = Math.cos(phi);

      // 沿射线方向步进（0.5 格步长）
      let pos = eyePos.clone();
      for (let step = 0; step < maxDist * 2; step++) {
        pos = pos.plus(new Vec3(dx * 0.5, dy * 0.5, dz * 0.5));
        const blockPos = new Vec3(Math.round(pos.x), Math.round(pos.y), Math.round(pos.z));
        const block = this.bot.blockAt(blockPos);
        if (!block) break;
        if (block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
          const key = blockPos.toString();
          if (!blocks.has(key)) {
            blocks.set(key, { name: block.displayName || block.name, pos: blockPos.clone() });
          }
          break;
        }
      }
    }

    if (blocks.size === 0) return '视野内无方块';

    // 按距离排序
    const sorted = [...blocks.values()].sort((a, b) =>
      a.pos.distanceTo(eyePos) - b.pos.distanceTo(eyePos)
    );
    return sorted.slice(0, 30).map(b => `${b.name}(${b.pos.x},${b.pos.y},${b.pos.z})`).join(', ');
  }

  /**
   * scan_surroundings — 以玩家头部为中心，向周围全方向辐射扫描
   * 识别所有与空气接触的可见方块 + 可见实体
   * 射线遇到非空气方块自动停止，只记录"表面方块"
   */
  _scanSurroundings({ radius = 8 } = {}) {
    const p = this.bot.entity?.position;
    if (!p) return '未知';
    const { Vec3 } = require('vec3');
    const eyePos = new Vec3(p.x, p.y + 1.6, p.z);
    const maxDist = Math.min(radius, 16);
    const blocks = new Map();    // key -> { name, pos, dist }
    const entities = new Map();  // id -> { name, pos, dist }

    // 斐波那契球面均匀分布射线，密度随半径增大
    const rayCount = Math.floor(maxDist * maxDist * 4);

    for (let i = 0; i < rayCount; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / rayCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const dx = Math.sin(phi) * Math.cos(theta);
      const dy = Math.sin(phi) * Math.sin(theta);
      const dz = Math.cos(phi);

      let pos = eyePos.clone();
      for (let step = 0; step < maxDist * 2; step++) {
        pos = pos.plus(new Vec3(dx * 0.5, dy * 0.5, dz * 0.5));

        // 超出半径则停止
        if (pos.distanceTo(eyePos) > maxDist) break;

        const blockPos = new Vec3(Math.round(pos.x), Math.round(pos.y), Math.round(pos.z));
        const block = this.bot.blockAt(blockPos);
        if (!block) break;

        // 遇到非空气方块 → 记录并停止射线
        if (block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
          const key = blockPos.toString();
          if (!blocks.has(key)) {
            const dist = Math.round(eyePos.distanceTo(blockPos));
            blocks.set(key, { name: block.displayName || block.name, pos: blockPos.clone(), dist });
          }
          break;
        }

        // 在空气中检测实体碰撞
        const allEntities = Object.values(this.bot.entities || {});
        for (const e of allEntities) {
          if (e === this.bot.entity) continue;
          if (entities.has(e.id)) continue;
          const ePos = e.position;
          const dx2 = pos.x - ePos.x;
          const dy2 = pos.y - (ePos.y + (e.height || 1.8) / 2);
          const dz2 = pos.z - ePos.z;
          const hitDist = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);
          if (hitDist < 1.0) {
            const dist = Math.round(eyePos.distanceTo(ePos));
            const name = e.username || e.displayName || e.name || '未知';
            entities.set(e.id, { name, pos: ePos.clone(), dist });
          }
        }
      }
    }

    // 构建输出
    const parts = [];

    // 方块部分：按距离排序，分类统计
    const sortedBlocks = [...blocks.values()].sort((a, b) => a.dist - b.dist);
    if (sortedBlocks.length > 0) {
      // 统计方块类型
      const typeCount = {};
      for (const b of sortedBlocks) {
        typeCount[b.name] = (typeCount[b.name] || 0) + 1;
      }
      const typeSummary = Object.entries(typeCount)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name} x${count}`)
        .join(', ');

      const detailList = sortedBlocks.slice(0, 20)
        .map(b => `${b.name}(${b.pos.x},${b.pos.y},${b.pos.z})`)
        .join(', ');

      parts.push(`[方块] ${typeSummary}\n  最近: ${detailList}`);
    } else {
      parts.push('[方块] 无');
    }

    // 实体部分
    const sortedEntities = [...entities.values()].sort((a, b) => a.dist - b.dist);
    if (sortedEntities.length > 0) {
      const entityList = sortedEntities.slice(0, 10)
        .map(e => `${e.name}(${e.dist}m, ${Math.round(e.pos.x)},${Math.round(e.pos.y)},${Math.round(e.pos.z)})`)
        .join(', ');
      parts.push(`[实体] ${entityList}`);
    } else {
      parts.push('[实体] 无');
    }

    return parts.join('\n');
  }

  async _lookAt({ x, y, z, player }) {
    if (player) {
      const target = this.bot.players[player]?.entity;
      if (!target) return `找不到玩家 ${player}`;
      await this.bot.lookAt(target.position.offset(0, 1.6, 0));
      return `已看向玩家 ${player}`;
    }
    if (x !== undefined && y !== undefined && z !== undefined) {
      if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' ||
          !isFinite(x) || !isFinite(y) || !isFinite(z)) {
        return '请提供有效的 x, y, z 坐标';
      }
      const { Vec3 } = require('vec3');
      await this.bot.lookAt(new Vec3(x, y, z));
      return `已看向坐标 (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)})`;
    }
    return '请指定坐标 (x, y, z) 或玩家名 (player)';
  }

  _getTime() {
    const time = this.bot.time;
    if (!time) return '未知';
    const dayTime = time.timeOfDay;
    // Minecraft: 0=6:00, 6000=12:00, 12000=18:00, 18000=0:00
    const hour = Math.floor(((dayTime / 1000) + 6) % 24);
    const minute = Math.floor((dayTime % 1000) / 1000 * 60);
    const isRaining = this.bot.isRaining || false;
    const isThundering = this.bot.thunderState > 0 || false;
    let weather = '晴天';
    if (isThundering) weather = '雷暴';
    else if (isRaining) weather = '下雨';
    let period = '白天';
    if (hour >= 18 || hour < 6) period = '夜晚';
    return `${period} ${hour}:${String(minute).padStart(2, '0')} | ${weather}`;
  }

  // ===== 容器查询 =====

  /** 获取 mcData */
  _mcData() {
    return require('minecraft-data')(this.bot.version);
  }

  /**
   * 视线射线检测可见方块 — 从眼睛发射扇形射线，返回击中的指定类型方块
   * @param {string[]} blockNames — 目标方块名列表
   * @param {number} maxDist — 最大距离
   * @returns {Vec3[]} 去重后的方块坐标
   */
  _findVisibleBlocks(blockNames, maxDist = 8) {
    const mcData = this._mcData();
    const targetIds = new Set();
    for (const name of blockNames) {
      const block = mcData.blocksByName[name];
      if (block) targetIds.add(block.id);
    }
    if (targetIds.size === 0) return [];

    const p = this.bot.entity?.position;
    if (!p) return [];
    const { Vec3 } = require('vec3');
    const eyePos = new Vec3(p.x, p.y + 1.6, p.z);
    const yaw = this.bot.entity.yaw;
    const pitch = this.bot.entity.pitch;
    const found = new Map(); // key -> pos

    // 前方扇形射线（120° 视野，80 条射线）
    for (let i = 0; i < 80; i++) {
      const spreadYaw = yaw + (Math.random() - 0.5) * (Math.PI * 2 / 3);
      const spreadPitch = pitch + (Math.random() - 0.5) * (Math.PI / 3);
      const dir = new Vec3(
        -Math.sin(spreadYaw) * Math.cos(spreadPitch),
        Math.sin(spreadPitch),
        -Math.cos(spreadYaw) * Math.cos(spreadPitch)
      );

      let pos = eyePos.clone();
      for (let step = 0; step < maxDist * 2; step++) {
        pos = pos.plus(dir.scaled(0.5));
        const blockPos = new Vec3(Math.round(pos.x), Math.round(pos.y), Math.round(pos.z));
        const block = this.bot.blockAt(blockPos);
        if (!block) break;

        if (targetIds.has(block.type)) {
          const key = blockPos.toString();
          if (!found.has(key)) {
            found.set(key, blockPos.clone());
          }
        }

        if (block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
          break; // 被非空气方块挡住
        }
      }
    }

    return [...found.values()];
  }

  /** 格式化容器物品列表 */
  _formatItems(items) {
    if (!items || items.length === 0) return '空';
    const counts = {};
    for (const item of items) {
      const name = this._displayName(item);
      counts[name] = (counts[name] || 0) + item.count;
    }
    return Object.entries(counts)
      .map(([k, v]) => `${k} x${v}`)
      .join(', ');
  }

  /** 查询箱子（普通箱子 + 陷阱箱） */
  async _getChest({ maxDistance = 8 } = {}) {
    const positions = this._findVisibleBlocks(['chest', 'trapped_chest'], maxDistance);
    if (positions.length === 0) return `视野内没有箱子`;

    const results = [];
    for (const pos of positions) {
      const block = this.bot.blockAt(pos);
      if (!block) continue;
      try {
        const chest = await this.bot.openChest(block);
        const items = this._formatItems(chest.containerItems());
        results.push(`${block.name}(${pos.x},${pos.y},${pos.z}): ${items}`);
        await chest.close();
      } catch (err) {
        results.push(`${block.name}(${pos.x},${pos.y},${pos.z}): 无法打开 (${err.message})`);
      }
    }
    return results.join('\n');
  }

  /** 查询熔炉（熔炉 + 高炉 + 烟熏炉） */
  async _getFurnace({ maxDistance = 8 } = {}) {
    const positions = this._findVisibleBlocks(['furnace', 'blast_furnace', 'smoker'], maxDistance);
    if (positions.length === 0) return `视野内没有熔炉`;

    const results = [];
    for (const pos of positions) {
      const block = this.bot.blockAt(pos);
      if (!block) continue;
      try {
        const furnace = await this.bot.openFurnace(block);
        const input = furnace.inputItem() ? `${this._displayName(furnace.inputItem())} x${furnace.inputItem().count}` : '空';
        const fuel = furnace.fuelItem() ? `${this._displayName(furnace.fuelItem())} x${furnace.fuelItem().count}` : '空';
        const output = furnace.outputItem() ? `${this._displayName(furnace.outputItem())} x${furnace.outputItem().count}` : '空';
        const fuelLeft = furnace.fuel ?? 0;
        const progress = furnace.progress ?? 0;
        results.push(`${block.name}(${pos.x},${pos.y},${pos.z}): 输入[${input}] 燃料[${fuel}](${Math.round(fuelLeft * 100)}%) 输出[${output}] 进度${Math.round(progress * 100)}%`);
        await furnace.close();
      } catch (err) {
        results.push(`${block.name}(${pos.x},${pos.y},${pos.z}): 无法打开 (${err.message})`);
      }
    }
    return results.join('\n');
  }

  /** 查询其他容器（末影箱、木桶、漏斗、发射器、投掷器、潜影盒） */
  async _getContainer({ maxDistance = 8 } = {}) {
    const containerBlocks = [
      'ender_chest', 'barrel', 'hopper', 'dispenser', 'dropper',
      'shulker_box', 'white_shulker_box', 'orange_shulker_box', 'magenta_shulker_box',
      'light_blue_shulker_box', 'yellow_shulker_box', 'lime_shulker_box',
      'pink_shulker_box', 'gray_shulker_box', 'light_gray_shulker_box',
      'cyan_shulker_box', 'purple_shulker_box', 'blue_shulker_box',
      'brown_shulker_box', 'green_shulker_box', 'red_shulker_box', 'black_shulker_box',
    ];
    const positions = this._findVisibleBlocks(containerBlocks, maxDistance);
    if (positions.length === 0) return `视野内没有其他容器`;

    const results = [];
    for (const pos of positions) {
      const block = this.bot.blockAt(pos);
      if (!block) continue;

      if (block.name === 'ender_chest') {
        results.push(`末影箱(${pos.x},${pos.y},${pos.z}): 需要玩家自行打开`);
        continue;
      }

      try {
        const container = await this.bot.openContainer(block);
        const items = this._formatItems(container.containerItems());
        results.push(`${block.name}(${pos.x},${pos.y},${pos.z}): ${items}`);
        await container.close();
      } catch (err) {
        results.push(`${block.name}(${pos.x},${pos.y},${pos.z}): 无法打开 (${err.message})`);
      }
    }
    return results.join('\n');
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

  // ===== 联网搜索 =====

  async _searchWeb({ query }) {
    if (!this.llm) return '联网搜索不可用（LLM 未初始化）';

    try {
      const response = await this._searchClient.chat.completions.create({
        model: this.llm.model,
        messages: [
          {
            role: 'system',
            content: `你是 Minecraft 知识助手。请根据搜索结果回答用户关于 Minecraft 的问题。回答要简洁准确，不超过 300 字。如果搜索结果不足以回答问题，请诚实说明。`,
          },
          {
            role: 'user',
            content: query,
          },
        ],
        tools: [
          {
            type: 'web_search',
            web_search: {
              enable: true,
            },
          },
        ],
        tool_choice: { type: 'web_search' },
        max_tokens: 500,
        temperature: 0.3,
      });

      const msg = response.choices[0]?.message;
      if (!msg) return '搜索无结果';

      // 如果 LLM 返回了文本回复
      if (msg.content) {
        return `[搜索结果] ${msg.content.trim()}`;
      }

      return '搜索完成但无文本回复';
    } catch (err) {
      return `搜索失败: ${err.message}`;
    }
  }
}

module.exports = { QueryModule };

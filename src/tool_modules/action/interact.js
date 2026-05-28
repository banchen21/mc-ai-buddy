/**
 * 交互模块 — 挖掘 / 放置 / 攻击 / 给予 / 装备 / 丢弃 / 拾取 / 使用 / 右键交互 / 聊天
 */
const { Vec3 } = require("vec3");

class InteractModule {
  // 工具类型 → 中文名映射
  static TOOL_CN_MAP = {
    pickaxe: "镐",
    axe: "斧",
    shovel: "锹",
    hoe: "锄",
    shears: "剪刀",
  };

  constructor(bot, deps = {}) {
    this.bot = bot;
    this.messageModule = deps.messageModule || null;
  }

  getToolDefs() {
    return [
      {
        type: "function",
        function: {
          name: "dig",
          description: "挖掘指定坐标的方块",
          parameters: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
            required: ["x", "y", "z"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "place",
          description: "在指定坐标旁边放置方块",
          parameters: {
            type: "object",
            properties: {
              block: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
            required: ["block", "x", "y", "z"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "pillar_up",
          description: "搭方块上升（跳起来往脚下放方块），用于爬高",
          parameters: {
            type: "object",
            properties: {
              block: {
                type: "string",
                description: "方块名，如 dirt, cobblestone",
              },
              count: { type: "number", description: "搭几格高，默认 1" },
            },
            required: ["block"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "attack",
          description: "攻击指定实体",
          parameters: {
            type: "object",
            properties: {
              target: { type: "string" },
            },
            required: ["target"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "give",
          description: "把物品丢给指定玩家",
          parameters: {
            type: "object",
            properties: {
              item: { type: "string" },
              player: { type: "string" },
              count: { type: "number" },
            },
            required: ["item", "player"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "equip",
          description: "装备指定物品到手上",
          parameters: {
            type: "object",
            properties: { item: { type: "string" } },
            required: ["item"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "drop",
          description: "丢弃手持物品",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function",
        function: {
          name: "collect",
          description: "拾取附近掉落物",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function",
        function: {
          name: "use_item",
          description: "使用手持物品（吃食物、放船等）",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function",
        function: {
          name: "activate_block",
          description: "右键点击方块（开门、开箱、按按钮等）",
          parameters: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
            required: ["x", "y", "z"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "take_from_chest",
          description: "从指定坐标的箱子中拿取物品到背包",
          parameters: {
            type: "object",
            properties: {
              x: { type: "number", description: "箱子 X 坐标" },
              y: { type: "number", description: "箱子 Y 坐标" },
              z: { type: "number", description: "箱子 Z 坐标" },
              item: { type: "string", description: "要拿取的物品英文名" },
              count: { type: "number", description: "数量，不填则全部拿取" },
            },
            required: ["x", "y", "z", "item"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "put_to_chest",
          description: "把背包中的物品放入指定坐标的箱子",
          parameters: {
            type: "object",
            properties: {
              x: { type: "number", description: "箱子 X 坐标" },
              y: { type: "number", description: "箱子 Y 坐标" },
              z: { type: "number", description: "箱子 Z 坐标" },
              item: { type: "string", description: "要放入的物品英文名" },
              count: { type: "number", description: "数量，不填则全部放入" },
            },
            required: ["x", "y", "z", "item"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "take_from_furnace",
          description: "从指定坐标的熔炉中取出烧炼成品",
          parameters: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
            required: ["x", "y", "z"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "send_chat",
          description: "在公屏发送聊天消息",
          parameters: {
            type: "object",
            properties: {
              message: { type: "string", description: "要发送的消息" },
            },
            required: ["message"],
          },
        },
      },
    ];
  }

  getExecutors() {
    return {
      dig: (p) => this._dig(p),
      place: (p) => this._place(p),
      pillar_up: (p) => this._pillarUp(p),
      attack: (p) => this._attack(p),
      give: (p) => this._give(p),
      equip: (p) => this._equip(p),
      drop: () => this._drop(),
      collect: () => this._collect(),
      use_item: () => this._useItem(),
      activate_block: (p) => this._activateBlock(p),
      take_from_chest: (p) => this._takeFromChest(p),
      put_to_chest: (p) => this._putToChest(p),
      take_from_furnace: (p) => this._takeFromFurnace(p),
      send_chat: (p) => this._sendChat(p),
    };
  }

  /**
   * 根据方块类型获取最佳工具
   * 返回 { toolName, toolItem } 或 null（表示不需要工具/空手即可）
   */
  _bestTool(block) {
    const mcData = require("minecraft-data")(this.bot.version);
    const blockId = block.type ?? block.id;
    const blockName = (block.name || "").toLowerCase();
    const mat = mcData.materials[blockId] || {};

    // 工具优先级：钻石 > 铁 > 石 > 木 > 金
    const tierOrder = ["diamond", "iron", "stone", "wooden", "golden"];

    // 需要镐子的方块
    const pickaxeBlocks = [
      "stone",
      "cobblestone",
      "ore",
      "iron",
      "gold",
      "diamond",
      "emerald",
      "redstone",
      "lapis",
      "coal",
      "netherrack",
      "obsidian",
      "granite",
      "diorite",
      "andesite",
      "sandstone",
      "deepslate",
      "tuff",
      "calcite",
      "basalt",
      "blackstone",
      "furnace",
      "smoker",
      "blast_furnace",
      "dispenser",
      "dropper",
      "hopper",
      "enchanting_table",
      "anvil",
      "bell",
      "brewing_stand",
      "cauldron",
      "iron_bars",
      "iron_door",
      "iron_trapdoor",
      "rail",
      "detector_rail",
      "activator_rail",
      "powered_rail",
      "spawner",
      "concrete",
      "terracotta",
      "glazed_terracotta",
      "bricks",
      "nether_bricks",
      "quartz",
      "end_stone",
      "purpur",
      "prismarine",
      "ice",
      "packed_ice",
      "blue_ice",
    ];
    const isPickaxe = pickaxeBlocks.some((k) => blockName.includes(k));

    // 需要斧头的方块
    const axeBlocks = [
      "log",
      "wood",
      "planks",
      "crafting_table",
      "chest",
      "trapped_chest",
      "barrel",
      "bookshelf",
      "ladder",
      "fence",
      "fence_gate",
      "door",
      "trapdoor",
      "sign",
      "banner",
      "loom",
      "cartography_table",
      "fletching_table",
      "smithing_table",
      "composter",
      "beehive",
      "bee_nest",
      "note_block",
      "jukebox",
      "daylight_detector",
      "pumpkin",
      "melon",
      "bamboo",
      "cocoa",
      "mushroom",
      "stem",
      "hyphae",
      "wart",
      "vines",
      "scaffolding",
    ];
    const isAxe = axeBlocks.some((k) => blockName.includes(k));

    // 需要铲子的方块
    const shovelBlocks = [
      "dirt",
      "grass",
      "sand",
      "gravel",
      "clay",
      "soul_sand",
      "soul_soil",
      "snow",
      "powder_snow",
      "farmland",
      "mud",
      "mycelium",
      "podzol",
      "rooted_dirt",
      "coarse_dirt",
    ];
    const isShovel = shovelBlocks.some((k) => blockName.includes(k));

    // 需要锄头的方块（虽然挖不掉但给提示）
    const hoeBlocks = [
      "leaves",
      "wart_block",
      "hay",
      "target",
      "dried_kelp",
      "moss",
      "sculk",
      "sponge",
      "wool",
      "carpet",
    ];
    const isHoe = hoeBlocks.some((k) => blockName.includes(k));

    // 剪刀
    const shearBlocks = [
      "leaves",
      "wool",
      "cobweb",
      "vine",
      "grass",
      "fern",
      "dead_bush",
      "seagrass",
      "tall_grass",
      "large_fern",
      "vine",
      "glow_lichen",
      "hanging_roots",
      "twisting_vines",
      "weeping_vines",
      "nether_sprouts",
    ];
    const isShear = shearBlocks.some((k) => blockName.includes(k));

    // 确定工具类型
    let toolType = null;
    if (isPickaxe) toolType = "pickaxe";
    else if (isAxe) toolType = "axe";
    else if (isShovel) toolType = "shovel";
    else if (isHoe) toolType = "hoe";
    else if (isShear) toolType = "shears";

    if (!toolType) return null; // 空手即可

    // 按优先级找背包里的工具
    const inv = this.bot.inventory.items();
    for (const tier of tierOrder) {
      const toolName = toolType === "shears" ? "shears" : `${tier}_${toolType}`;
      const tool = inv.find((i) => i.name === toolName);
      if (tool) return { toolName, toolItem: tool };
    }

    // 没找到任何工具，返回需要的工具类型
    return { toolName: null, toolItem: null, needTool: toolType };
  }

  async _dig({ x, y, z }) {
    const { Vec3 } = require("vec3");
    const block = this.bot.blockAt(new Vec3(x, y, z));
    if (!block || block.name === "air") return "那里没有方块";

    // 选择最佳工具
    const tool = this._bestTool(block);

    if (tool) {
      if (tool.toolItem) {
        // 有工具 → 装备
        await this.bot.equip(tool.toolItem, "hand");
      }
    }

    // 先看向方块再挖
    await this.bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
    try {
      await this.bot.dig(block);
      return `挖掘了 ${block.displayName || block.name}，请拾取掉落物`;
    } catch (err) {
      return `挖掘失败: ${err.message}`;
    }
  }

  async _place({ block, x, y, z }) {
    const ref = this.bot.blockAt(new Vec3(x, y, z));
    if (!ref) return "找不到参照方块";
    const item = this.bot.inventory.items().find((i) => i.name.includes(block));
    if (!item) return `背包没有 ${block}`;

    await this.bot.equip(item, "hand");

    // 计算放置面：优先放在参照方块的上方，如果上方被占则尝试侧面
    const faces = [
      new Vec3(0, 1, 0), // 上方
      new Vec3(1, 0, 0), // 东
      new Vec3(-1, 0, 0), // 西
      new Vec3(0, 0, 1), // 南
      new Vec3(0, 0, -1), // 北
    ];

    for (const face of faces) {
      const targetPos = ref.position.plus(face);
      const targetBlock = this.bot.blockAt(targetPos);
      if (
        targetBlock &&
        (targetBlock.name === "air" || targetBlock.name === "cave_air")
      ) {
        try {
          await this.bot.lookAt(targetPos.offset(0.5, 0.5, 0.5));
          await this.bot.placeBlock(ref, face);
          return `放置了 ${block} 在 (${targetPos.x},${targetPos.y},${targetPos.z})`;
        } catch (err) {
          continue; // 这个面不行，试下一个
        }
      }
    }

    return `放置失败: 参照方块周围没有空位`;
  }

  /**
   * pillar_up — 搭方块上升
   * 原理：跳起来 → 在空中往脚下放方块 → 站到方块上
   * 重复 count 次
   */
  async _pillarUp({ block, count = 1 }) {
    const item = this.bot.inventory.items().find((i) => i.name.includes(block));
    if (!item) return `背包没有 ${block}`;

    await this.bot.equip(item, "hand");

    let placed = 0;
    for (let i = 0; i < count; i++) {
      // 1. 记录脚下方块（放置的参照面）
      const pos = this.bot.entity.position.floored();
      const refBlock = this.bot.blockAt(pos.offset(0, -1, 0));
      if (!refBlock || refBlock.name === "air") {
        return `脚下没有方块可以参照，已搭了 ${placed} 格`;
      }

      // 2. 跳起来
      this.bot.setControlState("jump", true);

      // 3. 等跳到最高点（约 200ms 后在空中）
      await new Promise((r) => setTimeout(r, 200));

      // 4. 在空中往脚下放方块
      try {
        await this.bot.lookAt(pos.offset(0.5, -0.5, 0.5));
        await this.bot.placeBlock(refBlock, new Vec3(0, 1, 0));
        placed++;
      } catch (err) {
        this.bot.setControlState("jump", false);
        return `搭方块失败: ${err.message}，已搭了 ${placed} 格`;
      }

      // 5. 松开跳跃，等落地
      this.bot.setControlState("jump", false);
      await new Promise((r) => setTimeout(r, 300));
    }

    return `搭了 ${placed} 格 ${block}，上升了 ${placed} 格`;
  }

  async _attack({ target }) {
    const entity = Object.values(this.bot.entities).find(
      (e) =>
        e.name === target ||
        e.username === target ||
        (e.displayName && e.displayName.includes(target)),
    );
    if (!entity) return `找不到 ${target}`;
    await this.bot.attack(entity);
    return `攻击 ${target}`;
  }

  async _give({ item, player, count = 1 }) {
    const invItem = this.bot.inventory
      .items()
      .find((i) => i.name.includes(item));
    if (!invItem) return `背包没有 ${item}`;
    const target = this.bot.players[player]?.entity;
    if (!target) return `找不到玩家 ${player}`;
    await this.bot.lookAt(target.position.offset(0, 1.6, 0));
    await this.bot.toss(invItem.type, null, count);
    return `给了 ${player} ${item} x${count}`;
  }

  async _equip({ item }) {
    const invItem = this.bot.inventory
      .items()
      .find((i) => i.name.includes(item));
    if (!invItem) return `背包没有 ${item}`;
    await this.bot.equip(invItem, "hand");
    return `装备了 ${item}`;
  }

  async _drop() {
    const item = this.bot.heldItem;
    if (!item) return "手上没有东西";
    await this.bot.tossStack(item);
    return `丢弃了 ${item.name}`;
  }

  async _collect() {
    const drops = Object.values(this.bot.entities).filter(
      (e) => e.name === "item",
    );
    if (drops.length === 0) return "附近没有掉落物";
    const { goals } = require("mineflayer-pathfinder");
    const nearest = drops.sort(
      (a, b) =>
        this.bot.entity.position.distanceTo(a.position) -
        this.bot.entity.position.distanceTo(b.position),
    )[0];
    this.bot.pathfinder.setGoal(new goals.GoalFollow(nearest, 0.5), false);
    return `正在拾取掉落物`;
  }

  async _useItem() {
    await this.bot.activateItem();
    return "使用了手持物品";
  }

  async _activateBlock({ x, y, z }) {
    const block = this.bot.blockAt(new Vec3(x, y, z));
    if (!block) return "那里没有方块";
    try {
      await this.bot.activateBlock(block);
      return `右键了 ${block.name}`;
    } catch (err) {
      return `无法交互: ${err.message}`;
    }
  }

  // ===== 容器操作 =====

  /**
   * 打开容器并走到旁边（通用）
   * @returns {{ container, block } | string} 成功返回容器对象，失败返回错误信息
   */
  async _openContainerAt(x, y, z, allowedNames) {
    const block = this.bot.blockAt(new Vec3(x, y, z));
    if (!block) return "那里没有方块";
    if (!allowedNames.some((n) => block.name.includes(n))) {
      return `${block.name} 不是可打开的容器`;
    }

    // 距离太远先走过去
    const dist = this.bot.entity.position.distanceTo(block.position);
    if (dist > 4) {
      const { goals } = require("mineflayer-pathfinder");
      const { Movements } = require("mineflayer-pathfinder");
      const mcData = require("minecraft-data")(this.bot.version);
      const moves = new Movements(this.bot, mcData);
      moves.canDig = false;
      this.bot.pathfinder.setMovements(moves);
      try {
        await Promise.race([
          this.bot.pathfinder.goto(new goals.GoalNear(x, y, z, 2)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("超时")), 8000),
          ),
        ]);
      } catch {
        this.bot.pathfinder.setGoal(null);
        return `无法走到容器旁边`;
      }
      this.bot.pathfinder.setGoal(null);
    }

    try {
      const container = await this.bot.openContainer(block);
      return { container, block };
    } catch (err) {
      return `无法打开容器: ${err.message}`;
    }
  }

  /** 从箱子拿物品 */
  async _takeFromChest({ x, y, z, item, count }) {
    const result = await this._openContainerAt(x, y, z, [
      "chest",
      "trapped_chest",
      "barrel",
      "shulker_box",
    ]);
    if (typeof result === "string") return result;

    const { container } = result;
    const containerItems = container.containerItems();

    // 查找匹配物品
    const matches = containerItems.filter((i) => i.name.includes(item));
    if (matches.length === 0) {
      await container.close();
      return `箱子里没有 ${item}`;
    }

    // 计算拿取数量
    const totalAvailable = matches.reduce((sum, i) => sum + i.count, 0);
    const takeCount = count ? Math.min(count, totalAvailable) : totalAvailable;

    try {
      // 逐个槽位拿取
      let remaining = takeCount;
      for (const match of matches) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, match.count);
        await container.withdraw(match.type, null, take);
        remaining -= take;
      }
      await container.close();
      return `从箱子拿了 ${item} x${takeCount}`;
    } catch (err) {
      try {
        await container.close();
      } catch {}
      return `拿取失败: ${err.message}`;
    }
  }

  /** 往箱子放物品 */
  async _putToChest({ x, y, z, item, count }) {
    const result = await this._openContainerAt(x, y, z, [
      "chest",
      "trapped_chest",
      "barrel",
      "shulker_box",
    ]);
    if (typeof result === "string") return result;

    const { container } = result;

    // 从背包找物品
    const invItem = this.bot.inventory
      .items()
      .find((i) => i.name.includes(item));
    if (!invItem) {
      await container.close();
      return `背包没有 ${item}`;
    }

    const putCount = count ? Math.min(count, invItem.count) : invItem.count;

    try {
      await container.deposit(invItem.type, null, putCount);
      await container.close();
      return `往箱子放了 ${item} x${putCount}`;
    } catch (err) {
      try {
        await container.close();
      } catch {}
      return `放入失败: ${err.message}`;
    }
  }

  /** 从熔炉取成品 */
  async _takeFromFurnace({ x, y, z }) {
    const block = this.bot.blockAt(new Vec3(x, y, z));
    if (!block) return "那里没有方块";
    if (
      !["furnace", "blast_furnace", "smoker"].some((n) =>
        block.name.includes(n),
      )
    ) {
      return `${block.name} 不是熔炉`;
    }

    // 距离太远先走过去
    const dist = this.bot.entity.position.distanceTo(block.position);
    if (dist > 4) {
      const { goals } = require("mineflayer-pathfinder");
      const { Movements } = require("mineflayer-pathfinder");
      const mcData = require("minecraft-data")(this.bot.version);
      const moves = new Movements(this.bot, mcData);
      moves.canDig = false;
      this.bot.pathfinder.setMovements(moves);
      try {
        await Promise.race([
          this.bot.pathfinder.goto(new goals.GoalNear(x, y, z, 2)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("超时")), 8000),
          ),
        ]);
      } catch {
        this.bot.pathfinder.setGoal(null);
        return `无法走到熔炉旁边`;
      }
      this.bot.pathfinder.setGoal(null);
    }

    try {
      const furnace = await this.bot.openFurnace(block);
      const output = furnace.outputItem();
      if (!output) {
        await furnace.close();
        return "熔炉输出槽为空";
      }

      const itemName = output.name;
      const itemCount = output.count;
      await furnace.takeOutput();
      await furnace.close();
      return `从熔炉取出 ${itemName} x${itemCount}`;
    } catch (err) {
      return `取成品失败: ${err.message}`;
    }
  }

  async _sendChat({ message }) {
    const clean = message.substring(0, 200).trim();
    if (this.messageModule) {
      await this.messageModule.send(clean);
    } else {
      this.bot.chat(clean);
    }
    return `发送了: ${clean}`;
  }
}

module.exports = { InteractModule };

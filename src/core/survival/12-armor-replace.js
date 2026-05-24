/**
 * #12 护甲补充 (Armor Replace)
 * 触发：护甲槽为空 / 护甲耐久过低 / 背包有更好护甲 → 自动穿上最佳护甲
 */
class ArmorReplace {
  constructor(bot) {
    this.bot = bot;
    this.cooldown = 0;
    this._equipping = false;
    this._lastScan = 0;
    this._scanCache = null;
  }

  check(now) {
    if (this._equipping) return;
    if (now - this.cooldown < 2000) return;

    try {
      // 每 5 秒重新扫描背包，避免每次 tick 都遍历
      if (!this._scanCache || now - this._lastScan > 5000) {
        this._scanCache = this._scanInventory();
        this._lastScan = now;
      }

      const armorSlots = [
        { slot: this.bot.getEquipmentDestSlot('head'), equipDest: 'head', type: 'helmet' },
        { slot: this.bot.getEquipmentDestSlot('torso'), equipDest: 'torso', type: 'chestplate' },
        { slot: this.bot.getEquipmentDestSlot('legs'), equipDest: 'legs', type: 'leggings' },
        { slot: this.bot.getEquipmentDestSlot('feet'), equipDest: 'feet', type: 'boots' },
      ];

      for (const { slot, equipDest, type } of armorSlots) {
        const current = this.bot.inventory.slots[slot];
        const best = this._scanCache[type];

        // 情况1：槽位为空 → 直接穿
        if (!current) {
          if (best) {
            this._doEquip(best, equipDest, 'empty');
            return;
          }
          continue;
        }

        // 情况2：当前护甲耐久过低 → 换同款或更好的
        const durability = this._getDurability(current);
        if (durability !== null && durability < 0.15) {
          if (best && best.name === current.name) {
            this._doEquip(best, equipDest, 'low durability');
            return;
          }
        }

        // 情况3：背包有更好的护甲 → 升级
        if (best && this._isBetter(best, current)) {
          this._doEquip(best, equipDest, 'upgrade');
          return;
        }
      }
    } catch (err) { console.error('[Survival] armor:', err.message); }
  }

  /** 扫描背包，返回每种护甲类型的最佳物品 */
  _scanInventory() {
    const best = { helmet: null, chestplate: null, leggings: null, boots: null };
    const items = this.bot.inventory.items();
    for (const item of items) {
      const type = this._getArmorType(item.name);
      if (!type) continue;
      if (!best[type] || this._isBetter(item, best[type])) {
        best[type] = item;
      }
    }
    return best;
  }

  /** 判断 a 是否比 b 更好（材质优先，同材质比耐久） */
  _isBetter(a, b) {
    const rankA = this._materialRank(a.name);
    const rankB = this._materialRank(b.name);
    if (rankA !== rankB) return rankA < rankB;
    return this._getDurability(a) > this._getDurability(b);
  }

  /** 材质排名（越小越好） */
  _materialRank(name) {
    const n = name.toLowerCase();
    if (n.includes('netherite')) return 0;
    if (n.includes('diamond')) return 1;
    if (n.includes('iron')) return 2;
    if (n.includes('chainmail') || n.includes('chain')) return 3;
    if (n.includes('gold') || n.includes('golden')) return 4;
    if (n.includes('leather')) return 5;
    if (n.includes('turtle')) return 3; // 龟壳 ≈ 锁链
    return 99;
  }

  /** 获取物品耐久比例 (0~1)，非护甲返回 null */
  _getDurability(item) {
    if (!item || !item.nbt) return null;
    try {
      const nbt = item.nbt;
      // minecraft:damage / maxDurability
      if (nbt.value?.Damage?.value !== undefined) {
        const damage = nbt.value.Damage.value;
        const maxDura = this._maxDurability(item.name);
        if (maxDura > 0) return 1 - damage / maxDura;
      }
    } catch {}
    return 1; // 无 damage 信息视为满耐久
  }

  /** 根据物品名估算最大耐久 */
  _maxDurability(name) {
    const n = name.toLowerCase();
    if (n.includes('netherite')) return n.includes('helmet') ? 407 : n.includes('chestplate') ? 592 : n.includes('leggings') ? 555 : 481;
    if (n.includes('diamond')) return n.includes('helmet') ? 363 : n.includes('chestplate') ? 528 : n.includes('leggings') ? 495 : 429;
    if (n.includes('iron')) return n.includes('helmet') ? 165 : n.includes('chestplate') ? 240 : n.includes('leggings') ? 225 : 195;
    if (n.includes('chain')) return n.includes('helmet') ? 165 : n.includes('chestplate') ? 240 : n.includes('leggings') ? 225 : 195;
    if (n.includes('gold')) return n.includes('helmet') ? 77 : n.includes('chestplate') ? 112 : n.includes('leggings') ? 105 : 91;
    if (n.includes('leather')) return n.includes('helmet') ? 55 : n.includes('chestplate') ? 80 : n.includes('leggings') ? 75 : 65;
    if (n.includes('turtle')) return 275;
    return 200;
  }

  /** 根据物品名判断护甲类型 */
  _getArmorType(name) {
    const n = name.toLowerCase();
    if (/helmet|cap|hood|turtle/.test(n) && !/chestplate|leggings|boots/.test(n)) return 'helmet';
    if (/chestplate|tunic/.test(n)) return 'chestplate';
    if (/leggings|pants/.test(n)) return 'leggings';
    if (/boots/.test(n)) return 'boots';
    return null;
  }

  _doEquip(item, dest, reason) {
    this._equipping = true;
    this.cooldown = Date.now();
    this._scanCache = null; // 穿完后下次重新扫描
    console.log(`[Survival] 🛡️ #12 Equipping ${item.name} → ${dest} (${reason})`);
    this.bot.equip(item, dest)
      .catch(() => {})
      .finally(() => { this._equipping = false; });
  }

  reset() {
    this.cooldown = 0;
    this._equipping = false;
    this._scanCache = null;
  }
}

module.exports = { ArmorReplace };

/**
 * 被动子模块 — 环境感知
 *
 * 职责：昼夜变化提醒、贵重物品掉落提醒
 */
class AwarenessPassive {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** 注册所有环境感知事件 */
  init() {
    this._onNightfall();
    this._onItemDrop();
  }

  // ===== 事件监听 =====

  /** 夜晚提醒 */
  _onNightfall() {
    let wasDay = true;
    this.ctx.bot.on('time', () => {
      if (!this.ctx.enabled) return;
      const time = this.ctx.bot.time;
      if (!time) return;
      const hour = Math.floor(time.timeOfDay / 1000);
      const isNight = hour > 18 || hour < 6;

      if (isNight && wasDay) {
        wasDay = false;
        this.ctx.injectEvent('天亮了，夜晚来临');
      } else if (!isNight && !wasDay) {
        wasDay = true;
        this.ctx.injectEvent('天黑了');
      }
    });
  }

  /** 贵重物品掉落提醒 */
  _onItemDrop() {
    const valuableItems = [
      'diamond', 'netherite', 'elytra', 'trident', 'totem',
      'enchanted_golden_apple', 'nether_star', 'beacon',
    ];

    this.ctx.bot.on('itemDrop', (entity) => {
      if (!this.ctx.enabled) return;
      const metadata = entity.metadata;
      if (!Array.isArray(metadata)) return;
      const itemMeta = metadata.find(m => m && m.key === 'item');
      const item = itemMeta?.value;
      if (!item) return;
      const name = item.name || '';
      if (valuableItems.some(v => name.includes(v))) {
        this.ctx.say(`💎 附近有 ${name.replace('minecraft:', '')} 掉落！`);
        this.ctx.injectEvent(`附近掉落贵重物品: ${name.replace('minecraft:', '')}`);
      }
    });
  }
}

module.exports = { AwarenessPassive };

/**
 * 被动模块 — 模块化入口
 *
 * 工作流：游戏事件 → 预设规则 → 自动执行 → LLM 决策
 *
 * 子模块：
 *   - combat.js    战斗响应（受伤反击、逃跑、苦力怕闪避、死亡）
 *   - survival.js  生存响应（饥饿进食）
 *   - awareness.js 环境感知（昼夜、贵重掉落）
 *
 * 共享上下文 (ctx) 通过构造函数注入到各子模块，
 * 子模块通过 ctx.bot / ctx.say() / ctx.injectEvent() 等访问公共能力。
 */
const { CombatPassive } = require('./combat');
const { SurvivalPassive } = require('./survival');
const { AwarenessPassive } = require('./awareness');

class PassiveModule {
  constructor(bot, deps) {
    this.bot = bot;
    this.memory = deps.journal;
    this.messageModule = deps.messageModule;
    this.agent = deps.agent;
    this.config = deps.config;

    /** 冷却计时器 */
    this._cooldowns = {};

    /** 是否启用 */
    this._enabled = this.config.autoDecision?.enabled !== false;

    /** 子模块开关 */
    this._combatEnabled = this.config.autoDecision?.combat !== false;
    this._survivalEnabled = this.config.autoDecision?.survival !== false;
    this._awarenessEnabled = this.config.autoDecision?.awareness !== false;

    /** 配置 */
    this._threatRadius = this.config.combat?.threatRadius ?? 16;
    this._dodgeHpThreshold = this.config.combat?.dodgeHpThreshold ?? 10;

    /**
     * 共享上下文 — 注入给所有子模块
     * 子模块不直接依赖 PassiveModule，只依赖 ctx 接口
     */
    const self = this;
    this._ctx = {
      bot: this.bot,
      memory: this.memory,
      agent: this.agent,
      config: this.config,

      /** 是否启用（动态读取） */
      get enabled() { return self._enabled; },

      /** 威胁半径 */
      get threatRadius() { return self._threatRadius; },

      /** 逃跑血量阈值 */
      get dodgeHpThreshold() { return self._dodgeHpThreshold; },

      /** 是否正在逃跑（供主动模块检查，避免冲突） */
      get isDodging() { return self._combatModule?._dodging ?? false; },

      /** 冷却检查 */
      onCooldown: (key, ms) => this._onCooldown(key, ms),

      /** 注入 LLM 事件 */
      injectEvent: (summary) => this._injectEvent(summary),

      /** 发送游戏消息 */
      say: (msg) => this._say(msg),
    };

    /** 子模块实例列表 */
    this._modules = [];
  }

  /** 初始化所有子模块 */
  init() {
    if (!this._enabled) {
      console.log('[Passive] ⏸️ 被动模块已禁用 (autoDecision.enabled=false)');
      return;
    }

    this._modules = [];

    if (this._combatEnabled) {
      this._combatModule = new CombatPassive(this._ctx);
      this._modules.push(this._combatModule);
    }
    if (this._survivalEnabled) {
      this._modules.push(new SurvivalPassive(this._ctx));
    }
    if (this._awarenessEnabled) {
      this._modules.push(new AwarenessPassive(this._ctx));
    }

    for (const mod of this._modules) {
      mod.init();
    }

    const names = this._modules.map(m => m.constructor.name.replace('Passive', '').toLowerCase()).join(', ');
    console.log(`[Passive] 🛡️ 被动模块已启动 (${this._modules.length} 个子模块: ${names})`);
  }

  /** 关闭被动模块 */
  disable() {
    this._enabled = false;
    console.log('[Passive] ⏸️ 被动模块已暂停');
  }

  enable() {
    this._enabled = true;
    console.log('[Passive] ▶️ 被动模块已恢复');
  }

  // ===== 共享能力（ctx 代理） =====

  _onCooldown(key, ms) {
    const now = Date.now();
    if (this._cooldowns[key] && now - this._cooldowns[key] < ms) {
      return true;
    }
    this._cooldowns[key] = now;
    return false;
  }

  _injectEvent(summary) {
    if (!this.agent) return;
    try { this.agent.injectEvent(summary); } catch {}
  }

  _say(msg) {
    if (!this.messageModule) {
      this.bot.chat(msg);
      return;
    }
    this.messageModule.send(msg).catch(() => {
      try { this.bot.chat(msg); } catch {}
    });
  }
}

module.exports = { PassiveModule };

/**
 * 🚦 InputRouter — 输入路由器
 * 职责：LLM 一次性完成分类 + 任务规划
 *   - 对话 → 交给 DialogueManager
 *   - 指令 → 直接输出任务计划 steps，交给 Scheduler 执行
 *
 * LLM 调用点之一
 */

class InputRouter {
  constructor(llm) {
    this.llm = llm;
    this._timeout = 25000;
  }

  /**
   * 路由玩家输入
   * @param {string} message - 玩家消息
   * @param {string} username - 玩家名
   * @param {object} context - 环境上下文
   * @returns {{ type: 'command'|'dialogue', intent?: string, steps?: array, strategy?: string, raw: string }}
   */
  async route(message, username, context = {}) {
    // 快速路径：以 ! 开头的调试命令直接跳过 LLM
    if (message.startsWith('!')) {
      console.log(`[Router] ⚡ Debug: ${message}`);
      return { type: 'debug', intent: 'debug', params: { cmd: message }, raw: message };
    }

    // 记录用户消息到多轮对话历史
    this.llm.addChatMessage('user', message, username);

    // LLM 一次性完成：分类 + 规划
    console.log(`[Router] 🤖 LLM: "${message}"`);
    try {
      const result = await this._classifyAndPlan(message, context);
      console.log(`[Router] → ${result.type}${result.intent ? '/' + result.intent : ''}${result.steps ? ` (${result.steps.length} steps)` : ''}`);

      // 记录 assistant 回复到多轮对话历史
      if (result.type === 'command' && result.strategy) {
        this.llm.addChatMessage('assistant', `[执行] ${result.strategy}`);
      }

      return result;
    } catch (err) {
      console.error(`[Router] ❌ LLM failed: ${err.message}`);
      return { type: 'dialogue', raw: message };
    }
  }

  /**
   * LLM 分类 + 规划（一次性）
   * 使用多轮对话格式：system + 历史 + 当前 user（含环境上下文）
   */
  async _classifyAndPlan(message, context) {
    const system = `你是 Minecraft AI 伙伴的大脑。根据玩家消息和对话历史，判断是"对话"还是"指令"。

如果是**对话**（闲聊、问状态、打招呼），输出：
{"type":"dialogue"}

如果是**指令**（要求执行动作），直接规划为低层动作序列并输出：

**可用动作（共14个）：**

移动类：
- follow(player) — 跟随玩家
- wander() — 随机漫游
- goto(x, y, z) — 导航到坐标
- stop() — 停止移动
- dodge() — 紧急闪避
- tower(height) — 垫方块向上

交互类：
- left_click(target, action, item, count) — 左键
  - 攻击: left_click({ target: "zombie", action: "attack", item: "iron_sword" })
  - 挖掘: left_click({ target: "100,64,200", action: "dig", item: "iron_pickaxe", count: 5 })
- use(block, action, item, input, fuel, count) — 右键
  - 方块: use({ block: "crafting_table" })
  - 烧炼: use({ block: "furnace", action: "smelt", input: "iron_ore", fuel: "coal", count: 8 })
  - 进食: use({ action: "eat" })

建造/合成类：
- place(block, x, y, z, direction) — 放置方块
- craft(item, count) — 合成物品
- sleep() — 睡觉

社交/信息类：
- chat(message) — 发消息
- give(item, count, player) — 给物品
- search_wiki(query) — 查知识库

**指令输出格式：**
{
  "type": "command",
  "intent": "gather",
  "strategy": "找到橡树并砍伐5个原木",
  "steps": [
    {"action": "left_click", "params": {"target": "oak_log", "action": "dig", "item": "iron_axe", "count": 5}}
  ]
}

**规则：**
- 步骤具体，参数明确，3-8 步为宜
- 挖掘必须指定 item（如 iron_pickaxe）
- 攻击必须指定 item（如 iron_sword）
- 考虑工具等级：木<石<铁<钻石
- 如果只是对话，只输出 {"type":"dialogue"}

intent 可选值：move, gather, craft, give, combat, build, survive, smelt, search, stop`;

    // 当前环境上下文
    const envPrompt = `Bot 状态: HP:${context.health ?? '?'}/20 | 饱食度:${context.food ?? '?'} | 手持:${context.equipped ?? '?'}
背包: ${context.inventory ?? '空'}
附近方块: ${context.blocks ?? '无'}
附近实体: ${context.entities ?? '无'}
生物群系: ${context.biome ?? '?'} | ${context.isUnderground ? '地下' : '地表'} | ${context.dayPhase ?? '?'}

输出 JSON:`;

    // 多轮对话格式：system + 最近历史（最多 6 条）+ 当前 user
    const chatHistory = this.llm.getChatHistory();
    const recentHistory = chatHistory.slice(-6);
    const messages = [
      { role: 'system', content: system },
      ...recentHistory,
      { role: 'user', content: envPrompt },
    ];

    try {
      const response = await this._withTimeout(
        this.llm.client.chat.completions.create({
          model: this.llm.model,
          messages,
          temperature: 0.2,
          max_tokens: 600,
          response_format: { type: 'json_object' },
          extra_body: this.llm._extraBody(),
        }),
        this._timeout,
      );

      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content);

      if (parsed.type === 'dialogue') {
        return { type: 'dialogue', raw: message };
      }

      // 指令：返回完整任务计划
      return {
        type: 'command',
        intent: parsed.intent || 'move',
        steps: parsed.steps || [],
        strategy: parsed.strategy || message,
        raw: message,
      };
    } catch (err) {
      console.error(`[InputRouter] Parse error: ${err.message}`);
      return { type: 'dialogue', raw: message };
    }
  }

  /** Promise 超时包装 */
  _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms)
      ),
    ]);
  }
}

module.exports = { InputRouter };

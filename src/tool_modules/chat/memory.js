/**
 * 记忆工具模块 — LLM 可主动调用的长期记忆
 *
 * 存储为纯文本列表，启动时以 assistant 身份注入到对话历史中。
 * 存储：内存中，同时持久化到 memory/<host>_<port>_memory.json
 */
const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '..', '..', '..', 'memory');

class MemoryModule {
  constructor(bot, deps) {
    this.bot = bot;
    this.config = deps.config;
    this.agent = deps.agent;

    /** 记忆条目 [{ text, ts }] */
    this._entries = [];

    /** 文件路径 */
    this._file = '';
  }

  /** 初始化 */
  init() {
    const { host, port } = this.config.bot;
    const safeName = `${host}_${port}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    this._file = path.join(MEMORY_DIR, `${safeName}_memory.json`);

    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }

    if (fs.existsSync(this._file)) {
      try {
        this._entries = JSON.parse(fs.readFileSync(this._file, 'utf-8'));
        console.log(`[Memory] 📂 已加载长期记忆: ${this._entries.length} 条`);
      } catch {
        console.log(`[Memory] ⚠️ 记忆文件损坏，重新创建`);
        this._entries = [];
        this._save();
      }
    } else {
      this._save();
      console.log(`[Memory] 🆕 新记忆文件: ${safeName}_memory.json`);
    }

    // 将长期记忆注入到 LLM 对话历史（以 assistant 身份）
    this._injectToHistory();
  }

  /** 将长期记忆注入 LLM 对话历史 */
  _injectToHistory() {
    if (!this.agent?.llm || this._entries.length === 0) return;
    const summary = this._entries
      .map((e, i) => `${i + 1}. ${e.text}`)
      .join('\n');
    this.agent.llm.history.push({
      role: 'assistant',
      content: `[长期记忆]\n${summary}`,
    });
    console.log(`[Memory] 📥 已注入 ${this._entries.length} 条长期记忆到对话`);
  }

  _save() {
    try {
      fs.writeFileSync(this._file, JSON.stringify(this._entries, null, 2));
    } catch (err) {
      console.error(`[Memory] ❌ 保存失败: ${err.message}`);
    }
  }

  // ===== 工具定义 =====

  getToolDefs() {
    return [
      {
        type: 'function',
        function: {
          name: 'remember',
          description: '记住一条重要信息（知识、计划、偏好等），之后会自动出现在对话上下文中',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: '要记住的内容' },
            },
            required: ['text'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'recall',
          description: '查看所有长期记忆',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'forget',
          description: '删除一条不再需要的记忆（按序号）',
          parameters: {
            type: 'object',
            properties: {
              index: { type: 'number', description: '要删除的记忆序号（从 1 开始）' },
            },
            required: ['index'],
          },
        },
      },
    ];
  }

  getExecutors() {
    return {
      remember: (p) => this._remember(p),
      recall: () => this._recall(),
      forget: (p) => this._forget(p),
    };
  }

  // ===== 实现 =====

  _remember({ text }) {
    this._entries.push({ text, ts: new Date().toISOString() });

    // 最多 100 条
    if (this._entries.length > 100) {
      this._entries = this._entries.slice(-100);
    }

    this._save();

    // 同步注入到 LLM 对话历史
    if (this.agent?.llm) {
      this.agent.llm.history.push({
        role: 'assistant',
        content: `[新记忆] ${text}`,
      });
    }

    return `已记住 (第${this._entries.length}条)`;
  }

  _recall() {
    if (this._entries.length === 0) return '暂无长期记忆';
    return this._entries
      .map((e, i) => `${i + 1}. ${e.text}`)
      .join('\n');
  }

  _forget({ index }) {
    const i = index - 1;
    if (i < 0 || i >= this._entries.length) return `无效序号: ${index}`;
    const removed = this._entries[i].text;
    this._entries.splice(i, 1);
    this._save();
    return `已删除: ${removed}`;
  }
}

module.exports = { MemoryModule };

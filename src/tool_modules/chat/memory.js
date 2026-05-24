/**
 * 记忆工具模块 — LLM 可主动调用的记忆读写工具
 *
 * 与 journal（日志记忆）分离：
 *   - journal: 自动记录事件/统计/对话历史持久化
 *   - memory:  LLM 主动写入/查询的关键信息（知识、计划、偏好等）
 *
 * 存储：内存中，同时持久化到 memory/<host>_<port>_memory.json
 */
const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '..', '..', '..', 'memory');

class MemoryModule {
  constructor(bot, deps) {
    this.bot = bot;
    this.config = deps.config;

    /** 记忆条目 [{ key, value, ts }] */
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
        console.log(`[Memory] 📂 已加载记忆: ${this._entries.length} 条`);
      } catch {
        console.log(`[Memory] ⚠️ 记忆文件损坏，重新创建`);
        this._entries = [];
        this._save();
      }
    } else {
      this._save();
      console.log(`[Memory] 🆕 新记忆文件: ${safeName}_memory.json`);
    }
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
          description: '记住一条重要信息（知识、计划、偏好等），之后可以通过 recall 查询',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: '记忆的键/主题，如 "base_location", "plan", "preference"' },
              value: { type: 'string', description: '记忆的内容' },
            },
            required: ['key', 'value'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'recall',
          description: '查询之前记住的信息，支持按 key 精确查询或模糊搜索',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: '要查询的 key（留空则返回所有记忆摘要）' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'forget',
          description: '删除一条不再需要的记忆',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: '要删除的记忆 key' },
            },
            required: ['key'],
          },
        },
      },
    ];
  }

  getExecutors() {
    return {
      remember: (p) => this._remember(p),
      recall: (p) => this._recall(p),
      forget: (p) => this._forget(p),
    };
  }

  // ===== 实现 =====

  _remember({ key, value }) {
    // 同 key 则覆盖
    const idx = this._entries.findIndex(e => e.key === key);
    if (idx >= 0) {
      this._entries[idx] = { key, value, ts: new Date().toISOString() };
    } else {
      this._entries.push({ key, value, ts: new Date().toISOString() });
    }

    // 最多 100 条
    if (this._entries.length > 100) {
      this._entries = this._entries.slice(-100);
    }

    this._save();
    return `已记住: ${key}`;
  }

  _recall({ key }) {
    if (!key) {
      // 返回所有 key 摘要
      if (this._entries.length === 0) return '暂无记忆';
      const keys = this._entries.map(e => `${e.key}: ${e.value.substring(0, 40)}...`).join('\n');
      return `记忆列表 (${this._entries.length} 条):\n${keys}`;
    }

    // 精确匹配
    const exact = this._entries.find(e => e.key === key);
    if (exact) return `[${key}]: ${exact.value}`;

    // 模糊匹配
    const fuzzy = this._entries.filter(e => e.key.includes(key) || e.value.includes(key));
    if (fuzzy.length === 0) return `未找到关于 "${key}" 的记忆`;
    return fuzzy.map(e => `[${e.key}]: ${e.value}`).join('\n');
  }

  _forget({ key }) {
    const idx = this._entries.findIndex(e => e.key === key);
    if (idx < 0) return `未找到记忆: ${key}`;
    this._entries.splice(idx, 1);
    this._save();
    return `已删除记忆: ${key}`;
  }
}

module.exports = { MemoryModule };

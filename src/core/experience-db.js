/**
 * 🧠 ExperienceDB — 三层经验数据库
 *
 * 第一层：动作缓存（内存级，一次任务内有效）
 * 第二层：场景-解决方案映射（持久化到 bot_experiences.json）
 * 第三层：条件泛化（让经验适用范围更广）
 *
 * 本质：缓存 LLM 的推理结果，下次遇到相同情况直接复用
 */

const fs = require('fs');
const path = require('path');

const EXPERIENCE_DIR = path.join(__dirname, '..', '..', 'experiences');

// ===== 泛化规则 =====
// 相似生物群系共享经验
const BIOME_GROUPS = {
  no_tree: ['desert', 'mesa', 'badlands', 'savanna_plateau', 'eroded_badlands', 'wooded_badlands'],
  cold: ['snowy_plains', 'snowy_taiga', 'snowy_slopes', 'frozen_peaks', 'ice_spikes', 'frozen_ocean', 'deep_frozen_ocean'],
  ocean: ['ocean', 'deep_ocean', 'warm_ocean', 'lukewarm_ocean', 'cold_ocean', 'frozen_ocean'],
  swamp: ['swamp', 'mangrove_swamp'],
  jungle: ['jungle', 'sparse_jungle', 'bamboo_jungle'],
  forest: ['forest', 'flower_forest', 'birch_forest', 'old_growth_birch_forest', 'dark_forest', 'grove'],
  taiga: ['taiga', 'old_growth_pine_taiga', 'old_growth_spruce_taiga'],
  plains: ['plains', 'sunflower_plains', 'meadow'],
  mountain: ['windswept_hills', 'windswept_forest', 'windswept_gravelly_hills', 'stony_peaks', 'jagged_peaks', 'frozen_peaks'],
  nether: ['nether_wastes', 'crimson_forest', 'warped_forest', 'soul_sand_valley', 'basalt_deltas'],
  end: ['the_end', 'end_highlands', 'end_midlands', 'end_barrens', 'small_end_islands'],
  cave: ['dripstone_caves', 'lush_caves', 'deep_dark'],
};

// 相似问题共享经验
const PROBLEM_GROUPS = {
  no_resource: [
    'find_nearest_tree_failed', 'no_tree', 'no_wood', 'no_log',
    'find_nearest_ore_failed', 'no_ore', 'no_stone', 'no_coal',
    'no_iron', 'no_diamond',
  ],
  no_food: ['no_food', 'hungry_no_food', 'find_food_failed'],
  lost: ['lost', 'cant_find_home', 'no_landmark', 'stuck'],
  danger: ['under_attack', 'low_hp', 'surrounded', 'on_fire', 'in_lava'],
  tool_missing: ['no_pickaxe', 'no_axe', 'no_sword', 'no_shovel', 'tool_broken'],
  cant_mine: ['tool_too_weak', 'need_better_tool', 'cant_break_block'],
};

/**
 * 判断两个生物群系是否相似
 */
function isSimilarBiome(biome1, biome2) {
  if (!biome1 || !biome2) return false;
  const b1 = biome1.toLowerCase().replace(/\s+/g, '_');
  const b2 = biome2.toLowerCase().replace(/\s+/g, '_');
  if (b1 === b2) return true;

  for (const group of Object.values(BIOME_GROUPS)) {
    if (group.includes(b1) && group.includes(b2)) return true;
  }
  return false;
}

/**
 * 判断两个问题是否相似
 */
function isSimilarProblem(problem1, problem2) {
  if (!problem1 || !problem2) return false;
  if (problem1 === problem2) return true;

  for (const group of Object.values(PROBLEM_GROUPS)) {
    if (group.includes(problem1) && group.includes(problem2)) return true;
  }
  return false;
}

/**
 * 获取生物群系所属分组
 */
function getBiomeGroup(biome) {
  if (!biome) return 'unknown';
  const b = biome.toLowerCase().replace(/\s+/g, '_');
  for (const [group, biomes] of Object.entries(BIOME_GROUPS)) {
    if (biomes.includes(b)) return group;
  }
  return 'other';
}

class ExperienceDB {
  /**
   * @param {string} worldId - 存档标识，如 "localhost:8233" 或 "hypixel"
   */
  constructor(worldId = 'default') {
    this.worldId = this._sanitizeId(worldId);
    this._filePath = path.join(EXPERIENCE_DIR, `${this.worldId}.json`);

    /** 第一层：动作缓存（内存级，重启丢失） */
    this.actionCache = new Map();

    /** 第二层：场景-解决方案映射（持久化到 experiences/<worldId>.json） */
    this.experiences = this._load();

    /** 统计 */
    this.stats = {
      cacheHits: 0,
      experienceHits: 0,
      llmCalls: 0,
      totalSaved: 0,
    };

    /** 自动保存定时器 */
    this._saveTimer = null;
  }

  /** 清理 worldId 为合法文件名 */
  _sanitizeId(id) {
    return String(id).replace(/[^a-zA-Z0-9_.\-@]/g, '_').substring(0, 64) || 'default';
  }

  // ===== 持久化 =====

  _load() {
    try {
      // 确保目录存在
      if (!fs.existsSync(EXPERIENCE_DIR)) {
        fs.mkdirSync(EXPERIENCE_DIR, { recursive: true });
      }
      if (fs.existsSync(this._filePath)) {
        const data = JSON.parse(fs.readFileSync(this._filePath, 'utf-8'));
        console.log(`[ExperienceDB] Loaded ${data.length || 0} experiences from ${this.worldId}`);
        return Array.isArray(data) ? data : [];
      }
    } catch (e) {
      console.log(`[ExperienceDB] Failed to load ${this.worldId}:`, e.message);
    }
    return [];
  }

  _save() {
    if (!this._saveTimer) {
      this._saveTimer = setTimeout(() => {
        try {
          // 只保留最近 500 条经验，清理废弃的
          const valid = this.experiences
            .filter(e => !e.deprecated)
            .slice(-500);
          this.experiences = valid;
          if (!fs.existsSync(EXPERIENCE_DIR)) {
            fs.mkdirSync(EXPERIENCE_DIR, { recursive: true });
          }
          fs.writeFileSync(this._filePath, JSON.stringify(valid, null, 2));
          console.log(`[ExperienceDB] Saved ${valid.length} experiences to ${this.worldId}`);
        } catch (e) {
          console.error('[ExperienceDB] Failed to save:', e.message);
        }
        this._saveTimer = null;
      }, 3000);
    }
  }

  // ===== 第一层：动作缓存 =====

  /**
   * 缓存一个动作链
   * @param {string} goalHash - 目标哈希（如 "craft:stone_pickaxe"）
   * @param {object} chain - { steps: [...], description: '...' }
   * @param {number} ttl - 有效期（毫秒），默认 10 分钟
   */
  cacheActionChain(goalHash, chain, ttl = 600000) {
    this.actionCache.set(goalHash, {
      ...chain,
      createdAt: Date.now(),
      ttl,
    });
    // 限制缓存大小
    if (this.actionCache.size > 50) {
      const oldest = [...this.actionCache.entries()]
        .sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.actionCache.delete(oldest[0]);
    }
  }

  /**
   * 查找动作缓存
   * @param {string} goalHash
   * @returns {object|null}
   */
  findActionCache(goalHash) {
    const entry = this.actionCache.get(goalHash);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > entry.ttl) {
      this.actionCache.delete(goalHash);
      return null;
    }
    this.stats.cacheHits++;
    return entry;
  }

  /** 清空动作缓存 */
  clearActionCache() {
    this.actionCache.clear();
  }

  // ===== 第二层：场景-解决方案映射 =====

  /**
   * 查找匹配的经验
   * @param {string} problem - 问题类型（如 "find_nearest_tree_failed"）
   * @param {object} context - 环境上下文 { biome, hasWood, inventory, nearbyBlocks, ... }
   * @returns {object|null} 匹配的经验条目
   */
  findSolution(problem, context = {}) {
    const biome = (context.biome || '').toLowerCase().replace(/\s+/g, '_');

    // 1. 精确匹配：同问题 + 同生物群系
    let match = this.experiences.find(e =>
      !e.deprecated &&
      e.condition.problem === problem &&
      (e.condition.biome || '').toLowerCase().replace(/\s+/g, '_') === biome
    );
    if (match && match.success_count > 0) {
      this.stats.experienceHits++;
      return match;
    }

    // 2. 泛化匹配：同问题 + 相似生物群系
    match = this.experiences.find(e =>
      !e.deprecated &&
      e.condition.problem === problem &&
      isSimilarBiome(e.condition.biome, biome)
    );
    if (match && match.success_rate >= 0.6) {
      this.stats.experienceHits++;
      return match;
    }

    // 3. 更泛化：相似问题 + 相似生物群系
    match = this.experiences.find(e =>
      !e.deprecated &&
      isSimilarProblem(e.condition.problem, problem) &&
      isSimilarBiome(e.condition.biome, biome)
    );
    if (match && match.success_rate >= 0.7) {
      this.stats.experienceHits++;
      return match;
    }

    // 4. 最泛化：相似问题（忽略生物群系）
    match = this.experiences.find(e =>
      !e.deprecated &&
      isSimilarProblem(e.condition.problem, problem) &&
      match.success_rate >= 0.8
    );
    if (match) {
      this.stats.experienceHits++;
      return match;
    }

    return null;
  }

  /**
   * 存储新经验（LLM 返回的解决方案）
   * @param {string} problem - 问题类型
   * @param {object} context - 环境上下文
   * @param {object} solution - LLM 返回的解决方案
   */
  async learn(problem, context, solution) {
    console.log(`[ExperienceDB] 💾 Learn: ${problem} → ${solution.strategy || '?'}`);
    const entry = {
      id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      condition: {
        problem,
        biome: (context.biome || '').toLowerCase().replace(/\s+/g, '_'),
        biomeGroup: getBiomeGroup(context.biome),
        hasWood: context.hasWood ?? null,
        hasStone: context.hasStone ?? null,
        hasIron: context.hasIron ?? null,
        isUnderground: context.isUnderground ?? null,
        timeOfDay: context.timeOfDay ?? null,
        nearbyBlocks: context.nearbyBlocks || [],
        inventory: context.inventory || '',
      },
      solution: {
        strategy: solution.strategy || '',
        diagnosis: solution.diagnosis || '',
        steps: solution.steps || [],
        fallback: solution.fallback || '',
        params: solution.params || {},
      },
      success_count: 1,
      fail_count: 0,
      total_uses: 1,
      success_rate: 1.0,
      created_at: Date.now(),
      last_used: Date.now(),
      source: 'llm',
      deprecated: false,
    };

    // 去重：如果已有几乎相同的经验，更新而不是新增
    const dup = this.experiences.find(e =>
      !e.deprecated &&
      e.condition.problem === problem &&
      e.condition.biome === entry.condition.biome &&
      e.solution.strategy === entry.solution.strategy
    );
    if (dup) {
      dup.success_count++;
      dup.total_uses++;
      dup.last_used = Date.now();
      dup.success_rate = dup.success_count / (dup.success_count + dup.fail_count);
      this._save();
      return dup;
    }

    this.experiences.push(entry);
    this.stats.totalSaved++;
    this._save();
    return entry;
  }

  /**
   * 更新经验的使用结果
   * @param {object} entry - 经验条目
   * @param {boolean} wasSuccessful - 是否成功
   */
  async updateResult(entry, wasSuccessful) {
    if (wasSuccessful) entry.success_count++;
    else entry.fail_count++;
    entry.total_uses = (entry.total_uses || 1) + 1;
    entry.success_rate = entry.success_count / (entry.success_count + entry.fail_count);
    entry.last_used = Date.now();

    console.log(`[ExperienceDB] 📊 ${entry.id}: ${wasSuccessful ? '✅' : '❌'} rate:${(entry.success_rate*100).toFixed(0)}% uses:${entry.total_uses}`);

    if (entry.success_rate < 0.3 && entry.total_uses > 5) {
      entry.deprecated = true;
      console.log(`[ExperienceDB] ⚠️ Deprecated: ${entry.id}`);
    }
    if (entry.deprecated && entry.success_rate >= 0.5) {
      entry.deprecated = false;
      console.log(`[ExperienceDB] ✅ Recovered: ${entry.id}`);
    }

    this._save();
  }

  /**
   * 泛化经验：为相似生物群系创建派生经验
   */
  async generalize(entry) {
    const sourceBiome = entry.condition.biome;
    const group = getBiomeGroup(sourceBiome);
    if (group === 'unknown' || group === 'other') return;

    const similarBiomes = BIOME_GROUPS[group] || [];
    let created = 0;

    for (const biome of similarBiomes) {
      if (biome === sourceBiome) continue;

      // 检查是否已有该生物群系的经验
      const exists = this.experiences.find(e =>
        !e.deprecated &&
        e.condition.problem === entry.condition.problem &&
        e.condition.biome === biome
      );
      if (exists) continue;

      // 创建派生经验（权重较低）
      const derived = {
        ...JSON.parse(JSON.stringify(entry)),
        id: `exp_derived_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        condition: { ...entry.condition, biome },
        success_count: 0,  // 派生经验初始成功次数为 0
        fail_count: 0,
        total_uses: 0,
        success_rate: 0.5,  // 初始信任度 50%
        source: 'generalized',
        derived_from: entry.id,
      };
      this.experiences.push(derived);
      created++;
    }

    if (created > 0) {
      console.log(`[ExperienceDB] 🌐 Generalized "${entry.condition.problem}" to ${created} similar biomes`);
      this._save();
    }
  }

  // ===== 查询与统计 =====

  /** 获取经验库摘要 */
  getSummary() {
    const total = this.experiences.length;
    const active = this.experiences.filter(e => !e.deprecated).length;
    const deprecated = total - active;
    const avgRate = active > 0
      ? (this.experiences.filter(e => !e.deprecated).reduce((s, e) => s + e.success_rate, 0) / active * 100).toFixed(0)
      : 0;

    return {
      total,
      active,
      deprecated,
      avgSuccessRate: `${avgRate}%`,
      cacheSize: this.actionCache.size,
      stats: { ...this.stats },
    };
  }

  /** 获取最近的经验列表 */
  getRecent(limit = 10) {
    return this.experiences
      .filter(e => !e.deprecated)
      .sort((a, b) => b.last_used - a.last_used)
      .slice(0, limit)
      .map(e => ({
        id: e.id,
        problem: e.condition.problem,
        biome: e.condition.biome,
        strategy: e.solution.strategy,
        success_rate: (e.success_rate * 100).toFixed(0) + '%',
        uses: e.total_uses,
      }));
  }

  /** 手动添加经验（用于调试） */
  addManual(problem, biome, strategy, steps) {
    const entry = {
      id: `exp_manual_${Date.now()}`,
      condition: {
        problem,
        biome: (biome || '').toLowerCase().replace(/\s+/g, '_'),
        biomeGroup: getBiomeGroup(biome),
      },
      solution: { strategy, steps: steps || [], diagnosis: '', fallback: '', params: {} },
      success_count: 1,
      fail_count: 0,
      total_uses: 1,
      success_rate: 1.0,
      created_at: Date.now(),
      last_used: Date.now(),
      source: 'manual',
      deprecated: false,
    };
    this.experiences.push(entry);
    this._save();
    return entry;
  }
}

module.exports = { ExperienceDB, isSimilarBiome, isSimilarProblem, getBiomeGroup, BIOME_GROUPS, PROBLEM_GROUPS };

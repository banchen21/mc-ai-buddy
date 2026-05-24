/**
 * 🔍 search 插件 — 搜索 Minecraft Wiki + 联网搜索
 * 先查本地缓存 → 再联网搜索 DuckDuckGo
 */
const https = require('https');
const logger = require('../core/logger');

let bot, deps;

// Minecraft Wiki 常用知识缓存
const KNOWLEDGE_CACHE = {
  // 工具等级
  'tool_tiers': `Minecraft 工具等级（从低到高）：
- 木镐(tier 1)：只能挖 stone, coal_ore, cobblestone, dirt, sand, gravel。挖不了 iron_ore 及以上
- 石镐(tier 2)：可挖 iron_ore, lapis_ore, copper_ore。挖不了 diamond_ore 及以上
- 铁镐(tier 3)：可挖 diamond_ore, gold_ore, redstone_ore, emerald_ore。挖不了 obsidian
- 钻石镐(tier 4)：可挖 obsidian, ancient_debris, crying_obsidian
- 下界合金镐(tier 5)：可挖所有方块，速度最快`,

  // 合成配方
  'crafting_recipes': `常用合成配方：
- 工作台(crafting_table)：4个橡木板(2x2)
- 木棍(stick)：2个橡木板(上下)
- 木镐(wooden_pickaxe)：3个橡木板 + 2个木棍
- 石镐(stone_pickaxe)：3个圆石 + 2个木棍
- 铁镐(iron_pickaxe)：3个铁锭 + 2个木棍
- 钻石镐(diamond_pickaxe)：3个钻石 + 2个木棍
- 石斧(stone_axe)：3个圆石 + 2个木棍
- 铁斧(iron_axe)：3个铁锭 + 2个木棍
- 熔炉(furnace)：8个圆石(围一圈)
- 铁剑(iron_sword)：2个铁锭 + 1个木棍
- 铁锭(iron_ingot)：烧炼 iron_ore 或 raw_iron
- 橡木板(oak_planks)：1个橡木原木 → 4个橡木板`,

  // 烧炼
  'smelting': `Minecraft 烧炼规则：
- 所有物品烧炼时间：200 ticks = 10秒
- 燃料燃烧时间：
  木板/planks：300 ticks(15秒) → 烧1.5个物品
  原木/log：800 ticks(40秒) → 烧4个物品
  煤炭/coal：1600 ticks(80秒) → 烧8个物品
  煤炭块/coal_block：2400 ticks(120秒) → 烧12个物品
  烈焰棒/blaze_rod：2000 ticks(100秒) → 烧10个物品
  熔岩桶/lava_bucket：20000 ticks(1000秒) → 烧100个物品
- 常见烧炼产物：iron_ore→iron_ingot, raw_iron→iron_ingot, sand→glass, cobblestone→stone, clay→brick`,

  // 方块挖掘
  'mining_levels': `Minecraft 挖掘等级要求：
- 石头/圆石/煤矿：木镐即可
- 铁矿/青金石矿/铜矿：需要石镐或以上
- 钻石矿/金矿/红石矿/绿宝石矿：需要铁镐或以上
- 黑曜石/远古残骸：需要钻石镐或以上
- 注意：deepslate 变体（如 deepslate_iron_ore）挖掘等级相同
- 木头/土/沙/沙砾：不需要工具，空手即可`,

  // 食物
  'food': `Minecraft 食物恢复饱食度：
- 熟牛肉(cooked_beef)：8点
- 熟猪排(cooked_porkchop)：8点
- 面包(bread)：5点
- 苹果(apple)：4点
- 生牛肉(beef)：3点
- 生猪排(porkchop)：3点
- 曲奇(cookie)：2点`,
};

module.exports = {
  name: 'search',
  version: '1.0.0',

  init(_bot, _deps) { bot = _bot; deps = _deps; },
  start() {},
  stop() {},

  /** OpenAI Tool Calls 定义 */
  tools: [
    {
      type: 'function',
      function: {
        name: 'search_wiki',
        description: '搜索 Minecraft 知识库：工具等级、合成配方、烧炼规则、挖掘等级、食物等',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词，如 tool_tiers, crafting_recipes, smelting, mining_levels, food, 或具体物品名如 iron_pickaxe' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
  ],

  actions: {
    /** 搜索 Minecraft 知识 */
    async search_wiki(params) {
      const query = (params.query || '').toLowerCase();

      // 1. 精确匹配缓存 key
      const exactKey = query.replace(/\s+/g, '_');
      if (KNOWLEDGE_CACHE[exactKey]) {
        console.log(`[Search] Cache hit: ${exactKey}`);
        return KNOWLEDGE_CACHE[exactKey];
      }

      // 2. 先尝试搜索具体物品（优先于模糊缓存匹配）
      const mcData = require('minecraft-data')(bot.version);
      const possibleItems = query.split(/[\s_]+/).filter(w => w.length > 2);
      let item = null;
      for (const word of possibleItems) {
        item = mcData.itemsByName[word]
          || Object.values(mcData.itemsByName).find(i => i.name === word);
        if (item) break;
      }
      if (!item) {
        item = mcData.itemsByName[query]
          || Object.values(mcData.itemsByName).find(i => i.name.includes(query));
      }

      if (item) {
        const recipes = bot.recipesAll(item.id, null, null);
        if (recipes?.length) {
          const info = [];
          for (const r of recipes.slice(0, 3)) {
            const ingredients = (r.delta || [])
              .filter(d => d.count < 0 && d.id > 0)
              .map(d => `${mcData.items[d.id]?.name || d.id}×${-d.count}`)
              .join(' + ');
            if (ingredients) info.push(`${item.name}: ${ingredients}`);
          }
          if (info.length) {
            const result = info.join(' | ');
            console.log(`[Search] Recipe: ${result}`);
            return result;
          }
        }
        const itemInfo = `物品: ${item.name} (id:${item.id}), 堆叠:${item.stackSize || 64}`;
        console.log(`[Search] Item: ${itemInfo}`);
        return itemInfo;
      }

      // 3. 模糊匹配缓存
      const keywords = query.split(/[\s_]+/).filter(kw => kw.length > 1);
      let bestMatch = null;
      let bestScore = 0;
      for (const [key, value] of Object.entries(KNOWLEDGE_CACHE)) {
        const keyMatches = keywords.filter(kw => key.includes(kw)).length;
        const valMatches = keywords.filter(kw => value.toLowerCase().includes(kw)).length;
        const score = keyMatches * 3 + valMatches;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = { key, value };
        }
      }
      if (bestMatch && bestScore >= 2) {
        console.log(`[Search] Fuzzy match: ${bestMatch.key}`);
        return bestMatch.value;
      }

      // 4. 本地缓存未命中 → 抓取 Minecraft Wiki
      console.log(`[Search] Fetching wiki: ${query}`);
      const result = await fetchWiki(query);
      if (result) {
        console.log(`[Search] Wiki result: ${result.substring(0, 100)}...`);
        return result;
      }

      console.log(`[Search] No result for: ${query}`);
      return null;
    },
  },
};

/**
 * 抓取 Minecraft Wiki 页面内容
 * 先搜索 → 取第一个结果 → 抓取页面提取文本
 */
function fetchWiki(query) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    // 用 DuckDuckGo 搜索 minecraft.wiki
    const searchUrl = `https://html.duckduckgo.com/html/?q=site:minecraft.wiki+${encoded}`;

    https.get(searchUrl, { timeout: 10000 }, (res) => {
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        // 提取搜索结果中的第一个 minecraft.wiki 链接
        const linkMatch = html.match(/https:\/\/minecraft\.wiki\/w\/[^"'\s]+/);
        if (!linkMatch) {
          // 回退：直接用 DuckDuckGo API
          fallbackDuckDuckGo(query, resolve);
          return;
        }

        const wikiUrl = linkMatch[0].replace(/&amp;/g, '&');
        console.log(`[Search] Fetching: ${wikiUrl}`);

        // 抓取 Wiki 页面
        https.get(wikiUrl, { timeout: 10000 }, (wikiRes) => {
          let wikiHtml = '';
          wikiRes.on('data', chunk => wikiHtml += chunk);
          wikiRes.on('end', () => {
            const text = extractWikiText(wikiHtml, query);
            resolve(text || null);
          });
        }).on('error', () => fallbackDuckDuckGo(query, resolve))
          .on('timeout', function() { this.destroy(); fallbackDuckDuckGo(query, resolve); });
      });
    }).on('error', () => fallbackDuckDuckGo(query, resolve))
      .on('timeout', function() { this.destroy(); fallbackDuckDuckGo(query, resolve); });
  });
}

/**
 * 从 Minecraft Wiki HTML 中提取有用文本
 */
function extractWikiText(html, query) {
  // 移除 script/style 标签
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  // 提取 body 内容
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) text = bodyMatch[1];

  // 移除所有 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ');

  // 解码 HTML 实体
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));

  // 清理空白
  text = text.replace(/\s+/g, ' ').trim();

  // 提取与查询相关的段落（包含关键词的句子周围 200 字符）
  const keywords = query.toLowerCase().split(/[\s_]+/).filter(k => k.length > 1);
  const sentences = text.split(/[.!?]+/);
  const relevant = sentences.filter(s => {
    const lower = s.toLowerCase();
    return keywords.some(kw => lower.includes(kw));
  });

  if (relevant.length > 0) {
    return relevant.slice(0, 5).map(s => s.trim()).join('. ').substring(0, 600);
  }

  // 没有相关句子 → 返回开头部分
  return text.substring(0, 500);
}

/** DuckDuckGo API 回退 */
function fallbackDuckDuckGo(query, resolve) {
  const encoded = encodeURIComponent(`minecraft ${query}`);
  const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;

  https.get(url, { timeout: 8000 }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const results = [];
        if (json.AbstractText?.length > 20) results.push(json.AbstractText);
        if (json.RelatedTopics) {
          for (const t of json.RelatedTopics.slice(0, 3)) {
            if (t.Text?.length > 20) results.push(t.Text);
          }
        }
        if (json.Answer) results.push(json.Answer);
        resolve(results.length > 0 ? results.join(' | ').substring(0, 500) : null);
      } catch (e) { logger.error('search/parseDuckDuckGo', e); resolve(null); }
    });
  }).on('error', () => resolve(null))
    .on('timeout', function() { this.destroy(); resolve(null); });
}

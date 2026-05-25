# MC AI Buddy

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/Minecraft-1.20.1-blue" alt="Minecraft 1.20.1">
  <img src="https://img.shields.io/badge/LLM-DeepSeek-purple" alt="DeepSeek">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
  <a href="https://73info.cn"><img src="https://img.shields.io/badge/Platform-73Info_柒叁信息-1a237e?style=flat" alt="73Info"></a>
</p>

<p align="center">
  <strong>基于 Mineflayer + DeepSeek 大语言模型的 AI Minecraft 伙伴</strong>
</p>

<p align="center">
  <a href="README_en.md">English</a>
</p>

---

## 简介

MC AI Buddy 是一个 Minecraft 智能机器人，通过大语言模型驱动，能够在游戏中自主探索、战斗、合成、与玩家自然对话，并做出智能决策。

## 特性

- **LLM 驱动** — 使用 DeepSeek API 进行自然语言理解和决策
- **自主模式** — 机器人可独立探索、采集资源、生存
- **工具系统** — LLM 可调用 30+ 工具查询状态、移动、交互、合成等
- **被动模块** — 自动战斗响应、饥饿进食、昼夜感知
- **视线检测** — 基于射线检测的实体和方块可见性（不会透视穿墙）
- **持久记忆** — 日志（事件记录）和记忆（LLM 知识库）按服务器分别存储
- **聊天交互** — 自然响应游戏内聊天消息
- **自动重连** — 优雅处理断线和重复登录

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- Minecraft Java 版服务器（推荐 1.20.1）
- [DeepSeek API 密钥](https://platform.deepseek.com/)

### 安装

```bash
git clone https://github.com/banchen21/mc-ai-buddy.git
cd mc-ai-buddy
npm install
```

### 配置

```bash
cp config.example.json config.json
```

编辑 `config.json`：

```json
{
  "bot": {
    "username": "Copilot",
    "host": "localhost",
    "port": 25565,
    "version": "1.20.1"
  },
  "deepseek": {
    "apiKey": "sk-your-api-key-here",
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "maxTokens": 300,
    "temperature": 0.7
  },
  "autoDecision": {
    "enabled": true,
    "combat": true,
    "survival": true,
    "awareness": true
  }
}
```

### 运行

```bash
npm start
```

## 项目结构

```
mc-ai-buddy/
├── index.js                          # 入口文件，bot 初始化与事件路由
├── config.json                       # Bot 与 LLM 配置
├── config.example.json               # 配置示例
├── persona.md                        # Bot 人格设定
├── memory/                           # 持久化数据（按服务器区分）
│   ├── <host>_<port>.json            # 日志（事件、统计、对话历史）
│   └── <host>_<port>_memory.json     # LLM 知识存储
└── src/
    ├── core/
    │   ├── agent.js                  # 工具注册、系统提示、任务编排
    │   ├── llm.js                    # DeepSeek API 客户端封装
    │   ├── logger.js                 # 事件日志记录
    │   └── task-orchestrator.js      # 多轮工具调用执行循环
    └── tool_modules/
        ├── action/
        │   ├── action.js             # 指令处理（委托给 Agent）
        │   ├── move.js               # 移动：前往、跟随、探索、看向、睡觉等
        │   ├── interact.js           # 交互：挖掘、放置、攻击、使用、装备、丢弃等
        │   └── craft.js              # 合成：合成、烧炼、配方查询
        ├── chat/
        │   ├── message.js            # 聊天消息路由与过滤
        │   ├── journal.js            # 事件日志（事实、统计、位置）
        │   └── memory.js             # LLM 可调用的键值记忆（记住/回忆/遗忘）
        ├── query/
        │   ├── query.js              # 状态查询（背包、血量、实体、方块等）
        │   └── doc.md                # 工具 API 文档
        └── passive/
            ├── passive.js            # 被动模块编排器
            ├── combat.js             # 自动战斗、逃跑、苦力怕闪避
            ├── survival.js           # 饥饿时自动进食
            └── awareness.js          # 昼夜提醒、贵重物品掉落提醒
```

## 工具列表

### 查询工具

| 工具 | 说明 |
|------|------|
| `get_inventory` | 列出背包中所有物品 |
| `get_armor` | 显示装备护甲（耐久、附魔、护甲值） |
| `get_held_item` | 显示手持物品（耐久、附魔、攻击属性） |
| `get_offhand` | 显示副手物品（含完整属性） |
| `get_health` | 血量和饱食度 |
| `get_position` | 当前坐标 |
| `get_nearby_entities` | 视线检测前方实体（不会透视） |
| `get_block` | 查询指定坐标的方块类型 |
| `get_surrounding_blocks` | 射线扫描周围可见方块 |
| `get_time` | 游戏时间和天气 |
| `get_chest` | 视线检测箱子内容物 |
| `get_furnace` | 视线检测熔炉烧炼状态 |
| `get_container` | 视线检测容器内容（木桶、漏斗等） |
| `look_at_block` | 看向坐标或玩家 |
| `search_web` | 联网搜索 Minecraft 知识 |

### 动作工具

| 工具 | 说明 |
|------|------|
| `goto` | 寻路到指定坐标 |
| `follow` | 跟随玩家 |
| `goto_player` | 走到玩家身边 |
| `wander` | 随机探索 |
| `stop` | 停止所有移动 |
| `look_at` | 看向坐标或玩家 |
| `jump` | 跳跃一次 |
| `find_block` | 寻找并前往指定方块 |
| `sleep` | 在附近的床上睡觉 |
| `dig` | 挖掘方块 |
| `place` | 放置方块 |
| `attack` | 攻击实体 |
| `use` | 使用/右键方块 |
| `equip` | 装备物品 |
| `drop` | 丢弃物品 |
| `toss` | 投掷物品给玩家 |
| `craft` | 合成物品 |
| `smelt` | 在熔炉中烧炼 |
| `get_recipe` | 查询合成配方 |

### 记忆工具

| 工具 | 说明 |
|------|------|
| `remember` | 存储键值记忆 |
| `recall` | 查询已存储的记忆 |
| `forget` | 删除一条记忆 |

## 配置

### `bot`

| 键 | 类型 | 默认值 | 说明 |
|------|------|------|------|
| `username` | `string` | `"Copilot"` | Bot 显示名称 |
| `host` | `string` | `"localhost"` | 服务器地址 |
| `port` | `number` | `25565` | 服务器端口 |
| `version` | `string` | `"1.20.1"` | Minecraft 版本 |

### `deepseek`

| 键 | 类型 | 默认值 | 说明 |
|------|------|------|------|
| `apiKey` | `string` | — | DeepSeek API 密钥 |
| `baseUrl` | `string` | `"https://api.deepseek.com/v1"` | API 地址 |
| `model` | `string` | `"deepseek-chat"` | 模型名称 |
| `maxTokens` | `number` | `300` | 最大回复 token 数 |
| `temperature` | `number` | `0.7` | 回复随机性 |
| `maxHistory` | `number` | `16` | 保留的最大对话轮数 |

### `autoDecision`

| 键 | 类型 | 默认值 | 说明 |
|------|------|------|------|
| `enabled` | `boolean` | `true` | 启用自主模式 |
| `combat` | `boolean` | `true` | 自动战斗响应 |
| `survival` | `boolean` | `true` | 饥饿时自动进食 |
| `awareness` | `boolean` | `true` | 昼夜与掉落提醒 |

### `reconnect`

| 键 | 类型 | 默认值 | 说明 |
|------|------|------|------|
| `maxAttempts` | `number` | `5` | 最大重连次数 |
| `duplicateLoginDelay` | `number` | `30000` | 重复登录后延迟（毫秒） |
| `normalDelay` | `number` | `5000` | 普通重连延迟（毫秒） |

## 自定义人格

编辑 `persona.md` 可修改 bot 的性格、语言风格和行为准则。该文件内容会被注入到 LLM 的系统提示中。

## 许可证

[MIT](LICENSE)

---

<div align="center">

🌐 **[73Info 柒叁信息](https://73info.cn)** — 开发者资源发现 · 需求对接 · 定制协作平台

*需要 AI 开发？来 73Info 找到靠谱的开发者。*

</div>

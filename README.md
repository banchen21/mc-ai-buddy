# MC AI Buddy

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/Minecraft-1.20.1-blue" alt="Minecraft 1.20.1">
  <img src="https://img.shields.io/badge/LLM-OpenAI_Compatible-purple" alt="OpenAI Compatible">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
</p>

<p align="center">
  <strong>基于 Mineflayer + 大语言模型的 AI Minecraft 伙伴</strong>
</p>

<p align="center">
  <a href="README_en.md">English</a>
</p>

---

## 简介

MC AI Buddy 是一个 Minecraft 智能机器人，通过大语言模型驱动，能够在游戏中自主探索、战斗、合成、与玩家自然对话，并做出智能决策。

## 特性

- **LLM 驱动** — 兼容 OpenAI API，支持 DeepSeek、Claude、MiMo 等模型
- **自主模式** — 机器人空闲时自动决策下一步行动，独立探索、采集、生存
- **工具系统** — LLM 可调用 30+ 工具：查询状态、A* 寻路、交互操作、合成熔炼、记忆读写
- **被动模块** — 自动战斗响应（受伤反击/逃跑/苦力怕闪避）、饥饿自动进食、昼夜感知提醒
- **语音交互** — TTS 语音合成 + STT 语音识别，通过 Simple Voice Chat 模组在游戏中语音对话
- **视线检测** — 基于射线检测的实体和方块可见性（不会透视穿墙）
- **持久记忆** — 日志（事件记录）和记忆（LLM 知识库）按服务器分别存储
- **优先级抢占** — 文字 > 语音 > 自主决策，玩家交互优先打断自动任务
- **自动重连** — 优雅处理断线和重复登录，可配置重试次数和间隔

## 架构

```
index.js                     # 入口：Bot 创建、模块初始化、事件路由
├── src/core/
│   ├── agent.js             # Agent：工具注册、系统提示构建、对话管理
│   ├── llm.js               # LLM：OpenAI 兼容 API 封装、历史管理
│   ├── task-orchestrator.js # 编排器：LLM 决策 → 工具执行 → 结果反馈循环
│   └── logger.js            # 日志：控制台 + activity.jsonl 记录
├── src/tool_modules/
│   ├── query/query.js       # 查询工具：背包、血量、坐标、周围方块/实体等
│   ├── action/
│   │   ├── action.js        # 行为入口：委托 Agent 处理指令
│   │   ├── move.js          # 移动工具：goto、follow、wander、find_block 等
│   │   ├── interact.js      # 交互工具：dig、place、attack、give、equip 等
│   │   └── craft.js         # 合成工具：craft、search_recipe、smelt
│   ├── chat/
│   │   ├── message.js       # 消息模块：聊天收发、中间件链
│   │   ├── journal.js       # 日志记忆：事件记录、统计、对话历史持久化
│   │   ├── memory.js        # 知识记忆：LLM 主动读写的关键信息
│   │   ├── voice.js         # 语音合成：TTS → Simple Voice Chat 播放
│   │   └── stt.js           # 语音识别：PCM 采集 → WAV → STT 转文字
│   └── passive/
│       ├── passive.js       # 被动模块入口：事件驱动，不经过 LLM
│       ├── combat.js        # 战斗响应：受伤反击、逃跑、苦力怕闪避
│       ├── survival.js      # 生存响应：饥饿自动进食
│       └── awareness.js     # 环境感知：昼夜提醒、贵重物品掉落通知
└── memory/                  # 持久化数据（按服务器存储）
```

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- Minecraft Java 版服务器（推荐 1.20.1）
- 兼容 OpenAI API 的 LLM 服务（DeepSeek / Claude / MiMo 等）

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

编辑 `config.json`（参考 [config.example.json](config.example.json)）：

```json
{
  "bot": {
    "username": "Copilot",
    "host": "localhost",
    "port": 25565,
    "version": "1.20.1"
  },
  "llm": {
    "apiKey": "你的 API Key",
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "maxTokens": 1024,
    "temperature": 0.7,
    "maxHistory": 16,
    "maxRounds": 50
  },
  "autoDecision": {
    "enabled": true,
    "passive": true,
    "combat": true,
    "survival": true,
    "awareness": true
  },
  "voice": {
    "enabled": false,
    "apiKey": "TTS API Key",
    "baseUrl": "https://api.example.com/v1",
    "model": "tts-model",
    "voice": "default",
    "minLength": 4,
    "stt": {
      "enabled": false,
      "silenceMs": 1200,
      "minBytes": 19200
    }
  }
}
```

### 运行

```bash
npm start
```

## 配置说明

### bot — 机器人连接

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `username` | string | `Copilot` | 机器人游戏名 |
| `host` | string | `localhost` | 服务器地址 |
| `port` | number | `25565` | 服务器端口 |
| `version` | string | `1.20.1` | Minecraft 版本 |

### llm — 大语言模型

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiKey` | string | — | API 密钥 |
| `baseUrl` | string | — | API 地址（OpenAI 兼容） |
| `model` | string | `deepseek-chat` | 模型名称 |
| `maxTokens` | number | `1024` | 最大输出 token |
| `temperature` | number | `0.7` | 生成温度 (0-2) |
| `maxHistory` | number | `16` | 最大对话历史轮数 |
| `maxRounds` | number | `50` | 单次任务最大工具调用轮数 |

### autoDecision — 自主决策

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用自主决策 |
| `passive` | boolean | `true` | 是否启用被动模块 |
| `combat` | boolean | `true` | 是否启用战斗响应 |
| `survival` | boolean | `true` | 是否启用生存响应 |
| `awareness` | boolean | `true` | 是否启用环境感知 |

### voice — 语音（可选）

需要服务端安装 [Simple Voice Chat](https://modrinth.com/plugin/simple-voice-chat) 模组。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 是否启用语音 |
| `apiKey` | string | — | TTS API 密钥 |
| `baseUrl` | string | — | TTS API 地址 |
| `model` | string | — | TTS 模型 |
| `voice` | string | — | 音色 |
| `minLength` | number | `4` | 最小合成文本长度 |
| `stt.enabled` | boolean | `false` | 是否启用语音识别 |
| `stt.silenceMs` | number | `1200` | 静音检测间隔 (ms) |

## 工具列表

### 🔍 查询工具
`get_inventory` `get_armor` `get_held_item` `get_offhand` `get_health` `get_position` `get_nearby_entities` `get_block` `get_surrounding_blocks` `look_at_block` `get_time` `get_chest` `get_furnace` `get_container` `search_web`

### 🚶 移动工具
`goto` `follow` `goto_player` `wander` `stop` `look_at` `jump` `find_block` `sleep`

### ⛏️ 交互工具
`dig` `place` `pillar_up` `attack` `give` `equip` `drop` `collect` `use_item` `activate_block` `take_from_chest` `put_to_chest` `take_from_furnace` `send_chat`

### 🔧 合成工具
`craft` `search_recipe` `smelt`

### 🧠 记忆工具
`remember` `recall` `forget`

## 人格定制

编辑 `persona.md` 可自定义机器人的性格、语言风格和行为准则。

## 许可证

MIT License
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

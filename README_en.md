# MC AI Buddy

AI Minecraft companion powered by [Mineflayer](https://github.com/PrismarineJS/mineflayer) + [DeepSeek](https://deepseek.com/) LLM.

A Minecraft bot that can autonomously explore, fight, craft, chat with players, and make intelligent decisions — all driven by a large language model.

## Features

- **LLM-Powered Agent** — Uses DeepSeek API for natural language understanding and decision making
- **Autonomous Mode** — Bot can independently explore, gather resources, and survive
- **Tool System** — LLM can call tools to query state, move, interact, craft, and more
- **Passive Modules** — Automatic combat response, hunger management, day/night awareness
- **Line-of-Sight Detection** — Ray-cast based entity and block visibility (no wallhacks)
- **Persistent Memory** — Journal (event log) and Memory (LLM knowledge store) saved per server
- **Chat Integration** — Responds to in-game chat messages naturally
- **Auto Reconnect** — Handles disconnects and duplicate login gracefully

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- A Minecraft Java Edition server (1.20.1 recommended)
- A [DeepSeek API key](https://platform.deepseek.com/)

### Installation

```bash
git clone https://github.com/banchen21/mc-ai-buddy.git
cd mc-ai-buddy
npm install
```

### Configuration

Copy the example config and edit it:

```bash
cp config.example.json config.json
```

Edit `config.json`:

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

### Run

```bash
npm start
```

## Project Structure

```
mc-ai-buddy/
├── index.js                          # Entry point, bot setup, event routing
├── config.json                       # Bot & LLM configuration
├── persona.md                        # Bot personality prompt
├── memory/                           # Persistent data (per server)
│   ├── <host>_<port>.json            # Journal (events, stats, chat history)
│   └── <host>_<port>_memory.json     # LLM knowledge store
└── src/
    ├── core/
    │   ├── agent.js                  # Tool registry, system prompt, orchestration
    │   ├── llm.js                    # DeepSeek API client wrapper
    │   ├── logger.js                 # Event logging
    │   └── task-orchestrator.js      # Multi-round tool execution loop
    └── tool_modules/
        ├── action/
        │   ├── action.js             # Command handler (delegates to Agent)
        │   ├── move.js               # goto, follow, wander, look_at, sleep, etc.
        │   ├── interact.js           # dig, place, attack, use, equip, drop, etc.
        │   └── craft.js              # craft, smelt, recipe lookup
        ├── chat/
        │   ├── message.js            # Chat message routing & filtering
        │   ├── journal.js            # Event journal (facts, stats, locations)
        │   └── memory.js             # LLM-callable key-value memory (remember/recall/forget)
        ├── query/
        │   ├── query.js              # State queries (inventory, health, entities, blocks, etc.)
        │   └── doc.md                # Tool API documentation
        └── passive/
            ├── passive.js            # Passive module orchestrator
            ├── combat.js             # Auto-combat, dodge, creeper avoidance
            ├── survival.js           # Auto-eat when hungry
            └── awareness.js          # Day/night alerts, valuable item drops
```

## Tools Available to LLM

### Query Tools
| Tool | Description |
|---|---|
| `get_inventory` | List all items in inventory |
| `get_armor` | Show equipped armor with durability, enchants, armor value |
| `get_held_item` | Show held item with durability, enchants, attack stats |
| `get_offhand` | Show offhand item with full attributes |
| `get_health` | HP and food level |
| `get_position` | Current coordinates |
| `get_nearby_entities` | Line-of-sight entity detection (no wallhacks) |
| `get_block` | Query block type at specific coordinates |
| `get_surrounding_blocks` | Ray-cast visible block scan |
| `get_time` | Game time and weather |
| `get_chest` | Line-of-sight chest contents |
| `get_furnace` | Line-of-sight furnace status |
| `get_container` | Line-of-sight container contents (barrel, hopper, etc.) |
| `look_at_block` | Look at coordinates or player |
| `search_web` | Web search for Minecraft knowledge |

### Action Tools
| Tool | Description |
|---|---|
| `goto` | Pathfind to coordinates |
| `follow` | Follow a player |
| `goto_player` | Go to a player |
| `wander` | Random exploration |
| `stop` | Stop all movement |
| `look_at` | Look at coordinates or player |
| `jump` | Jump once |
| `find_block` | Find and go to a specific block type |
| `sleep` | Sleep in nearest bed |
| `dig` | Break a block |
| `place` | Place a block |
| `attack` | Attack an entity |
| `use` | Use/right-click a block |
| `equip` | Equip an item |
| `drop` | Drop items |
| `toss` | Toss items to a player |
| `craft` | Craft items |
| `smelt` | Smelt items in furnace |
| `get_recipe` | Look up crafting recipes |

### Memory Tools
| Tool | Description |
|---|---|
| `remember` | Store a key-value memory |
| `recall` | Query stored memories |
| `forget` | Delete a memory |

## Configuration Reference

### `bot`
| Key | Type | Default | Description |
|---|---|---|---|
| `username` | string | `"Copilot"` | Bot display name |
| `host` | string | `"localhost"` | Server address |
| `port` | number | `25565` | Server port |
| `version` | string | `"1.20.1"` | Minecraft version |

### `deepseek`
| Key | Type | Default | Description |
|---|---|---|---|
| `apiKey` | string | — | DeepSeek API key |
| `baseUrl` | string | `"https://api.deepseek.com/v1"` | API endpoint |
| `model` | string | `"deepseek-chat"` | Model name |
| `maxTokens` | number | `300` | Max response tokens |
| `temperature` | number | `0.7` | Response randomness |
| `maxHistory` | number | `16` | Max conversation turns kept |

### `autoDecision`
| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Enable autonomous mode |
| `combat` | boolean | `true` | Auto-combat responses |
| `survival` | boolean | `true` | Auto-eat when hungry |
| `awareness` | boolean | `true` | Day/night & drop alerts |

### `reconnect`
| Key | Type | Default | Description |
|---|---|---|---|
| `maxAttempts` | number | `5` | Max reconnect attempts |
| `duplicateLoginDelay` | number | `30000` | Delay after duplicate login (ms) |
| `normalDelay` | number | `5000` | Normal reconnect delay (ms) |

## Customizing Personality

Edit `persona.md` to change the bot's personality, language style, and behavior rules. The content is injected into the LLM system prompt.

## License

[MIT](LICENSE)

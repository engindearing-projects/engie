# CozyTerm

Your AI project manager in the terminal, powered by **Engie**. Runs natively on macOS with [OpenClaw](https://github.com/open-claw/open-claw) + Bun. Tracks projects across Jira and GitHub, sends daily briefs via Telegram, learns from every conversation, and handles coding tasks through a smart router that picks the right brain for the job.

**Works with your Claude subscription** — heavy coding tasks route through the Claude Code CLI using your existing Pro/Max plan. No separate API credits needed for the expensive stuff. Simple tasks run locally on Ollama for free.

<p align="center">
  <img src="docs/tui.png" alt="CozyTerm TUI" width="700">
</p>

<p align="center">
  <img src="docs/web-chat.png" alt="CozyTerm Web Chat" width="350">
  <img src="docs/web-memory.png" alt="CozyTerm Memory Browser" width="350">
</p>

---

## Quick Start

```bash
# 1. Install Bun
brew install oven-sh/bun/bun

# 2. Install the CLI
cd cli && bun install && bun link

# 3. Install the MCP bridge deps
cd ../mcp-bridge && npm install

# 4. Run the setup wizard
cozy init
```

The setup wizard handles everything: installing OpenClaw, configuring the gateway, generating configs, setting up launchd services, and verifying connectivity.

**Migrating from engie?** Run `./scripts/migrate-to-cozyterm.sh` to move your config from `~/.engie` to `~/.cozyterm`.

---

## Usage

### Interactive TUI

```bash
cozy
```

Opens the Ink-based terminal UI with:
- Breathing iris pulse indicator (alive = gateway connected)
- Context-aware banner showing today's observations and active tickets
- Toggleable task panel (Shift+Tab) — shows active tool calls, todos, and recent observations
- Rotating tips for commands and recent activity
- Markdown-rendered assistant responses (from Engie)
- Service health status bar

### Coaching Mode

```bash
cozy --coach
```

Starts with coaching mode enabled. Engie gives warmer, more patient explanations with analogies and plain language. Suggestions appear as clickable chips after each response.

Toggle coaching in the TUI with `/coach`. Get friendly explanations with `/explain git rebase`. Request next-step suggestions with `/suggest`.

### One-Shot Queries

```bash
cozy "what's the status of PROJ-42?"
cozy "summarize yesterday's blockers"
cozy "what did I work on this week?"
```

Runs the query, prints the response, and exits. Observations are captured automatically.

### Service Management

```bash
cozy status          # service health table
cozy doctor          # run diagnostics
cozy doctor --fix    # auto-repair common issues
cozy start           # start all launchd services
cozy stop            # stop all services
```

### Memory & Observations

```bash
# Save an observation from the command line
cozy observe task_update "Finished API integration" --project myapp --tag PROJ-42

# Search memory in the TUI
/memory PROJ-42
/memory blockers

# Save a quick note in the TUI
/observe need to follow up on IAM permissions

# Manage todos (visible in shift+tab task panel)
/todo add fix auth timeout on /login
/todo                              # list all todos
/todo done obs_a1b2c3d4            # mark done (removes it)
```

### TUI Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/memory [query]` | Search memory (no query = show recent) |
| `/observe <text>` | Save an observation to memory |
| `/todo [add\|done]` | Manage todo items (visible in task panel) |
| `/status` | Inline service health check |
| `/session` | Show current session key |
| `/clear` | Clear message history |
| `/coach` | Toggle coaching mode |
| `/explain [concept]` | Get a friendly explanation |
| `/suggest` | Get contextual next-step suggestions |
| `/quit` | Exit (also `/exit`, `/q`) |

---

## Architecture

```
+-------------------------------------------------------------+
|                        macOS (always-on)                     |
|                                                              |
|  +----------+  +----------+  +----------+  +----------+     |
|  | OpenClaw |  |  Claude  |  |  Ollama  |  | Activity |     |
|  | Gateway  |  |  Proxy   |  | (Metal)  |  |  Sync    |     |
|  | :18789   |  | :18791   |  | :11434   |  | :18790   |     |
|  +----+-----+  +----+-----+  +----+-----+  +----+-----+     |
|       |              |             |              |           |
|       |   Smart Router (complexity scoring)       |           |
|       |   +----------------------------+          |           |
|       |   |  score >= 0.6 -> Claude    |          |           |
|       |   |  score <  0.6 -> Ollama    |          |           |
|       |   +----------------------------+          |           |
|       |                                           |           |
|  +----+-------------------------------------------+           |
|  |                                                            |
|  |  +---------+  +----------+  +----------+  +---------+    |
|  |  |  CLI    |  | Telegram |  |  Mobile  |  |   Web   |    |
|  |  |  TUI    |  |   Bot    |  |   App    |  |   App   |    |
|  |  +---------+  +----------+  +----------+  +---------+    |
|                                                              |
|  +--------------------------------------------------------+  |
|  |  Memory System (SQLite + FTS5)                         |  |
|  |  Auto-captures decisions, blockers, tickets, prefs     |  |
|  |  Cross-platform activity sync + read cursors           |  |
|  |  ~/.cozyterm/memory/cozyterm.db                        |  |
|  +--------------------------------------------------------+  |
+--------------------------------------------------------------+
```

### Services

All services are managed by launchd and auto-start on boot:

| Service | Port | launchd Label | Purpose |
|---------|------|---------------|---------|
| OpenClaw Gateway | 18789 | `com.cozyterm.gateway` | Agent framework, WebSocket API |
| Claude Code Proxy | 18791 | `com.cozyterm.claude-proxy` | Wraps `claude` CLI for heavy tasks (uses subscription, not API) |
| Activity Sync | 18790 | `com.cozyterm.activity-sync` | Cross-platform activity ledger + read cursors |
| Ollama | 11434 | `homebrew.mxcl.ollama` | Local LLM (llama3.2 3B, llama3.1 8B), Apple Silicon Metal GPU |

### Smart Router

The router scores each message for complexity (0.0-1.0) and picks the backend:

- **Claude Code** (score >= 0.6): refactoring, multi-file edits, code generation, debugging, architecture — uses your **Claude subscription**, not API credits
- **Ollama** (score < 0.6): status checks, summaries, simple questions, standups — runs **locally for free** on Apple Silicon Metal GPU

Scoring factors: keyword patterns, message length, presence of code blocks, explicit hints.

> **Cost breakdown**: If you have a Claude Pro ($20/mo) or Max ($100-200/mo) subscription, all heavy coding tasks are included at no extra cost. Ollama handles the lightweight stuff with zero API spend. The only API key needed is for the OpenClaw agent framework (ANTHROPIC_API_KEY), which handles orchestration and tool use at minimal token cost.

---

## Memory System

Engie learns from every interaction via a SQLite + FTS5 memory database.

### How It Works

```
User message + Assistant response
        |
        v
+----------------------+
|  extract-observations | <- pattern matching
|                      |
|  * Jira tickets      |   PROJ-42, OPS-18, FEAT-7
|  * Decisions         |   "let's go with", "decided to"
|  * Blockers          |   "blocked by", "waiting on"
|  * Preferences       |   "always use", "prefer"
|  * Task completions  |   "merged", "deployed", "done with"
|  * Chat exchanges    |   every non-trivial message
+----------+-----------+
           v
     ~/.cozyterm/memory/cozyterm.db
           |
           v
  +----------------+
  |  TUI Banner    |  "3 observations today - active: PROJ-42"
  |  /memory       |  full-text search across all observations
  |  Cron context  |  morning brief pulls recent memory
  |  Chat context  |  auto-injected into messages
  +----------------+
```

### Observation Types

| Type | Trigger | Example |
|------|---------|---------|
| `task_update` | "merged", "deployed", "done with" | Finished API integration |
| `decision` | "let's", "going with", "decided to" | Going with JWT over session cookies |
| `blocker` | "blocked by", "waiting on" | Blocked by IAM permission request |
| `preference` | "always use", "prefer" | Prefer Bun over Node for new scripts |
| `insight` | Manual or cron-detected | Reports DB is a separate cluster |
| `chat_exchange` | Every non-trivial exchange | Baseline record of the conversation |

### Querying Memory

```bash
# From the TUI
/memory PROJ-42                   # full-text search
/memory                           # show 10 most recent

# From the CLI
cozy observe insight "The replication cron runs at 2 AM UTC" --project infra

# Programmatic (Bun)
bun -e "
  const { search, getStats } = await import('./cli/lib/memory-db.js');
  console.log(search('blocker'));
  console.log(getStats());
"
```

---

## Cron Jobs

Two automated jobs run on weekdays via the OpenClaw scheduler:

### Morning Brief — 8:00 AM PT

Checks configured Jira boards, GitHub activity, and memory for continuity. Delivers a formatted brief to Telegram.

### Afternoon Follow-up — 2:00 PM PT

Checks for Jira updates since morning, continues any pending handoff work, and stores status changes as observations.

---

## MCP Bridge

The MCP bridge (`mcp-bridge/index.mjs`) exposes Engie's capabilities as MCP tools for use by other AI agents (including Claude Code itself):

| Tool | Description |
|------|-------------|
| `engie_chat` | Send a message and get a response |
| `engie_observe` | Store a structured observation in memory |
| `engie_claude` | Route a task to Claude Code (heavy brain) |
| `engie_route` | Check which backend should handle a task |
| `engie_status` | Gateway health check |
| `engie_system_status` | Full system health (gateway + proxy + Ollama) |
| `engie_history` | Retrieve conversation history |
| `engie_sessions` | List or reset sessions |
| `engie_config` | Read gateway configuration |
| `engie_raw` | Call any gateway method directly |

### External MCP Integrations

Engie connects to external services via MCP servers configured in the gateway:

- **Jira** — ticket tracking, sprint management, board queries
- **Slack** — channel messaging, thread replies, canvas automation
- **Figma** — design screenshots, metadata, code connect

---

## Project Structure

```
cozyterm/
├── cli/                            # CLI + TUI (Bun runtime)
│   ├── bin/cozy.mjs                # Entry point, subcommand router
│   ├── commands/                   # Subcommands
│   │   ├── chat.mjs                #   Interactive + one-shot chat
│   │   ├── init.mjs                #   Setup wizard
│   │   ├── status.mjs              #   Service health table
│   │   ├── doctor.mjs              #   Diagnostics + auto-repair
│   │   ├── start.mjs               #   Start launchd services
│   │   ├── stop.mjs                #   Stop launchd services
│   │   └── observe.mjs             #   Write observation from CLI
│   ├── lib/                        # Core modules
│   │   ├── paths.js                #   All path resolution (single source)
│   │   ├── services.js             #   launchd service management
│   │   ├── memory-db.js            #   SQLite + FTS5 memory system
│   │   ├── memory-context.js       #   Auto-inject context into messages
│   │   ├── extract-observations.js #   Pattern-based observation extraction
│   │   ├── profile.js              #   User profile + context builder
│   │   ├── config-gen.js           #   Config file generation
│   │   ├── prereqs.js              #   Prerequisite checks
│   │   └── log-rotation.js         #   Log file management
│   ├── src/
│   │   └── gateway.mjs             # WebSocket client for OpenClaw
│   └── tui/                        # Ink TUI
│       ├── App.js                  #   Root component
│       ├── lib/theme.js            #   Colors, version, branding
│       ├── components/             #   UI components
│       │   ├── Banner.js           #     Iris pulse + context + tips
│       │   ├── TaskPanel.js       #     Shift+Tab task/todo/observation panel
│       │   ├── StatusBar.js        #     Service health indicators
│       │   ├── InputPrompt.js      #     Message input
│       │   ├── MessageHistory.js   #     Scrollable message list
│       │   ├── AssistantMessage.js  #     Markdown-rendered response
│       │   ├── StreamingMessage.js  #     Live streaming text
│       │   ├── SuggestionChips.js  #     Coaching suggestion chips
│       │   ├── UserMessage.js      #     User message bubble
│       │   ├── SystemMessage.js    #     System/slash command output
│       │   ├── ErrorBanner.js      #     Error display
│       │   └── WelcomeScreen.js    #     First-run welcome
│       └── hooks/                  #   React hooks
│           ├── useGateway.js       #     WebSocket <-> React state bridge
│           ├── useSlashCommands.js  #     /command handler
│           ├── useServiceHealth.js  #     Health polling
│           ├── useInputHistory.js   #     Arrow-key input history
│           └── useMemory.js        #     Memory DB access
├── mcp-bridge/                     # MCP server (Node runtime)
│   ├── index.mjs                   #   Tool definitions + gateway client
│   └── lib/
│       └── observe.mjs             #   Bun subprocess for DB writes
├── scripts/                        # Service management
│   ├── start-gateway.sh            #   Gateway launcher (sources .env)
│   ├── claude-code-proxy.mjs       #   HTTP proxy -> claude CLI
│   ├── activity-server.mjs         #   Cross-platform activity sync server
│   ├── router.mjs                  #   Complexity-based backend router
│   ├── com.cozyterm.gateway.plist  #   launchd: OpenClaw gateway
│   ├── com.cozyterm.claude-proxy.plist # launchd: Claude Code proxy
│   ├── com.cozyterm.activity-sync.plist # launchd: Activity sync server
│   ├── com.cozyterm.telegram-push.plist # launchd: Telegram push notifications
│   ├── install-proxy-service.sh    #   Service installer
│   ├── migrate-to-cozyterm.sh      #   Migration from ~/.engie
│   └── start-proxy.sh              #   Proxy launcher
├── shared/                         # Shared across CLI + mobile
│   ├── constants.js                #   Ports, versions, service names
│   └── types.js                    #   JSDoc type definitions
├── cron/                           # Scheduled jobs
│   ├── jobs.json                   #   Morning brief + afternoon follow-up
│   └── telegram-push.mjs          #   Cross-platform activity -> Telegram
├── config/                         # OpenClaw config (symlinked from ~/.openclaw)
├── cozyterm-web/                   # Web dashboard (Vite + React + TypeScript)
├── cozyterm-mobile/                # React Native app (Expo)
├── workspace/                      # Skills, tools, persistent data
├── memory/                         # SQLite DB + markdown notes
└── logs/                           # Service output, archived logs
```

---

## Configuration

All paths resolve dynamically via `cli/lib/paths.js`. The canonical home is `~/.cozyterm/` with compatibility symlinks:

```
~/.openclaw -> ~/.cozyterm/config/
~/.engie    -> ~/.cozyterm/          (if migrated)
```

Override with the `COZYTERM_HOME` environment variable (falls back to `ENGIE_HOME`).

### Key Config Files

| File | Location | Purpose |
|------|----------|---------|
| `openclaw.json` | `~/.cozyterm/config/` | Gateway config (agents, models, ports) |
| `.env` | `~/.cozyterm/config/` | API keys, Jira creds (never committed) |
| `user.json` | `~/.cozyterm/profile/` | User profile (name, role, org) |
| `preferences.json` | `~/.cozyterm/profile/` | Learned preferences |
| `patterns.json` | `~/.cozyterm/profile/` | Work patterns (active hours, session lengths) |
| `cozyterm.db` | `~/.cozyterm/memory/` | SQLite memory database |
| `jobs.json` | `~/.cozyterm/cron/` | Scheduled job definitions |

### openclaw.json Example (Safe Template)

We provide a sanitized template at `config/openclaw.json.example`.

Copy it to your local config:

```bash
cp config/openclaw.json.example ~/.openclaw/openclaw.json
```

Then fill in these fields:
- `channels.telegram.botToken` — Telegram bot token
- `gateway.auth.token` — OpenClaw gateway token
- `channels.slack.*` — Slack settings if you use Slack (token/user ID)

---

## Guardrails

- Never pushes to main/master/prod without explicit approval
- Never deploys to production without approval
- Never modifies .env, terraform, or CI configs without approval
- Always notifies the operator of every action
- Max 5 PRs per day without explicit request
- Destructive commands are blocked by pre-execution hooks

---

## Tech Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| CLI Runtime | Bun | Built-in SQLite, fast startup |
| TUI Framework | Ink 5 + React 18 | Terminal UI via React components |
| MCP Bridge | Node + @modelcontextprotocol/sdk | Stdio transport |
| Agent Framework | OpenClaw | Gateway, agents, cron, sessions |
| Local LLM | Ollama | llama3.2 (3B), llama3.1 (8B), Metal GPU |
| Heavy Brain | Claude Code CLI | Uses your Claude subscription — no API credits |
| Memory | SQLite + FTS5 | Full-text search, auto-observation capture |
| Web Dashboard | Vite + React + TypeScript | Chat, memory, settings UI |
| Mobile | React Native / Expo | On-the-go access |
| Messaging | Telegram Bot API | Daily briefs, on-the-go queries |

---

## License

MIT — see [LICENSE](LICENSE).

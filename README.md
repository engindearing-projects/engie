# Familiar

An AI that lives in your terminal — local-first, always learning.

Familiar is a personal AI assistant that tracks your projects, remembers context across sessions, routes tasks between local and cloud models, and trains on your feedback over time. It runs natively on macOS with Apple Silicon GPU acceleration for local inference. Heavy tasks go through Claude Code using your existing subscription — no extra API spend.

Each user gets their own familiar. During setup you name it, configure integrations, and decide what runs locally vs in the cloud. The platform handles routing, memory, training, and scheduling.

---

## Quick Start

### Clone (recommended — full stack)

```bash
git clone https://github.com/engindearing-projects/engie.git ~/familiar
cd ~/familiar && ./setup.sh
```

The setup script installs dependencies, links the `familiar` command globally, and launches the interactive setup wizard. The wizard handles Ollama, API keys, services, and integrations.

### curl (binary only)

```bash
curl -fsSL https://familiar.run/install | bash
```

Installs a standalone binary. For the full service stack (gateway, memory, training), clone the repo instead.

### Homebrew

```bash
brew install engindearing-projects/engie/familiar
```

### npm

```bash
npm install -g familiar-run
```

---

## What It Does

**Smart routing** — Each message gets a complexity score. High-complexity tasks (code generation, refactoring, architecture) route to Claude Code. Low-complexity tasks (status checks, summaries, quick questions) run locally on Ollama. You don't have to think about it.

**Persistent memory** — Conversations are scanned for decisions, blockers, ticket references, preferences, and completions. Everything goes into a local SQLite database with full-text search. Context is surfaced automatically in the TUI banner, morning briefs, and injected into future conversations.

**Local tools** — 69 built-in tools for file operations, search, HTTP requests, shell commands, and more. Runs in a sandboxed tool loop with full MCP support.

**Training pipeline (Forge)** — Captures conversation pairs and trains local models on your feedback. Auto-training kicks in at 100 pairs. Ground-truth mining runs nightly. Models improve over time based on how you actually use them.

**Autonomous learning** — Daily 5-step cycle: reflect on recent interactions, learn from patterns, install new skills, generate ideas, and ingest relevant knowledge. Skills are sandboxed until approved.

**Scheduled briefs** — Morning and afternoon summaries pulled from Jira boards, GitHub activity, and memory. Delivered via Telegram or available in the TUI.

**MCP bridge** — Exposes itself as an MCP server so other tools (including Claude Code) can call into it. Also connects to external MCP servers for Jira, Slack, and Figma.

---

## Architecture

### Services

Everything runs as launchd services and auto-starts on boot:

| Service | Port | Description |
|---------|------|-------------|
| `com.familiar.gateway` | 18789 | WebSocket gateway — main hub for all interfaces |
| `com.familiar.claude-proxy` | 18791 | Routes heavy tasks through the Claude CLI |
| `com.familiar.ollama-proxy` | 11435 | Wraps local Ollama inference |
| `com.familiar.activity-sync` | 18790 | Cross-platform activity ledger |
| `com.familiar.tunnel` | — | Cloudflare quick tunnel for remote access |
| `com.familiar.telegram-bridge` | — | Bidirectional Telegram bot integration |
| `com.familiar.telegram-push` | — | Push notifications (every 30 min) |
| `com.familiar.forge-auto` | — | Auto-trainer daemon (100-pair threshold) |
| `com.familiar.forge-mine` | — | Ground-truth miner (daily 4 AM) |
| `com.familiar.learner` | — | Autonomous learning cycle (daily 5 AM) |
| `com.familiar.caffeinate` | — | Prevents macOS sleep |

Ollama runs separately via Homebrew (`homebrew.mxcl.ollama` on port 11434).

### Directory layout

```
apps/cli/        Bun+Ink TUI (gateway client, npm-linked globally)
apps/terminal/   Rust Ratatui TUI
apps/tray/       Rust macOS tray icon
apps/web/        Next.js 15 PWA
daemon/          Rust MCP server (69 tools)
services/        JS services (gateway, router, tools, telegram, proxies)
brain/           Autonomous learning (RAG + learner + skills)
trainer/         Forge ML pipeline
mcp-bridge/      MCP bridge for Claude Code integration
config/          Config files and .env
shared/          Shared utilities
cron/            Scheduled jobs
memory/          Memory database and sessions
```

---

## Commands

### Terminal (TUI)

```bash
familiar              # Open the main interface
familiar "question"   # One-shot from the command line
familiar --coach      # Coaching mode (friendlier explanations)
```

### Service management

```bash
familiar status          # Health check all services
familiar doctor          # Run diagnostics
familiar doctor --fix    # Auto-repair common issues
familiar start / stop    # Manage launchd services
```

### In-TUI commands

| Command | What it does |
|---------|-------------|
| `/memory [query]` | Search memory or show recent |
| `/observe <text>` | Save a note to memory |
| `/todo [add\|done]` | Manage todos (Shift+Tab to see panel) |
| `/status` | Service health |
| `/coach` | Toggle coaching mode |
| `/explain <topic>` | Friendly explanation |
| `/suggest` | Get next-step suggestions |
| `/forge [cmd]` | Training pipeline controls |
| `/clear` | Clear chat |
| `/help` | Full command list |

---

## Configuration

All user data lives in `~/.familiar/`:

| Path | Purpose |
|------|---------|
| `~/.familiar/config/familiar.json` | Main config (gateway, providers, agents) |
| `~/.familiar/config/.env` | API keys and tokens (never committed) |
| `~/.familiar/config/mcp-tools.json` | MCP server definitions |
| `~/.familiar/profile/user.json` | Your name, role, org |
| `~/.familiar/memory/familiar.db` | Memory database |
| `~/.familiar/logs/` | Service logs |
| `~/.familiar/cron/jobs.json` | Scheduled jobs |

During `familiar init`, you name your familiar and configure it to your preferences. The config directory can be overridden with the `FAMILIAR_HOME` environment variable.

---

## Development

```bash
git clone https://github.com/engindearing-projects/engie.git ~/familiar
cd ~/familiar/apps/cli && bun install
bun run dev                # Watch mode
```

Service scripts live in `services/`. The gateway entry point is `services/gateway.mjs`. The install script for launchd services is `services/install-services.sh`.

---

## Tech Stack

| | |
|---|---|
| **Runtime** | Bun (CLI, services), Node (MCP bridge) |
| **TUI** | Ink 5 + React 18 |
| **Gateway** | Custom WebSocket server |
| **Local LLM** | Ollama (Metal GPU) |
| **Heavy tasks** | Claude Code CLI (uses your subscription) |
| **Memory** | SQLite + FTS5 |
| **Training** | Forge pipeline (LoRA fine-tuning) |
| **Web** | Next.js 15 |
| **Messaging** | Telegram Bot API |

---

MIT — see [LICENSE](LICENSE).

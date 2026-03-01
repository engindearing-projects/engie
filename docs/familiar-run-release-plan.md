# Familiar.run — Production Release Plan

Last updated: 2026-03-01

---

## 1. Current State Audit

### 1.1 What Works Today

**Core Services (all running as launchd agents under `com.familiar.*`):**

- **Gateway** (`services/gateway.mjs`, port 18789) — WebSocket server handles auth, chat routing, session management, auto-observation, RAG context injection, context compaction, and multi-provider fallback (Claude -> Gemini -> Ollama). This is the central hub. Fully functional.
- **Claude Code Proxy** (`services/claude-code-proxy.mjs`, port 18791) — HTTP proxy that wraps the `claude` CLI in headless mode. Handles concurrency limiting (semaphore), training data collection via Forge, and OpenAI-compatible `/v1/chat/completions` endpoint. Works reliably.
- **Smart Router** (`services/router.mjs`) — Scores prompts by complexity using pattern matching and the classifier (`trainer/classify.mjs`). Routes to Claude (heavy), Gemini (middle), or Ollama (light). Role-specific system prompts and temperatures for coding/reasoning/tools/chat. Functional.
- **Tool Loop** (`services/tool-loop.mjs`) — Agentic loop for Ollama: parses `<tool_call>` XML blocks from model output, executes 10 built-in tools (bash, read_file, write_file, edit_file, glob, grep, memory_search, memory_store, memory_recent, list_tools), feeds results back. Handles JSON parsing edge cases from small models. Works but depends on model quality.
- **Telegram Bridge** (`services/telegram-bridge.mjs`, 1,700+ lines) — Bidirectional Telegram integration with long-polling, chat routing, terminal session management, preprocessing pipeline, A/B comparison, work queue integration, and inline approval buttons. The most complex service. Actively used daily.
- **Activity Server** (`services/activity-server.mjs`, port 18790) — SQLite-backed activity ledger with 30-day auto-cleanup. Cross-platform tracking (CLI, Telegram, web). Works.
- **Ollama Proxy** (`services/ollama-proxy.mjs`, port 11435) — Transparent proxy that captures prompt/response pairs for Forge training. Works.
- **Watchdog** (`services/watchdog.mjs`) — Self-healing monitor that runs every 5 minutes, checks launchd service status and health endpoints, restarts crashed services. Works.
- **Session Store** (`services/session-store.mjs`) — SQLite-backed persistent sessions with fork/archive/rename. Works.
- **Response Validator** (`services/response-validator.mjs`) — Hallucination detection: repetition loops, language drift, empty stubs, tool avoidance, timeout truncation, tool error rates. Works.
- **Cloudflare Tunnel** (`services/start-tunnel.sh`) — Quick tunnel exposing port 18791 to the internet, auto-updates Vercel env vars. Works but URL changes on every restart.
- **Caffeinate** — Prevents macOS sleep. Works.

**CLI App (`apps/cli/`):**

- Bun + Ink 5 + React 18 TUI. Package name is `familiar-run`, globally linked via `npm link`.
- Commands: interactive chat, one-shot query, init wizard, status, doctor, start/stop, observe, web, forge.
- Gateway WebSocket client (`apps/cli/src/gateway.mjs`) handles challenge-response auth.
- In-TUI commands: /memory, /observe, /status, /coach, /clear, /help.
- Memory system: `chat-memory.js`, `memory-db.js` (SQLite FTS5), `extract-observations.js`, `memory-context.js`.
- Service management: `lib/services.js` wraps launchctl.
- Functional and actively used.

**Brain System (`brain/`):**

- **Hands** (`brain/hands/`) — Autonomous capability framework. Schema-driven HAND.json manifests define multi-phase playbooks with cron scheduling, tool access, metrics, guardrails. Registry, runner, scheduler all implemented. 4 hands defined: forge-miner, forge-trainer, learner, researcher. Researcher has 6 successful runs. Newly built (Mar 1) and active.
- **RAG** (`brain/rag/`) — SQLite + nomic-embed-text embeddings. Cosine similarity search. 3.3MB knowledge.db. Knowledge graph module with entity extraction and co-occurrence relationships. Works.
- **Learner** (`brain/learner.mjs`) — 5-step daily cycle: REFLECT, LEARN, INSTALL, IDEATE, INGEST. Uses Ollama for reflection and Claude proxy as fallback. Sends Telegram notifications. Runs daily at 5 AM.
- **Skills** (`brain/skills/`) — Registry exists but only has an empty `registry.json` (`{"hands":[]}` equivalent). Skills framework is defined but no skills have been installed yet.

**Forge Training Pipeline (`trainer/`):**

- **Data collection**: `collector.mjs` (prompt/response pairs from proxy), `tool-collector.mjs` (tool call traces), `mine-ground-truth.mjs` (merged PR diffs from GitHub), `mine-expanded.mjs` (commit-level data).
- **Classification**: `classify.mjs` (JS) and `scripts/classify.py` — pattern-based task type classifier for coding/reasoning/tools/chat.
- **Training**: Python pipeline (`scripts/train.py`, `scripts/train-cuda.py`) using LoRA fine-tuning. `forge-auto.mjs` auto-trains when 100+ unused pairs accumulate.
- **Evaluation**: `scripts/evaluate.py` with benchmark tasks in `benchmarks/`.
- **Deployment**: `scripts/fuse-and-deploy.py` merges LoRA weights and pushes to Ollama.
- **Multi-domain**: Domain configs for coding, chat, reasoning, tools, brain, healthcare, legal, finance, education.
- **Forge CLI**: `forge-cli.mjs` wraps the full pipeline.
- **Remote training**: Scripts for syncing to a remote GPU machine (`scripts/sync-remote.sh`, `scripts/setup-remote.sh`).
- **5,170+ training pairs** in the forge DB. Pipeline is functional.

**Daemon (`daemon/`):**

- Rust MCP server over stdio. 17 capability modules: system_info, clipboard, notifications, screenshots, window_mgmt, app_control, input_sim, audio, display, file_search, accessibility, file_ops, network, browser, defaults, terminal, ocr. Feature-gated compilation. Binary exists at `daemon/target/release/familiar-daemon`.

**MCP Bridge (`mcp-bridge/`):**

- Node.js MCP server that exposes Familiar as an MCP server for Claude Code. Connects to gateway via WebSocket. Provides tools: familiar_chat, familiar_claude, familiar_observe, familiar_memory_recent, familiar_memory_search, familiar_memory_stats, familiar_memory_profile, and others.

**Infrastructure:**

- `services/install-services.sh` — Full launchd installer/uninstaller with status command. Handles old service label cleanup (com.engie.*, com.cozyterm.*).
- `setup.sh` — Bootstrap script: installs Bun, OpenCode, CLI deps, npm link, runs init wizard.
- `.github/workflows/release.yml` — GitHub Actions: builds standalone binaries (arm64 + x64), creates GitHub Release, publishes to npm, updates Homebrew formula.
- `Formula/familiar.rb` — Homebrew formula (placeholder sha256 values).

### 1.2 What's Partially Built

- **Web App** (`apps/web/`) — Next.js 15 monorepo with `@engie/core` and `@engie/web` packages. Has pages for chat, files, settings, and an API route. Has a `.next` build directory (was built at some point). Package names are still `@engie/*`. Not deployed or actively maintained.
- **Rust Terminal** (`apps/terminal/`) — Ratatui TUI with WebSocket gateway client. Cargo.toml defined, source exists, but no binary built.
- **Rust Tray** (`apps/tray/`) — macOS system tray icon with tray-icon + tao. Has popover and character features (optional). Source exists.
- **Homebrew Formula** — Structure exists but sha256 values are PLACEHOLDER. Release workflow exists but has not been executed (no tags pushed).
- **npm publishing** — Package.json configured with `publishConfig.access: "public"` but not yet published.
- **Cron System** (`cron/`) — `jobs.json` has thread monitoring jobs. `telegram-push.mjs` sends periodic notifications. Working but ad-hoc.
- **Daemon Background Service** (`services/daemon.mjs`) — Autonomous investigation + Telegram approval + execution. Connects to gateway as a WS client. Has trigger cascade system. Partially wired.

### 1.3 What's Missing

- **Zero automated tests** — No test files exist in the codebase (except `test-hello.mjs` and `test-upgrades.mjs` which are manual integration tests, and `test-gateway.mjs` which is a manual WS connection test).
- **No CI pipeline** — Only a release workflow exists. No lint, no test, no type checking on push/PR.
- **No rate limiting on gateway** — The WebSocket gateway has token auth but no per-client rate limiting or abuse protection.
- **No input validation/sanitization** — Tool inputs (especially bash commands) have a blocklist but no proper input validation. No XSS protection on web outputs.
- **No graceful shutdown** — Services don't handle SIGTERM cleanly (no connection draining).
- **No health dashboard** — `familiar status` shows service health but there's no persistent monitoring/alerting beyond the watchdog.
- **No backup strategy** — SQLite databases (sessions, knowledge, forge) have no automated backups.
- **No user accounts** — Single-user only. Auth is a shared gateway token.
- **No install script for binary distribution** — The `curl -fsSL https://familiar.run/install | bash` referenced in README does not exist.
- **No familiar.run domain/site** — The domain is referenced everywhere but nothing is deployed there.
- **No mobile app** — Telegram serves as the mobile interface.

### 1.4 Code Quality Assessment

**Strengths:**
- Clean separation of concerns: each service is a single file with clear responsibilities.
- Consistent patterns: all services use the same env loading, config resolution, and error handling idioms.
- Good fallback chains: Claude -> Gemini -> Ollama with automatic detection of availability.
- Self-healing: watchdog monitors and restarts crashed services.
- Data pipeline is well-structured: collection -> classification -> training -> evaluation -> deployment.

**Concerns:**
- Large monolithic files: `gateway.mjs` (1,200+ lines), `telegram-bridge.mjs` (1,700+ lines), `claude-code-proxy.mjs` (1,100+ lines). These should be split into modules.
- Hardcoded paths: Many files contain `/Users/grantjwylie/engie/` paths (HAND.json manifests, tool-loop.mjs SOUL_PATH, etc.). Must be made relative or configurable.
- Duplicate code: Telegram notification helper is copy-pasted across `learner.mjs`, `runner.mjs`, `forge-auto.mjs`, and others. Should be a shared module.
- Error handling is inconsistent: some paths use try/catch with empty catches, others throw. Many catch blocks silently swallow errors.
- The `engie` and `cozyterm` names appear in 103 locations across 30 files. Rebrand is incomplete.

### 1.5 CRITICAL SECURITY ISSUE

**Secrets are committed to the repository.** The following files contain live API keys, tokens, and credentials:

- `/Users/grantjwylie/engie/config/.env` — Contains JIRA_API_TOKEN, ANTHROPIC_API_KEY, GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, and gateway tokens in plaintext.
- `/Users/grantjwylie/engie/config/mcp-tools.json` — Contains JIRA_API_TOKEN, SLACK_BOT_TOKEN, FIGMA_API_KEY in plaintext.
- `/Users/grantjwylie/engie/config/familiar.json` — Contains the gateway auth token.

While `config/.env`, `config/familiar.json`, and `config/mcp-tools.json` are listed in `.gitignore`, and the `config/.env` at root level is also gitignored, the fact that these files contain live credentials that are loaded at runtime is a risk. Before any public release:

1. All credentials must be rotated.
2. Secrets must be loaded exclusively from environment variables or a dedicated secrets manager.
3. Config files checked into git must never contain real credentials.
4. The hardcoded gateway auth token in `familiar.json` must be replaced with an env var reference.

Additionally, the `config/mcp-tools.json` hardcodes full file paths and API tokens for Jira, Slack, and Figma. This file must be templated or generated during setup.

---

## 2. Pre-Release Requirements

### 2.1 Security Audit

**P0 — Must fix before any external access:**

1. **Rotate all exposed secrets** — Every API key and token in `config/.env` and `config/mcp-tools.json` must be rotated immediately. These have been in the working tree and may have been in git history.
   - Files: `config/.env`, `config/mcp-tools.json`, `config/familiar.json`

2. **Scrub git history** — Use `git filter-repo` or BFG Repo Cleaner to remove any secrets that were ever committed. Even if gitignored now, they may exist in older commits.

3. **Gateway auth hardening** — The gateway uses a single static token (`config/familiar.json` > `gateway.auth.token`). For multi-user support, this needs per-client tokens or proper JWT/OAuth.

4. **Telegram bridge access control** — `TG_BRIDGE_ALLOW_ALL=1` is set in the launchd plist, allowing any Telegram user to interact. Must be restricted to allowed chat IDs.
   - File: `services/install-services.sh` (line 251)

5. **Bash command safety** — The blocklist in `services/tools.mjs` (lines 30-48) is a good start but is bypass-prone. For example, `rm -r -f` (with separate flags) bypasses `rm -rf`. Consider a whitelist approach or sandboxing (e.g., `bwrap`/`sandbox-exec` on macOS).
   - File: `services/tools.mjs`

6. **MCP tool permissions** — The daemon has a `permissions.rs` module but the default config enables system_info, clipboard, notifications, and file_ops. For public release, the default should be minimal with opt-in escalation.
   - File: `daemon/src/permissions.rs`

**P1 — Must fix before beta:**

7. **Input validation** — Add schema validation on all WebSocket message payloads. Currently raw JSON is parsed and used directly.
   - Files: `services/gateway.mjs`, `mcp-bridge/index.mjs`

8. **Rate limiting** — Add per-client rate limiting on the gateway (messages per minute) and the Claude proxy (requests per minute). Without this, a single client could burn through the Claude subscription or DoS Ollama.
   - Files: `services/gateway.mjs`, `services/claude-code-proxy.mjs`

9. **CORS/origin checks** — The Claude proxy HTTP server has no CORS headers or origin validation. Add proper CORS configuration.
   - File: `services/claude-code-proxy.mjs`

10. **Secrets manager integration** — Replace plaintext .env files with macOS Keychain, 1Password CLI, or at minimum, ensure all secrets come from environment variables (never from JSON config files committed to git).

### 2.2 Stability

**Error handling:**

1. **Add graceful shutdown to all services** — Listen for SIGTERM/SIGINT, drain connections, close databases, then exit. Currently services are killed hard by launchd.
   - Files: `services/gateway.mjs`, `services/activity-server.mjs`, `services/claude-code-proxy.mjs`, `services/telegram-bridge.mjs`

2. **Replace empty catch blocks** — Audit every `catch {}` or `catch { /* ignore */ }`. At minimum, log the error. Many of these hide real bugs.
   - All service files under `services/`

3. **SQLite connection management** — Multiple services open SQLite databases but don't close them on shutdown. Add proper cleanup.
   - Files: `services/session-store.mjs`, `services/activity-server.mjs`, `brain/rag/index.mjs`

4. **Claude CLI failure handling** — When `claude -p` hangs or returns garbage, the proxy should have a timeout and return a clean error, not leave the semaphore locked.
   - File: `services/shared-invoke.mjs`

5. **Ollama cold start handling** — When Ollama is loading a model for the first time, requests can take 60+ seconds. The gateway should detect this and show a "warming up" status to the user rather than appearing hung.
   - File: `services/gateway.mjs`

**Recovery:**

6. **Watchdog improvements** — Add Telegram notification when services are restarted. Track restart frequency and alert if a service is crash-looping (more than 3 restarts in 15 minutes).
   - File: `services/watchdog.mjs`

7. **Session recovery** — When the gateway restarts, in-memory sessions are lost. The SQLite persistence exists but hydration is not automatic (by design, per the comment in gateway.mjs line 188-190). Consider offering a `/resume` command that loads the last session from SQLite.

### 2.3 Testing

**What exists:**
- `services/test-hello.mjs` — Manual sanity check that sends a message through the gateway.
- `services/test-upgrades.mjs` — Manual test for upgrade scenarios.
- `apps/cli/test-gateway.mjs` — Manual WebSocket connection test.
- `trainer/benchmarks/` — Evaluation benchmarks for model quality (coding, tools, etc.).
- `services/benchmark-coding.mjs` — Coding benchmark runner.

**What's needed:**

1. **Unit tests for core logic:**
   - `services/router.mjs` — Test routing decisions for various prompt types.
   - `services/response-validator.mjs` — Test repetition detection, language drift detection.
   - `services/tools.mjs` — Test bash safety checklist, tool execution with mocked filesystem.
   - `services/tool-loop.mjs` — Test XML/JSON tool call parsing.
   - `services/project-resolver.mjs` — Test project matching against various inputs.
   - `trainer/classify.mjs` — Test classification accuracy on labeled examples.
   - `brain/hands/schema.mjs` — Test manifest validation.

2. **Integration tests:**
   - Gateway WebSocket protocol: connect, auth challenge, chat.send, session management.
   - Claude proxy: health endpoint, request forwarding, fallback to Ollama.
   - Activity server: POST activity, GET recent, cleanup.
   - MCP bridge: tool registration, request/response flow.

3. **End-to-end tests:**
   - Full message flow: CLI -> Gateway -> Router -> Claude/Ollama -> Response -> CLI.
   - Forge pipeline: collect pair -> classify -> prepare -> train -> evaluate.

4. **Testing framework:** Use Bun's built-in test runner (`bun test`). Add a `test/` directory at the project root. Add a CI workflow that runs tests on every push.

### 2.4 Configuration

**Must be user-configurable (via `familiar init` or config file):**

- Gateway port (currently hardcoded default: 18789)
- Gateway auth token (currently in familiar.json)
- Claude proxy port (18791)
- Ollama URL and model names
- Telegram bot token and allowed chat IDs
- Training mode on/off
- Sandbox mode (off/restricted/full)
- Log level and log directory
- Which integrations are enabled (Jira, Slack, Figma)

**Currently hardcoded but should be configurable:**

- Max concurrent Claude sessions (hardcoded to 2 in shared-invoke.mjs)
- Session TTL (hardcoded to 2 hours in gateway.mjs)
- Forge auto-train threshold (100 pairs, configurable via CLI arg but not config file)
- Watchdog check interval (5 minutes, hardcoded in plist)
- Telegram long-poll interval (2 seconds)
- Tool timeout (30 seconds bash, 120 seconds tool loop)
- RAG minimum similarity score (0.3)
- Context compaction token budget (4000)

**Must remain hardcoded or internal:**

- MCP protocol version
- WebSocket message format
- SQLite schemas
- Blocked bash patterns (security)

---

## 3. Infrastructure

### 3.1 Domain Setup (familiar.run)

**Required:**
- Register and configure `familiar.run` DNS.
- Point the root domain to a landing page (static site: what Familiar is, install instructions, documentation).
- `docs.familiar.run` or `familiar.run/docs` for documentation.
- `app.familiar.run` for the web PWA (if deployed).
- `api.familiar.run` is NOT needed — Familiar runs locally. But consider it for a future cloud-hosted tier.

**Landing page content:**
- Hero: "AI that lives in your terminal — local-first, always learning."
- Install commands (brew, npm, curl, git clone)
- Feature overview with screenshots (TUI, Telegram, web)
- Architecture diagram
- Documentation link

**Hosting options for the landing page:**
- Vercel (free, already used for other projects)
- GitHub Pages (free, simple)
- Cloudflare Pages (free, fast)

### 3.2 Hosting Strategy

**The Mac mini IS the brain.** Familiar is designed to run on the user's own hardware. There is no cloud backend. This is a core architectural principle.

For Grant's personal instance:
- Mac mini runs all services locally via launchd.
- Cloudflare Quick Tunnel provides remote access (changes URL on restart, currently).
- For stable remote access: Cloudflare Tunnel with a named tunnel and custom domain (`brain.familiar.run` or similar). This requires a free Cloudflare account and the `cloudflared` daemon.

For public users:
- Everything runs on their Mac.
- No cloud dependency except optional API providers (Anthropic, Gemini, OpenAI).
- Ollama provides fully offline operation.
- The Forge pipeline trains models locally (or on a remote GPU via SSH).

### 3.3 Tunneling / Reverse Proxy

**Current state:** Cloudflare Quick Tunnel (`services/start-tunnel.sh`) creates an ephemeral `.trycloudflare.com` URL. The URL changes on every restart and the script updates Vercel env vars.

**For production (Grant's instance):**
1. Set up a named Cloudflare Tunnel:
   ```
   cloudflared tunnel create familiar-brain
   cloudflared tunnel route dns familiar-brain brain.familiar.run
   ```
2. Create a `~/.cloudflared/config.yml` with a stable tunnel config.
3. Update `start-tunnel.sh` to use the named tunnel instead of quick tunnel.
4. The URL will be stable: `https://brain.familiar.run`.

**For public users:**
- Tunneling is optional. Local-only use (localhost) is the default.
- Document how to set up Cloudflare Tunnel or Tailscale for remote access.
- The `familiar init` wizard should ask "Do you want remote access?" and guide setup.

### 3.4 SSL/TLS

- Local services communicate over `localhost` — no TLS needed.
- The Cloudflare Tunnel provides TLS termination automatically.
- The WebSocket gateway should support `wss://` for non-local clients. This means either:
  - Running behind a reverse proxy (nginx/caddy) that terminates TLS, or
  - Using Cloudflare Tunnel which handles this.
- For the web app: Vercel provides TLS automatically.

### 3.5 Monitoring and Alerting

**Current state:** Watchdog checks service health every 5 minutes and restarts crashed services. Logs go to `~/.familiar/logs/`.

**Needed:**
1. **Structured logging** — Currently all logs are plain text. Switch to JSON structured logs so they can be parsed by monitoring tools.
   - Every service writes to its own log file via launchd stdout/stderr redirection.

2. **Log rotation** — `lib/log-rotation.js` exists in the CLI but is not used by services. Implement rotation for all service logs (e.g., daily rotation, keep 7 days).

3. **Telegram alerts** — The watchdog should send a Telegram message when:
   - A service crashes and is restarted.
   - A service fails health check 3 times in a row.
   - Disk space on the boot volume drops below 10GB.
   - The Claude subscription appears rate-limited (429 errors).

4. **Metrics dashboard** — For alpha/beta, the `familiar status` command is sufficient. For public launch, consider a simple web dashboard (could be part of the web app) showing:
   - Service health (green/yellow/red)
   - Message volume (last hour/day)
   - Model usage (Claude vs Gemini vs Ollama)
   - Forge training status (pairs collected, last train time, model version)
   - RAG knowledge base size

### 3.6 Backup Strategy

**SQLite databases to back up:**
- `~/.familiar/data/sessions.db` — Chat sessions.
- `~/.familiar/memory/familiar.db` — Activity log and memory.
- `/Users/grantjwylie/engie/brain/rag/knowledge.db` — RAG embeddings (3.3MB).
- `/Users/grantjwylie/engie/trainer/db/forge.db` — Forge training pairs.

**Backup plan:**
1. Add a daily cron job (via launchd or the hands scheduler) that copies all `.db` files to `~/.familiar/backups/YYYY-MM-DD/`.
2. Keep 7 days of backups locally.
3. Optionally sync to iCloud, Dropbox, or a remote server via rsync.
4. The `familiar doctor` command should check that backups are recent and warn if not.

---

## 4. User Experience

### 4.1 Onboarding Flow

**`familiar init` wizard currently handles:**
- Detecting Bun and Ollama.
- Generating config files.

**Needed for production:**

1. **First-run detection** — If `~/.familiar/` doesn't exist, prompt the user to run `familiar init`.

2. **Setup wizard steps:**
   - Welcome message explaining what Familiar does.
   - Check prerequisites: Bun, Ollama, (optional) Claude Code CLI.
   - Pull a default Ollama model (`llama3.2` or similar) if none exists.
   - Generate gateway auth token (`openssl rand -hex 32`).
   - Ask for optional integrations: Telegram bot token, API keys.
   - Install launchd services.
   - Run a quick test: send "hello" through the gateway and verify a response.
   - Show the user their first chat session.

3. **Progressive disclosure** — Don't ask for Jira/Slack/Figma tokens during initial setup. Let the user add integrations later via `familiar init --add-integration`.

4. **Upgrade path** — `familiar doctor --fix` should handle upgrades: reinstall services if the plist format changed, run database migrations, etc.

### 4.2 Documentation Needed

1. **Getting Started guide** — Clone, setup, first chat. 5-minute path to "it works."
2. **Configuration reference** — Every config option in `familiar.json` and `.env` explained.
3. **Architecture overview** — Diagram of services, data flow, and how routing works.
4. **Integrations guide** — How to set up Telegram, Jira, Slack, Figma.
5. **Forge training guide** — How the training pipeline works, how to check model quality, how to force a retrain.
6. **Hands guide** — How to write a custom Hand manifest, what each field means, examples.
7. **Troubleshooting** — Common issues and fixes (Ollama not starting, Claude proxy hanging, etc.).
8. **FAQ** — "Does this send my data to the cloud?" "How much disk space does it need?" "Can I use it without Claude?"

### 4.3 CLI Installation

**Current methods (all partially working):**

| Method | Status |
|--------|--------|
| `git clone && ./setup.sh` | Works for development |
| `brew install engindearing-projects/engie/familiar` | Formula exists but sha256 are PLACEHOLDER |
| `npm install -g familiar-run` | Package.json ready but not published |
| `curl -fsSL https://familiar.run/install \| bash` | Referenced in README but does not exist |

**For production release:**

1. **Primary: git clone** — Keep this as the full-stack install path. It's the only way to get services, training, and the full brain.

2. **Secondary: brew** — For the standalone CLI binary only (no services, no training). Must:
   - Push a version tag to trigger the release workflow.
   - Verify the workflow builds correct binaries.
   - Create a Homebrew tap repo (`homebrew-familiar`) or submit to homebrew-core.

3. **Tertiary: npm** — Publish `familiar-run` to npm. This gives `npx familiar-run` and `npm install -g familiar-run`. Must verify that the Bun dependency doesn't cause issues for Node.js users.

4. **Install script** — Create `https://familiar.run/install` that:
   - Detects macOS + architecture.
   - Downloads the latest release binary.
   - Places it in `/usr/local/bin/familiar`.
   - Prints "Run `familiar init` to get started."

### 4.4 Web App Deployment

**Current state:** `apps/web/` is a Next.js 15 monorepo with `@engie/core` and `@engie/web` packages. Has pages for chat, files, settings. Has not been deployed.

**Recommendation:** Defer web app for Phase 2 (beta). The CLI and Telegram interfaces are sufficient for alpha. When ready:

1. Rename packages from `@engie/*` to `@familiar/*`.
2. Wire the web app to connect to the local gateway via WebSocket.
3. Deploy to Vercel at `app.familiar.run`.
4. Add authentication (the gateway token, or a proper auth flow).
5. The `familiar web` command already exists to open the local web UI with auto-auth.

### 4.5 Mobile Considerations

**Current mobile story:** Telegram bot is the mobile interface. It works well and has the full feature set including terminal sessions, A/B comparisons, and approval workflows.

**Future options:**
- PWA (web app installed on home screen) — easiest path.
- Native mobile app — not justified for alpha/beta.
- Telegram will remain the primary mobile interface.

---

## 5. Branding & Identity

### 5.1 Remaining Rebrand Work

**103 occurrences of `engie` or `cozyterm` across 30 files.** Major items:

| Category | Files | What to change |
|----------|-------|---------------|
| System prompts | `services/gateway.mjs` (line 131), `services/claude-code-proxy.mjs` (line 84) | "You are Engie" -> "You are Familiar" |
| Identity doc | `config/IDENTITY.md` | Full rewrite: still says "CozyTerm / Engie" throughout |
| Web packages | `apps/web/packages/core/package.json`, `apps/web/packages/web/package.json` | `@engie/core` -> `@familiar/core`, `@engie/web` -> `@familiar/web` |
| CLI paths | `apps/cli/lib/paths.js` (7 occurrences) | `cozyterm` references in path resolution |
| Forge CLI | `trainer/forge-cli.mjs` (19 occurrences) | "engie forge" in help text and references |
| Config | `config/projects.json` | `"dir": "~/engie"` |
| Disallowed tools | `services/gateway.mjs` (line 124) | `mcp__engie__engie_chat` -> `mcp__familiar__familiar_chat` |
| Trainer setup | `trainer/setup.sh`, `trainer/scripts/setup-remote.sh`, `trainer/scripts/sync-remote.sh` | Various `engie` references |
| MCP config | `.mcp.json` | `"engie"` server name |
| Collector | `trainer/collector.mjs` | 4 references |
| CLI config-gen | `apps/cli/lib/config-gen.js` | 2 references |
| LICENSE | Root `LICENSE` | "CozyTerm Contributors" -> "Familiar Contributors" |
| GitHub repo | `engindearing-projects/engie` | Rename repo to `familiar-run/familiar` or similar |
| HAND manifests | `brain/hands/*/HAND.json` | Hardcoded paths with `/Users/grantjwylie/engie/` |

### 5.2 Domain System Prompts

Update all role prompts in `services/router.mjs` (lines 31-47):
- Already correct: "You are Familiar, a persistent AI assistant from familiar.run"
- But the gateway's `FAMILIAR_SYSTEM_PREAMBLE` (line 131) still says "You are Engie".
- And the claude proxy's `FAMILIAR_SYSTEM_PREAMBLE` (line 84) says "You are Engie".

### 5.3 Package Name Updates

| Current | Target |
|---------|--------|
| `familiar-run` (CLI) | Keep — good npm name |
| `@engie/core` (web) | `@familiar/core` |
| `@engie/web` (web) | `@familiar/web` |
| `familiar-daemon` (Rust) | Keep |
| `familiar-terminal` (Rust) | Keep |
| `familiar-tray` (Rust) | Keep |

### 5.4 Repository Rename

The GitHub repo is `engindearing-projects/engie`. Options:
1. Rename to `engindearing-projects/familiar` — minimal disruption.
2. Create a new org `familiar-run` and transfer: `familiar-run/familiar` — cleaner but more work.
3. Keep current repo name, just update references — least disruptive for development.

Recommendation: Option 1 for now, Option 2 when going public.

---

## 6. Phased Rollout

### Phase 1: Private Alpha (Grant Only) — Current + 2 weeks

**Goal:** Stabilize the existing system, fix security issues, complete the rebrand.

**Checklist:**

- [ ] **SECURITY: Rotate all API keys and tokens** (Jira, Anthropic, Gemini, Telegram, Slack, Figma, gateway tokens)
- [ ] **SECURITY: Scrub git history** of any committed secrets
- [ ] **SECURITY: Restrict Telegram bridge** — remove `TG_BRIDGE_ALLOW_ALL=1`, whitelist chat IDs
- [ ] **REBRAND: Fix all system prompts** ("Engie" -> "Familiar" in gateway.mjs, claude-code-proxy.mjs)
- [ ] **REBRAND: Rewrite IDENTITY.md** to match Familiar branding
- [ ] **REBRAND: Update LICENSE** ("CozyTerm Contributors" -> "Familiar Contributors")
- [ ] **REBRAND: Fix hardcoded paths** in HAND.json manifests (use relative paths or env vars)
- [ ] **STABILITY: Add graceful shutdown** to gateway, proxy, telegram-bridge, activity-server
- [ ] **STABILITY: Replace empty catch blocks** with error logging (audit all services)
- [ ] **INFRA: Set up named Cloudflare Tunnel** for stable remote access
- [ ] **INFRA: Set up daily SQLite backups** via launchd/hands scheduler
- [ ] **INFRA: Add log rotation** for all service logs
- [ ] **CONFIG: Move all secrets out of JSON config files** into env vars only
- [ ] **DOCS: Write Getting Started guide** (clone -> setup -> first chat)
- [ ] **TEST: Add basic unit tests** for router, classifier, response-validator, tool-call parser

**Go/No-Go Criteria:**
- All P0 security items resolved.
- System runs for 7 consecutive days without manual intervention (watchdog handles everything).
- No "Engie" or "CozyTerm" visible in any user-facing output.
- Backups running and verified.

**Timeline estimate:** 2 weeks.

### Phase 2: Invite-Only Beta (5-10 users) — 4-6 weeks after Phase 1

**Goal:** Validate that other people can install and use Familiar on their Macs.

**Checklist:**

- [ ] **INSTALL: Verify setup.sh works on a clean macOS** (test on fresh user account or VM)
- [ ] **INSTALL: Publish first GitHub Release** (trigger release.yml with a v0.1.0 tag)
- [ ] **INSTALL: Publish to npm** (`npm publish` for `familiar-run`)
- [ ] **INSTALL: Create working Homebrew formula** (after first release populates sha256 values)
- [ ] **INSTALL: Create install script** at `https://familiar.run/install`
- [ ] **DOMAIN: Set up familiar.run** landing page with install instructions
- [ ] **DOCS: Write full Configuration Reference**
- [ ] **DOCS: Write Integrations Guide** (Telegram, Jira, Slack, Figma)
- [ ] **DOCS: Write Troubleshooting guide**
- [ ] **UX: Polish the `familiar init` wizard** — test on fresh systems
- [ ] **UX: Polish `familiar doctor`** — ensure it detects and fixes common issues
- [ ] **TEST: Add integration tests** for gateway protocol, proxy fallback, activity server
- [ ] **CI: Add GitHub Actions workflow** for lint + test on push
- [ ] **MULTI-USER: Ensure config is per-user** (`~/.familiar/`) with no shared state
- [ ] **REBRAND: Rename web packages** `@engie/*` -> `@familiar/*`
- [ ] **REBRAND: Rename GitHub repo** to `familiar-run/familiar` or `engindearing-projects/familiar`
- [ ] **STABILITY: Add rate limiting** on gateway and proxy
- [ ] **STABILITY: Add input validation** on WebSocket message payloads
- [ ] **STABILITY: Improve error messages** — user-facing errors should be helpful, not stack traces

**Go/No-Go Criteria:**
- At least 3 beta users successfully installed and used Familiar for 1 week.
- `familiar init` works on a clean macOS without manual intervention.
- `familiar doctor --fix` resolves the most common setup issues.
- No P0 bugs reported in 2 weeks.

**Timeline estimate:** 4-6 weeks after Phase 1.

### Phase 3: Public Launch — 4-8 weeks after Phase 2

**Goal:** Familiar.run is publicly available with documentation, community, and polish.

**Checklist:**

- [ ] **DOMAIN: Full familiar.run website** (landing page, docs, blog)
- [ ] **DOCS: Complete documentation site** (all guides, API reference, architecture)
- [ ] **WEB: Deploy web app** at `app.familiar.run` (optional — CLI + Telegram may be enough)
- [ ] **COMMUNITY: Create GitHub Discussions** for support and feature requests
- [ ] **COMMUNITY: Create a Discord or similar** for real-time community
- [ ] **MARKETING: Write announcement blog post**
- [ ] **MARKETING: Record demo video** (2-3 minutes showing install -> first chat -> Telegram -> training)
- [ ] **POLISH: Review all user-facing text** — help messages, error messages, wizard prompts
- [ ] **POLISH: Add progress indicators** for long operations (model downloading, training)
- [ ] **TEST: Full end-to-end test suite**
- [ ] **LEGAL: Review LICENSE** (currently MIT — confirm this is the intent)
- [ ] **LEGAL: Add privacy policy** (what data stays local, what goes to APIs)
- [ ] **METRICS: Add opt-in anonymous usage metrics** (install count, feature usage, crash reports)

**Go/No-Go Criteria:**
- Documentation covers all user-facing features.
- Install success rate > 90% on macOS (measured from beta feedback).
- No P0 or P1 bugs open.
- Landing page is live and install commands work.

**Timeline estimate:** 4-8 weeks after Phase 2.

---

## 7. Risk Assessment

### 7.1 What Could Go Wrong

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Claude subscription gets rate-limited during heavy use | Users lose heavy brain capabilities | Medium | Already mitigated: automatic Gemini/Ollama fallback. Document the limitation. |
| Ollama model quality insufficient for production use | Tool loop fails, bad responses | High | Continue Forge training. Ship with a tested base model. Set user expectations. |
| macOS update breaks launchd services | All services stop | Low | Watchdog detects. Document known macOS version compatibility. Test on beta releases. |
| User installs on non-Apple-Silicon Mac | Ollama performance is terrible | Medium | Document minimum requirements (Apple Silicon recommended). x64 support via Rosetta. |
| SQLite database corruption | Lost sessions, lost training data, lost memory | Low | Daily backups. WAL mode already enabled. Add integrity checks to `familiar doctor`. |
| Cloudflare Tunnel instability | Remote access drops | Medium | Named tunnel is more stable than quick tunnel. Document Tailscale as alternative. |
| Security breach via exposed tokens | Account compromise | High (if secrets in git history) | Rotate all tokens immediately. Scrub git history. Never commit secrets. |
| User confusion about what runs locally vs cloud | Trust issues | Medium | Clear documentation. Privacy policy. Show routing decisions in TUI. |

### 7.2 Dependencies on External Services

| Service | Required? | What breaks without it | Alternative |
|---------|-----------|----------------------|-------------|
| Anthropic (Claude Code CLI) | No | Heavy brain tasks unavailable | Gemini Flash, then Ollama |
| Google (Gemini API) | No | Middle-tier fallback unavailable | Ollama handles everything locally |
| Ollama | Yes (for local-only use) | No local inference at all | Must be installed. Can use API-only mode if Ollama unavailable. |
| Telegram Bot API | No | Mobile/remote interface unavailable | Use CLI or web instead |
| Cloudflare | No | No tunneled remote access | Direct LAN access, Tailscale, or SSH |
| GitHub (for Forge mining) | No | Can't mine ground-truth training data | Manual data collection, existing pairs |
| npm registry | No | Can't install via npm | Git clone, brew, or binary download |
| Homebrew | No | Can't install via brew | Git clone, npm, or binary download |

### 7.3 Single Points of Failure

1. **The Mac itself** — If the Mac goes down, everything goes down. No cloud failover.
   - Mitigation: `caffeinate` prevents sleep. UPS for power protection. Document that this is by design — local-first means local-dependent.

2. **Ollama process** — If Ollama crashes or gets stuck, all local inference stops.
   - Mitigation: Watchdog doesn't currently monitor Ollama (it's managed by Homebrew, not com.familiar.*). Add a health check for `http://localhost:11434/api/tags` to the watchdog.

3. **Gateway process** — If the gateway crashes, all interfaces lose connectivity.
   - Mitigation: Already has KeepAlive=true in launchd + watchdog monitoring. Restart is automatic.

4. **Claude Code binary** — If the `claude` CLI is not installed or has a version incompatibility, the proxy cannot function.
   - Mitigation: `familiar doctor` should verify `claude --version`. Fall back to Gemini/Ollama if unavailable.

5. **Disk space** — SQLite databases, logs, training data, and Ollama models can consume significant disk space.
   - Mitigation: Activity server auto-cleans after 30 days. Add log rotation. Add a disk space check to `familiar doctor`. Warn if < 10GB free.

### 7.4 Cost Projections

| Item | Cost | Notes |
|------|------|-------|
| Claude Max subscription | $100/month (already existing) | Heavy brain tasks. No additional API spend needed. |
| Gemini API | Free tier | 1.5M tokens/day free for Gemini Flash. More than sufficient. |
| Ollama | Free | Runs locally on Apple Silicon. |
| Cloudflare Tunnel | Free tier | Named tunnels are free for personal use. |
| familiar.run domain | ~$15/year | .run TLD pricing |
| Vercel (landing page) | Free tier | Static site, minimal usage |
| GitHub (repo hosting) | Free | Public repo, or private with free plan |
| npm (package hosting) | Free | Public packages are free |
| Homebrew tap | Free | Hosted on GitHub |
| **Total incremental cost** | **~$15/year** | Everything else is already paid for or free |

For users: The only required cost is the hardware (a Mac). Everything else is optional.
- Without a Claude subscription: Familiar runs entirely on Ollama (free).
- With a Claude subscription: Heavy tasks route to Claude, light tasks stay local.
- API keys for Gemini, Jira, Slack, Figma are all free-tier compatible.

---

## Appendix A: File Reference

### Core Service Files
- `/Users/grantjwylie/engie/services/gateway.mjs` — WebSocket gateway (central hub)
- `/Users/grantjwylie/engie/services/claude-code-proxy.mjs` — Claude Code CLI proxy
- `/Users/grantjwylie/engie/services/router.mjs` — Smart routing (Claude/Gemini/Ollama)
- `/Users/grantjwylie/engie/services/tool-loop.mjs` — Agentic tool execution loop
- `/Users/grantjwylie/engie/services/tools.mjs` — Tool definitions and executors
- `/Users/grantjwylie/engie/services/telegram-bridge.mjs` — Telegram integration
- `/Users/grantjwylie/engie/services/activity-server.mjs` — Activity ledger
- `/Users/grantjwylie/engie/services/ollama-proxy.mjs` — Ollama capture proxy
- `/Users/grantjwylie/engie/services/watchdog.mjs` — Self-healing monitor
- `/Users/grantjwylie/engie/services/session-store.mjs` — SQLite session persistence
- `/Users/grantjwylie/engie/services/shared-invoke.mjs` — Claude CLI invocation utilities
- `/Users/grantjwylie/engie/services/response-validator.mjs` — Hallucination detection
- `/Users/grantjwylie/engie/services/task-runner.mjs` — Long-running task continuation
- `/Users/grantjwylie/engie/services/claude-sessions.mjs` — Interactive Claude session manager
- `/Users/grantjwylie/engie/services/daemon.mjs` — Background autonomous daemon
- `/Users/grantjwylie/engie/services/project-resolver.mjs` — Natural language project matching
- `/Users/grantjwylie/engie/services/mcp-client.mjs` — MCP client for daemon communication
- `/Users/grantjwylie/engie/services/token-utils.mjs` — Token estimation utilities

### Infrastructure Files
- `/Users/grantjwylie/engie/services/install-services.sh` — Launchd service installer
- `/Users/grantjwylie/engie/services/start-gateway.sh` — Gateway startup wrapper
- `/Users/grantjwylie/engie/services/start-proxy.sh` — Proxy startup wrapper
- `/Users/grantjwylie/engie/services/start-tunnel.sh` — Cloudflare tunnel startup
- `/Users/grantjwylie/engie/setup.sh` — Bootstrap installer
- `/Users/grantjwylie/engie/.github/workflows/release.yml` — Release automation
- `/Users/grantjwylie/engie/Formula/familiar.rb` — Homebrew formula

### Config Files
- `/Users/grantjwylie/engie/config/familiar.json` — Main config (gateway, providers, agents)
- `/Users/grantjwylie/engie/config/.env` — Secrets (API keys, tokens)
- `/Users/grantjwylie/engie/config/mcp-tools.json` — MCP server definitions
- `/Users/grantjwylie/engie/config/projects.json` — Project directory mappings
- `/Users/grantjwylie/engie/config/IDENTITY.md` — AI identity document (needs rewrite)
- `/Users/grantjwylie/engie/config/HEARTBEAT.md` — Heartbeat check instructions

### Brain Files
- `/Users/grantjwylie/engie/brain/learner.mjs` — Daily learning cycle
- `/Users/grantjwylie/engie/brain/hands/runner.mjs` — Hand phase executor
- `/Users/grantjwylie/engie/brain/hands/scheduler.mjs` — Hand cron scheduler
- `/Users/grantjwylie/engie/brain/hands/registry.mjs` — Hand manifest loader
- `/Users/grantjwylie/engie/brain/hands/schema.mjs` — Hand manifest schema
- `/Users/grantjwylie/engie/brain/rag/index.mjs` — RAG search
- `/Users/grantjwylie/engie/brain/rag/ingest.mjs` — RAG ingestion
- `/Users/grantjwylie/engie/brain/rag/graph.mjs` — Knowledge graph

### Forge/Trainer Files
- `/Users/grantjwylie/engie/trainer/forge-auto.mjs` — Auto-trainer daemon
- `/Users/grantjwylie/engie/trainer/forge-cli.mjs` — Forge CLI
- `/Users/grantjwylie/engie/trainer/forge-db.js` — Forge SQLite database
- `/Users/grantjwylie/engie/trainer/classify.mjs` — Task classifier
- `/Users/grantjwylie/engie/trainer/collector.mjs` — Training pair collector
- `/Users/grantjwylie/engie/trainer/mine-ground-truth.mjs` — GitHub PR miner
- `/Users/grantjwylie/engie/trainer/mine-expanded.mjs` — Expanded data miner
- `/Users/grantjwylie/engie/trainer/serve.mjs` — Model serving API
- `/Users/grantjwylie/engie/trainer/scripts/train.py` — Training script
- `/Users/grantjwylie/engie/trainer/scripts/evaluate.py` — Evaluation script
- `/Users/grantjwylie/engie/trainer/scripts/prepare-data.py` — Data preparation
- `/Users/grantjwylie/engie/trainer/scripts/fuse-and-deploy.py` — Model fusion and deployment

### App Files
- `/Users/grantjwylie/engie/apps/cli/bin/familiar.mjs` — CLI entry point
- `/Users/grantjwylie/engie/apps/cli/package.json` — CLI package definition
- `/Users/grantjwylie/engie/apps/web/packages/web/package.json` — Web app package
- `/Users/grantjwylie/engie/apps/web/packages/core/package.json` — Core library package
- `/Users/grantjwylie/engie/daemon/Cargo.toml` — Rust daemon config
- `/Users/grantjwylie/engie/daemon/src/main.rs` — Daemon entry point
- `/Users/grantjwylie/engie/apps/terminal/Cargo.toml` — Rust terminal config
- `/Users/grantjwylie/engie/apps/tray/Cargo.toml` — Rust tray config
- `/Users/grantjwylie/engie/mcp-bridge/index.mjs` — MCP bridge entry point

#!/bin/bash
set -euo pipefail

# Install all Familiar services as macOS launchd agents.
#
# Usage:
#   ./scripts/install-services.sh              # install all services
#   ./scripts/install-services.sh uninstall    # stop and remove all
#   ./scripts/install-services.sh status       # show service status
#
# Services installed:
#   com.familiar.gateway          — WebSocket gateway (port 18789)
#   com.familiar.claude-proxy     — Claude Code proxy (port 18791)
#   com.familiar.tunnel           — Cloudflare quick tunnel
#   com.familiar.ollama-proxy     — Ollama proxy (port 11435)
#   com.familiar.activity-sync    — Activity server (port 18790)
#   com.familiar.telegram-bridge  — Telegram bot bridge
#   com.familiar.telegram-push    — Telegram push notifier (every 30 min)
#   com.familiar.forge-auto       — Auto-trainer daemon
#   com.familiar.forge-mine       — Ground-truth data miner (daily 4 AM)
#   com.familiar.caffeinate       — Prevent sleep (always-on brain)
#   com.familiar.watchdog         — Self-healing monitor (every 5 min)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LA_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/.familiar/logs"
DOMAIN_TARGET="gui/$(id -u)"

ACTION="${1:-install}"

# Source config/.env for tokens used by services (e.g. TELEGRAM_BOT_TOKEN)
ENV_FILE="$PROJECT_DIR/config/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

mkdir -p "$LA_DIR" "$LOG_DIR"

# All service labels
SERVICES=(
  "com.familiar.gateway"
  "com.familiar.claude-proxy"
  "com.familiar.tunnel"
  "com.familiar.ollama-proxy"
  "com.familiar.activity-sync"
  "com.familiar.telegram-bridge"
  "com.familiar.telegram-push"
  "com.familiar.forge-auto"
  "com.familiar.forge-mine"
  "com.familiar.learner"
  "com.familiar.caffeinate"
  "com.familiar.watchdog"
)

# Old service labels to clean up
OLD_SERVICES=(
  "com.engie.gateway"
  "com.engie.claude-proxy"
  "com.engie.cloudflare-tunnel"
  "com.engie.ollama-proxy"
  "com.engie.activity-sync"
  "com.engie.telegram-bridge"
  "com.engie.telegram-push"
  "com.engie.forge-auto"
  "com.engie.forge-mine"
  "com.engie.caffeinate"
  "com.cozyterm.gateway"
  "com.cozyterm.claude-proxy"
  "com.cozyterm.telegram-bridge"
  "com.cozyterm.activity-sync"
  "com.cozyterm.post-session-summary"
)

generate_plist() {
  local label="$1"
  local file="$LA_DIR/$label.plist"

  case "$label" in
    com.familiar.gateway)
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/start-gateway.sh</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$LOG_DIR/gateway.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/gateway.err.log</string>
    <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key><string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST
      ;;

    com.familiar.claude-proxy)
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/bun</string>
        <string>claude-code-proxy.mjs</string>
    </array>
    <key>WorkingDirectory</key><string>$SCRIPT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CLAUDE_PROXY_PORT</key><string>18791</string>
        <key>CLAUDE_PROXY_MODEL</key><string>sonnet</string>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>FAMILIAR_TRAINING_MODE</key><string>true</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$LOG_DIR/claude-proxy.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/claude-proxy.error.log</string>
    <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
PLIST
      ;;

    com.familiar.tunnel)
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/start-tunnel.sh</string>
    </array>
    <key>WorkingDirectory</key><string>$HOME/wyliewhimsyco</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>FAMILIAR_PROXY_PORT</key><string>18791</string>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key><string>$HOME</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$LOG_DIR/tunnel-launchd.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/tunnel-launchd.error.log</string>
    <key>ThrottleInterval</key><integer>30</integer>
</dict>
</plist>
PLIST
      ;;

    com.familiar.ollama-proxy)
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/bun</string>
        <string>run</string>
        <string>ollama-proxy.mjs</string>
    </array>
    <key>WorkingDirectory</key><string>$SCRIPT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OLLAMA_PROXY_PORT</key><string>11435</string>
        <key>OLLAMA_URL</key><string>http://localhost:11434</string>
        <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$LOG_DIR/ollama-proxy.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/ollama-proxy.error.log</string>
    <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
PLIST
      ;;

    com.familiar.activity-sync)
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/bun</string>
        <string>run</string>
        <string>activity-server.mjs</string>
    </array>
    <key>WorkingDirectory</key><string>$SCRIPT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>ACTIVITY_PORT</key><string>18790</string>
        <key>ACTIVITY_BIND</key><string>0.0.0.0</string>
        <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$LOG_DIR/activity-sync.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/activity-sync.error.log</string>
    <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
PLIST
      ;;

    com.familiar.telegram-bridge)
      local BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
      if [ -z "$BOT_TOKEN" ]; then
        echo "  WARN: TELEGRAM_BOT_TOKEN not set, telegram-bridge may not start"
      fi
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/bun</string>
        <string>run</string>
        <string>$SCRIPT_DIR/telegram-bridge.mjs</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>HOME</key><string>$HOME</string>
        <key>TELEGRAM_BOT_TOKEN</key><string>$BOT_TOKEN</string>
        <key>TG_BRIDGE_ALLOW_ALL</key><string>1</string>
    </dict>
    <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$LOG_DIR/telegram-bridge.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/telegram-bridge.error.log</string>
</dict>
</plist>
PLIST
      ;;

    com.familiar.telegram-push)
      local PUSH_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
      local PUSH_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/bun</string>
        <string>run</string>
        <string>$PROJECT_DIR/cron/telegram-push.mjs</string>
    </array>
    <key>StartInterval</key><integer>1800</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>HOME</key><string>$HOME</string>
        <key>TELEGRAM_BOT_TOKEN</key><string>$PUSH_BOT_TOKEN</string>
        <key>TELEGRAM_CHAT_ID</key><string>$PUSH_CHAT_ID</string>
    </dict>
    <key>RunAtLoad</key><false/>
    <key>StandardOutPath</key><string>$LOG_DIR/telegram-push.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/telegram-push.error.log</string>
    <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
</dict>
</plist>
PLIST
      ;;

    com.familiar.forge-auto)
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/bun</string>
        <string>$PROJECT_DIR/trainer/forge-auto.mjs</string>
        <string>--threshold</string>
        <string>100</string>
        <string>--interval</string>
        <string>300</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$LOG_DIR/forge-auto.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/forge-auto.err.log</string>
    <key>WorkingDirectory</key><string>$PROJECT_DIR/trainer</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key><string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST
      ;;

    com.familiar.forge-mine)
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>/opt/homebrew/bin/bun $PROJECT_DIR/trainer/mine-ground-truth.mjs 2>&amp;1; /opt/homebrew/bin/bun $PROJECT_DIR/trainer/mine-expanded.mjs 2>&amp;1</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key><integer>4</integer>
        <key>Minute</key><integer>0</integer>
    </dict>
    <key>StandardOutPath</key><string>$LOG_DIR/forge-mine.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/forge-mine.err.log</string>
    <key>WorkingDirectory</key><string>$PROJECT_DIR/trainer</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key><string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST
      ;;

    com.familiar.learner)
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/bun</string>
        <string>$PROJECT_DIR/brain/learner.mjs</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key><integer>5</integer>
        <key>Minute</key><integer>0</integer>
    </dict>
    <key>StandardOutPath</key><string>$LOG_DIR/learner.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/learner.err.log</string>
    <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key><string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST
      ;;

    com.familiar.caffeinate)
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-dis</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>
PLIST
      ;;

    com.familiar.watchdog)
      cat > "$file" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/bun</string>
        <string>$SCRIPT_DIR/watchdog.mjs</string>
    </array>
    <key>StartInterval</key><integer>300</integer>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>$LOG_DIR/watchdog.log</string>
    <key>StandardErrorPath</key><string>$LOG_DIR/watchdog.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key><string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST
      ;;
  esac
}

install_all() {
  echo ""
  echo "  Familiar — Service Installer"
  echo ""

  # Remove old services first
  echo "  Cleaning old services..."
  for svc in "${OLD_SERVICES[@]}"; do
    launchctl bootout "$DOMAIN_TARGET/$svc" 2>/dev/null || true
    rm -f "$LA_DIR/$svc.plist"
  done

  # Generate and install new services
  echo "  Installing com.familiar.* services..."
  for svc in "${SERVICES[@]}"; do
    generate_plist "$svc"
    launchctl bootstrap "$DOMAIN_TARGET" "$LA_DIR/$svc.plist" 2>/dev/null || true
    echo "    + $svc"
  done

  # Configure OpenCode if installed
  if command -v opencode &>/dev/null; then
    local OC_DIR="$HOME/.config/opencode"
    local OC_CFG="$OC_DIR/opencode.json"
    if [ ! -f "$OC_CFG" ]; then
      mkdir -p "$OC_DIR"
      cat > "$OC_CFG" <<'OCJSON'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "claude-sub/claude-subscription",
  "provider": {
    "claude-sub": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Claude Subscription",
      "options": {
        "baseURL": "http://localhost:18791/v1"
      },
      "models": {
        "claude-subscription": {
          "name": "Claude (via Familiar)",
          "limit": {
            "context": 200000,
            "output": 65536
          }
        }
      }
    }
  }
}
OCJSON
      echo "    + OpenCode config written to $OC_CFG"
    fi
    echo ""
    echo "  OpenCode configured — run 'opencode' in any project to use your"
    echo "  Claude subscription with local fallback."
  fi

  echo ""
  echo "  All services installed."
  echo "  Logs: $LOG_DIR/"
  echo "  Status: launchctl list | grep familiar"
  echo ""
}

uninstall_all() {
  echo ""
  echo "  Removing all com.familiar.* services..."
  for svc in "${SERVICES[@]}"; do
    launchctl bootout "$DOMAIN_TARGET/$svc" 2>/dev/null || true
    rm -f "$LA_DIR/$svc.plist"
    echo "    - $svc"
  done
  echo "  Done."
  echo ""
}

show_status() {
  echo ""
  echo "  Familiar Services"
  echo ""
  launchctl list 2>/dev/null | head -1
  launchctl list 2>/dev/null | grep familiar || echo "  (no services running)"
  echo ""
}

case "$ACTION" in
  install)  install_all ;;
  uninstall) uninstall_all ;;
  status)   show_status ;;
  *)
    echo "Usage: $0 [install|uninstall|status]"
    exit 1
    ;;
esac

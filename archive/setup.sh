#!/bin/bash
set -euo pipefail

# Engie Setup Script
# Run this to bootstrap the Docker environment on Mac or Ubuntu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Engie Setup ==="
echo "Project dir: $PROJECT_DIR"
echo ""

# ─── 1. Check Docker ───────────────────────────────────────────
check_docker() {
  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    echo "✓ Docker is running"
    return 0
  fi

  echo "Docker is not installed or not running."
  echo ""

  if [[ "$(uname)" == "Darwin" ]]; then
    echo "On macOS, install Docker Desktop or OrbStack:"
    echo ""
    echo "  Option A (OrbStack — lighter, recommended for Mac):"
    echo "    brew install orbstack"
    echo "    # Then open OrbStack from Applications"
    echo ""
    echo "  Option B (Docker Desktop):"
    echo "    brew install --cask docker"
    echo "    # Then open Docker from Applications"
    echo ""
  else
    echo "On Ubuntu, install Docker Engine:"
    echo ""
    echo "  curl -fsSL https://get.docker.com | sh"
    echo "  sudo usermod -aG docker \$USER"
    echo "  newgrp docker"
    echo ""
  fi

  echo "After installing, run this script again."
  exit 1
}

# ─── 2. Create .env from template ──────────────────────────────
setup_env() {
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    echo "✓ .env file exists"
    return 0
  fi

  echo "Creating .env from template..."
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"

  # Generate gateway token
  TOKEN=$(openssl rand -hex 32)
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s/^OPENCLAW_GATEWAY_TOKEN=$/OPENCLAW_GATEWAY_TOKEN=$TOKEN/" "$PROJECT_DIR/.env"
  else
    sed -i "s/^OPENCLAW_GATEWAY_TOKEN=$/OPENCLAW_GATEWAY_TOKEN=$TOKEN/" "$PROJECT_DIR/.env"
  fi

  echo "✓ .env created with gateway token"
  echo ""
  echo "  IMPORTANT: Edit .env and fill in your API keys:"
  echo "    $PROJECT_DIR/.env"
  echo ""
  echo "  Required for basic operation:"
  echo "    - ANTHROPIC_API_KEY"
  echo ""
  echo "  Required for channels:"
  echo "    - SLACK_APP_TOKEN + SLACK_BOT_TOKEN (for Slack)"
  echo "    - TELEGRAM_BOT_TOKEN (for Telegram)"
  echo ""
  echo "  Required for skills:"
  echo "    - GITHUB_TOKEN (for GitHub manager)"
  echo "    - JIRA_EMAIL + JIRA_API_TOKEN (for Jira tracker)"
  echo ""
}

# ─── 3. Fix volume permissions ──────────────────────────────────
fix_permissions() {
  echo "Setting volume permissions (UID 1000 for node user)..."

  # Create dirs if missing
  mkdir -p "$PROJECT_DIR/config" "$PROJECT_DIR/workspace" "$PROJECT_DIR/memory" "$PROJECT_DIR/cron"

  # On Linux, chown to 1000:1000 (node user in container)
  if [[ "$(uname)" == "Linux" ]]; then
    if [[ "$(id -u)" -ne 1000 ]]; then
      echo "  Running chown (may need sudo)..."
      sudo chown -R 1000:1000 "$PROJECT_DIR/config" "$PROJECT_DIR/workspace" "$PROJECT_DIR/memory" "$PROJECT_DIR/cron"
    fi
  fi

  echo "✓ Permissions set"
}

# ─── 4. Build the image ────────────────────────────────────────
build_image() {
  echo "Building Engie Docker image (this takes a few minutes the first time)..."
  cd "$PROJECT_DIR"
  docker compose build engie
  echo "✓ Image built"
}

# ─── 5. Pull Ollama model ──────────────────────────────────────
pull_ollama_model() {
  echo "Starting Ollama and pulling llama3.2..."
  cd "$PROJECT_DIR"
  docker compose up -d ollama
  sleep 5
  docker compose exec ollama ollama pull llama3.2
  echo "✓ Ollama ready with llama3.2"
}

# ─── 6. Detect and configure Claude Code ─────────────────────
setup_claude_code() {
  echo ""
  echo "── Claude Code Integration ──"

  if ! command -v claude &>/dev/null; then
    echo "  Claude Code CLI not found (optional)."
    echo ""
    echo "  To enable the heavy-brain backend later:"
    echo "    npm install -g @anthropic-ai/claude-code"
    echo "    claude auth"
    echo "    $SCRIPT_DIR/install-proxy-service.sh"
    echo ""
    return 0
  fi

  local CLAUDE_VERSION
  CLAUDE_VERSION="$(CLAUDECODE= claude --version 2>/dev/null || echo 'unknown')"
  echo "  ✓ Claude Code found: $CLAUDE_VERSION"

  # Install MCP bridge dependencies if needed
  if [[ ! -d "$PROJECT_DIR/mcp-bridge/node_modules" ]]; then
    echo "  Installing MCP bridge dependencies..."
    cd "$PROJECT_DIR/mcp-bridge"
    npm install --silent
    cd "$PROJECT_DIR"
  fi
  echo "  ✓ MCP bridge dependencies installed"

  # Configure Claude Code to know about the Engie MCP bridge
  local CLAUDE_SETTINGS_DIR="$HOME/.claude"
  local CLAUDE_SETTINGS="$CLAUDE_SETTINGS_DIR/settings.json"

  mkdir -p "$CLAUDE_SETTINGS_DIR"

  if [[ -f "$CLAUDE_SETTINGS" ]]; then
    # Check if engie MCP is already configured
    if grep -q "engie" "$CLAUDE_SETTINGS" 2>/dev/null; then
      echo "  ✓ Engie MCP bridge already in Claude Code settings"
    else
      echo "  Adding Engie MCP bridge to Claude Code settings..."
      echo ""
      echo "  To manually add the Engie MCP server to Claude Code, run:"
      echo "    claude mcp add engie node $PROJECT_DIR/mcp-bridge/index.mjs"
      echo ""
    fi
  else
    echo "  Creating Claude Code settings with Engie MCP bridge..."
    echo ""
    echo "  Run this to register the MCP server:"
    echo "    claude mcp add engie node $PROJECT_DIR/mcp-bridge/index.mjs"
    echo ""
  fi

  # Offer to install the proxy service
  echo ""
  read -p "  Install Claude Code Proxy as a background service? (Y/n) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    bash "$SCRIPT_DIR/install-proxy-service.sh"
  else
    echo "  Skipped. You can start it manually later:"
    echo "    $SCRIPT_DIR/start-proxy.sh"
    echo "  Or install as a service:"
    echo "    $SCRIPT_DIR/install-proxy-service.sh"
  fi
}

# ─── 7. Start everything ───────────────────────────────────────
start_services() {
  echo "Starting Engie..."
  cd "$PROJECT_DIR"
  docker compose up -d
  echo ""
  echo "✓ Engie is running!"
  echo ""
  echo "  Gateway:        http://localhost:18789"
  echo "  Ollama:         http://localhost:11434"
  echo "  Claude Proxy:   http://localhost:18791 (if installed)"
  echo ""
  echo "  Useful commands:"
  echo "    docker compose logs -f engie          # Watch Engie logs"
  echo "    docker compose --profile cli run --rm engie-cli gateway status"
  echo "    docker compose --profile cli run --rm engie-cli channels add --channel telegram"
  echo "    docker compose --profile cli run --rm engie-cli channels login"
  echo "    docker compose down                    # Stop everything"
  echo "    docker compose up -d                   # Start everything"
  echo ""
}

# ─── Run ────────────────────────────────────────────────────────
main() {
  check_docker
  setup_env
  fix_permissions

  # Check if .env has required keys filled in
  if grep -q "^ANTHROPIC_API_KEY=$" "$PROJECT_DIR/.env"; then
    echo ""
    echo "⚠  ANTHROPIC_API_KEY is empty in .env"
    echo "   Fill it in, then run: cd $PROJECT_DIR && docker compose up -d"
    echo ""
    read -p "Continue building anyway? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Edit .env first, then run this script again."
      exit 0
    fi
  fi

  build_image
  pull_ollama_model
  setup_claude_code
  start_services
}

main "$@"

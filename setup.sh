#!/usr/bin/env bash
# Familiar setup — bootstrap from a fresh clone.
#
#   git clone https://github.com/engindearing-projects/engie.git ~/familiar
#   cd ~/familiar && ./setup.sh
#
# Installs dependencies, links the CLI globally, and launches the setup wizard.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

info() { echo -e "${CYAN}info${RESET} $1"; }
ok()   { echo -e "${GREEN} ok ${RESET} $1"; }
err()  { echo -e "${RED}error${RESET} $1" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 1. Check for Bun ────────────────────────────────────────────────────────

if command -v bun &>/dev/null; then
  ok "Bun $(bun --version) found"
else
  info "Bun not found — installing via Homebrew..."
  if ! command -v brew &>/dev/null; then
    err "Homebrew is required to install Bun. Install it from https://brew.sh then re-run this script."
  fi
  brew install oven-sh/bun/bun
  ok "Bun installed"
fi

# ── 2. Install dependencies ─────────────────────────────────────────────────

info "Installing CLI dependencies..."
(cd "$SCRIPT_DIR/apps/cli" && bun install)
ok "apps/cli dependencies installed"

if [ -f "$SCRIPT_DIR/mcp-bridge/package.json" ]; then
  info "Installing MCP bridge dependencies..."
  (cd "$SCRIPT_DIR/mcp-bridge" && npm install --silent 2>/dev/null || bun install)
  ok "mcp-bridge dependencies installed"
fi

# ── 3. Link global command ──────────────────────────────────────────────────

info "Linking 'familiar' command globally..."
(cd "$SCRIPT_DIR/apps/cli" && npm link 2>/dev/null) || true

if command -v familiar &>/dev/null; then
  ok "'familiar' is on your PATH"
else
  # Fallback: try bun link
  (cd "$SCRIPT_DIR/apps/cli" && bun link 2>/dev/null) || true
  if command -v familiar &>/dev/null; then
    ok "'familiar' is on your PATH"
  else
    echo ""
    info "Could not auto-link. Run manually:"
    echo -e "  ${DIM}cd $SCRIPT_DIR/apps/cli && npm link${RESET}"
    echo ""
  fi
fi

# ── 4. Launch wizard ────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}Setup complete. Launching the setup wizard...${RESET}"
echo -e "${DIM}The wizard will configure services, API keys, and integrations.${RESET}"
echo ""

if command -v familiar &>/dev/null; then
  familiar init
else
  (cd "$SCRIPT_DIR/apps/cli" && bun run bin/familiar.mjs init)
fi

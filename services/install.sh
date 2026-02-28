#!/usr/bin/env bash
# Familiar installer — curl -fsSL https://familiar.run/install | bash
#
# Installs the familiar CLI binary to ~/.local/bin/familiar
# Supports macOS (arm64, x64)

set -euo pipefail

REPO="engindearing-projects/engie"
INSTALL_DIR="${FAMILIAR_INSTALL_DIR:-$HOME/.local/bin}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

info() { echo -e "${CYAN}info${RESET} $1"; }
ok() { echo -e "${GREEN}ok${RESET} $1"; }
err() { echo -e "${RED}error${RESET} $1" >&2; exit 1; }

# Detect OS and architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) OS="macos" ;;
  linux) OS="linux" ;;
  *) err "Unsupported OS: $OS" ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64) ARCH="x64" ;;
  *) err "Unsupported architecture: $ARCH" ;;
esac

info "Detected ${OS}-${ARCH}"

# Get latest release version
info "Fetching latest release..."
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | sed 's/.*"v\(.*\)".*/\1/')

if [ -z "$LATEST" ]; then
  err "Could not determine latest version. Check https://github.com/${REPO}/releases"
fi

info "Latest version: v${LATEST}"

# Download binary
ASSET="familiar-${LATEST}-${OS}-${ARCH}.tar.gz"
URL="https://github.com/${REPO}/releases/download/v${LATEST}/${ASSET}"

info "Downloading ${ASSET}..."
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

curl -fsSL "$URL" -o "${TMP_DIR}/${ASSET}" || err "Download failed. Asset may not exist for ${OS}-${ARCH}"

# Extract
info "Extracting..."
tar -xzf "${TMP_DIR}/${ASSET}" -C "$TMP_DIR"

# Install
mkdir -p "$INSTALL_DIR"
BINARY=$(find "$TMP_DIR" -name "familiar-*" -type f | head -1)

if [ -z "$BINARY" ]; then
  err "No binary found in archive"
fi

chmod +x "$BINARY"
cp "$BINARY" "${INSTALL_DIR}/familiar"

ok "Installed familiar to ${INSTALL_DIR}/familiar"

# Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -q "^${INSTALL_DIR}$"; then
  echo ""
  info "Add ${INSTALL_DIR} to your PATH:"
  echo ""
  echo -e "  ${DIM}# Add to ~/.zshrc or ~/.bashrc:${RESET}"
  echo -e "  export PATH=\"${INSTALL_DIR}:\$PATH\""
  echo ""
fi

# Verify
if command -v familiar &>/dev/null; then
  ok "$(familiar --version) ready"
else
  info "Run 'export PATH=\"${INSTALL_DIR}:\$PATH\"' then 'familiar' to start"
fi

echo ""
echo -e "${CYAN}Get started:${RESET}"
echo "  familiar init    # Setup wizard"
echo "  familiar         # Start chatting"
echo ""
echo -e "${DIM}The binary is a lightweight gateway client."
echo "For the full stack (gateway, tools, memory, training):"
echo ""
echo "  git clone https://github.com/engindearing-projects/engie.git ~/familiar"
echo -e "  cd ~/familiar && ./setup.sh${RESET}"
echo ""
echo -e "${DIM}familiar.run${RESET}"

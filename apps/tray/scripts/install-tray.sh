#!/usr/bin/env bash
set -euo pipefail

LABEL="com.familiar.tray"
PLIST_SRC="$(cd "$(dirname "$0")/../config" && pwd)/com.familiar.tray.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS_DIR="$HOME/.familiar/logs"
DEFAULT_BIN="$HOME/.local/bin/familiar-tray"

# --- Colors ---------------------------------------------------------------
if [ -t 1 ]; then
    GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; RESET='\033[0m'
else
    GREEN=''; RED=''; YELLOW=''; RESET=''
fi
info()  { printf "${GREEN}  [ok]${RESET} %s\n" "$1"; }
warn()  { printf "${YELLOW}[warn]${RESET} %s\n" "$1"; }
err()   { printf "${RED} [err]${RESET} %s\n" "$1"; }

# --- Usage -----------------------------------------------------------------
usage() {
    echo "Usage: $0 [install|uninstall|status] [--bin PATH]"
    echo ""
    echo "  install    Build (release), install binary + launchd plist, start service"
    echo "  uninstall  Stop service, remove plist"
    echo "  status     Show service status"
    echo ""
    echo "Options:"
    echo "  --bin PATH   Override binary install path (default: $DEFAULT_BIN)"
    exit 1
}

# --- Parse args ------------------------------------------------------------
ACTION="${1:-}"
shift || true
BIN_PATH="$DEFAULT_BIN"

while [ $# -gt 0 ]; do
    case "$1" in
        --bin) BIN_PATH="$2"; shift 2 ;;
        *) usage ;;
    esac
done

[ -z "$ACTION" ] && usage

# --- Install ---------------------------------------------------------------
do_install() {
    echo "Installing familiar-tray..."
    echo ""

    # Build release binary
    REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
    echo "  Building release binary (tray + popover)..."
    (cd "$REPO_ROOT" && cargo build --release --features popover 2>&1 | tail -3)
    BUILT_BIN="$REPO_ROOT/target/release/familiar-tray"
    if [ ! -f "$BUILT_BIN" ]; then
        err "Build failed — $BUILT_BIN not found"
        exit 1
    fi
    info "Built $BUILT_BIN"

    # Install binary
    mkdir -p "$(dirname "$BIN_PATH")"
    cp "$BUILT_BIN" "$BIN_PATH"
    chmod +x "$BIN_PATH"
    info "Installed binary to $BIN_PATH"

    # Ensure logs dir
    mkdir -p "$LOGS_DIR"

    # Stop existing service if running
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

    # Generate plist from template
    if [ ! -f "$PLIST_SRC" ]; then
        err "Template plist not found at $PLIST_SRC"
        exit 1
    fi

    sed \
        -e "s|__BINARY_PATH__|$BIN_PATH|g" \
        -e "s|__HOME__|$HOME|g" \
        "$PLIST_SRC" > "$PLIST_DST"
    info "Installed plist to $PLIST_DST"

    # Load and start
    launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
    info "Service loaded and started"
    echo ""
    echo "  familiar-tray is now running and will auto-start on login."
    echo "  Logs: $LOGS_DIR/tray.err.log"
}

# --- Uninstall -------------------------------------------------------------
do_uninstall() {
    echo "Uninstalling familiar-tray..."
    echo ""

    # Stop and remove service
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && \
        info "Service stopped" || warn "Service was not running"

    # Remove plist
    if [ -f "$PLIST_DST" ]; then
        rm "$PLIST_DST"
        info "Removed $PLIST_DST"
    else
        warn "Plist not found at $PLIST_DST"
    fi

    # Don't remove binary — user may want to keep it
    echo ""
    echo "  Service removed. Binary left at $BIN_PATH (delete manually if desired)."
}

# --- Status ----------------------------------------------------------------
do_status() {
    echo "familiar-tray service status:"
    echo ""
    if launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null; then
        echo ""
        info "Service is loaded"
    else
        warn "Service is not loaded"
    fi

    if pgrep -f "familiar-tray" >/dev/null 2>&1; then
        info "Process is running (pid: $(pgrep -f familiar-tray | head -1))"
    else
        warn "Process is not running"
    fi

    if [ -f "$BIN_PATH" ]; then
        info "Binary exists at $BIN_PATH"
    else
        warn "Binary not found at $BIN_PATH"
    fi
}

# --- Dispatch --------------------------------------------------------------
case "$ACTION" in
    install)   do_install ;;
    uninstall) do_uninstall ;;
    status)    do_status ;;
    *)         usage ;;
esac

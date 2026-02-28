#!/usr/bin/env bash
# familiar-lib.sh — Shared utilities for familiar scripts
# Source this file: . "$(dirname "$0")/familiar-lib.sh"

set -euo pipefail

# ── Colors (auto-disable when not a tty) ──────────────────────────────────────

if [ -t 1 ]; then
    BOLD='\033[1m'
    DIM='\033[2m'
    GREEN='\033[32m'
    YELLOW='\033[33m'
    RED='\033[31m'
    CYAN='\033[36m'
    RESET='\033[0m'
else
    BOLD='' DIM='' GREEN='' YELLOW='' RED='' CYAN='' RESET=''
fi

info()  { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${RESET} %s\n" "$*"; }
error() { printf "${RED}✗${RESET} %s\n" "$*" >&2; }
step()  { printf "\n${BOLD}  %s${RESET}\n  %s\n" "$1" "$(printf '─%.0s' $(seq 1 ${#1}))"; }

# ── Daemon binary location ────────────────────────────────────────────────────

find_daemon_bin() {
    # Check common locations
    local candidates=(
        "$HOME/.local/bin/familiar-daemon"
        "$(command -v familiar-daemon 2>/dev/null || true)"
        "$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)/target/release/familiar-daemon"
    )
    for c in "${candidates[@]}"; do
        if [ -n "$c" ] && [ -x "$c" ]; then
            # Always return absolute path
            echo "$(cd "$(dirname "$c")" && pwd)/$(basename "$c")"
            return 0
        fi
    done
    # Default install path
    echo "$HOME/.local/bin/familiar-daemon"
    return 0
}

# ── JSON tool detection ───────────────────────────────────────────────────────

_JSON_TOOL=""

ensure_json_tool() {
    if [ -n "$_JSON_TOOL" ]; then return 0; fi
    if command -v jq >/dev/null 2>&1; then
        _JSON_TOOL="jq"
    elif command -v python3 >/dev/null 2>&1; then
        _JSON_TOOL="python3"
    else
        error "Neither jq nor python3 found. Install one to continue."
        return 1
    fi
}

# ── Safe JSON merge ──────────────────────────────────────────────────────────
# json_merge_mcp_server <file> <server_key> <daemon_path> <format>
#   format: "standard" | "opencode" | "continue"
#   - Creates file if missing
#   - Backs up existing file
#   - Merges server entry without touching other keys
#   - Skips if JSON is malformed

json_merge_mcp_server() {
    local file="$1" server_key="$2" daemon_path="$3" format="${4:-standard}"

    ensure_json_tool

    # Expand ~ in daemon_path
    daemon_path="${daemon_path/#\~/$HOME}"

    # Build the server entry JSON based on format
    local entry
    case "$format" in
        opencode)
            entry=$(cat <<ENTRY
{"type":"local","command":["${daemon_path}"],"environment":{"RUST_LOG":"info"},"enabled":true}
ENTRY
            )
            ;;
        continue)
            # Continue uses a standalone file, not a merge
            mkdir -p "$(dirname "$file")"
            cat > "$file" <<CONT
{
  "command": "${daemon_path}",
  "args": [],
  "env": {
    "RUST_LOG": "info"
  }
}
CONT
            info "Created $file"
            return 0
            ;;
        *)
            entry=$(cat <<ENTRY
{"command":"${daemon_path}","args":[],"env":{"RUST_LOG":"info"}}
ENTRY
            )
            ;;
    esac

    # If file doesn't exist, create minimal structure
    if [ ! -f "$file" ]; then
        mkdir -p "$(dirname "$file")"
        if [ "$format" = "opencode" ]; then
            printf '{"mcp":{"%s":%s}}' "$server_key" "$entry" > "$file"
        else
            printf '{"mcpServers":{"%s":%s}}' "$server_key" "$entry" > "$file"
        fi
        info "Created $file"
        return 0
    fi

    # Validate existing JSON
    if ! _json_validate "$file"; then
        warn "Skipping $file — malformed JSON"
        return 1
    fi

    # Check if server entry already exists
    if _json_has_key "$file" "$server_key" "$format"; then
        return 2  # Signal: already exists
    fi

    # Back up existing file
    local backup="${file}.bak.$(date +%s)"
    cp "$file" "$backup"

    # Merge
    if [ "$_JSON_TOOL" = "jq" ]; then
        _json_merge_jq "$file" "$server_key" "$entry" "$format"
    else
        _json_merge_python "$file" "$server_key" "$entry" "$format"
    fi

    info "Updated $file (backed up to $backup)"
    return 0
}

_json_validate() {
    local file="$1"
    if [ "$_JSON_TOOL" = "jq" ]; then
        jq empty "$file" 2>/dev/null
    else
        python3 -c "import json; json.load(open('$file'))" 2>/dev/null
    fi
}

_json_has_key() {
    local file="$1" key="$2" format="$3"
    local path
    if [ "$format" = "opencode" ]; then
        path=".mcp.\"$key\""
    else
        path=".mcpServers.\"$key\""
    fi

    if [ "$_JSON_TOOL" = "jq" ]; then
        jq -e "$path" "$file" >/dev/null 2>&1
    else
        python3 -c "
import json, sys
d = json.load(open('$file'))
parts = '$path'.replace('\"', '').split('.')[1:]
for p in parts:
    if not isinstance(d, dict) or p not in d:
        sys.exit(1)
    d = d[p]
" 2>/dev/null
    fi
}

_json_merge_jq() {
    local file="$1" key="$2" entry="$3" format="$4"
    local parent
    if [ "$format" = "opencode" ]; then
        parent="mcp"
    else
        parent="mcpServers"
    fi

    local tmp
    tmp=$(mktemp)
    jq --argjson entry "$entry" ".\"$parent\".\"$key\" = \$entry" "$file" > "$tmp" && mv "$tmp" "$file"
}

_json_merge_python() {
    local file="$1" key="$2" entry="$3" format="$4"
    local parent
    if [ "$format" = "opencode" ]; then
        parent="mcp"
    else
        parent="mcpServers"
    fi

    python3 -c "
import json
with open('$file') as f:
    data = json.load(f)
if '$parent' not in data:
    data['$parent'] = {}
data['$parent']['$key'] = json.loads('$entry')
with open('$file', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"
}

# ── Tool detection ────────────────────────────────────────────────────────────
# Each returns 0 (detected) or 1 (not found)

detect_claude_code() {
    [ -d "$HOME/.claude" ] || command -v claude >/dev/null 2>&1
}

detect_claude_desktop() {
    [ -d "/Applications/Claude.app" ]
}

detect_cursor() {
    [ -d "/Applications/Cursor.app" ] || [ -d "$HOME/.cursor" ]
}

detect_windsurf() {
    [ -d "/Applications/Windsurf.app" ] || [ -d "$HOME/.codeium/windsurf" ]
}

detect_vscode_continue() {
    [ -d "$HOME/.continue" ]
}

detect_opencode() {
    command -v opencode >/dev/null 2>&1 || [ -d "$HOME/.config/opencode" ]
}

# ── Tool config paths ────────────────────────────────────────────────────────

tool_config_path() {
    case "$1" in
        claude_code)      echo "$HOME/.claude/mcp.json" ;;
        claude_desktop)   echo "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
        cursor)           echo "$HOME/.cursor/mcp.json" ;;
        windsurf)         echo "$HOME/.codeium/windsurf/mcp_config.json" ;;
        vscode_continue)  echo "$HOME/.continue/mcpServers/familiar-daemon.json" ;;
        opencode)         echo "$HOME/.config/opencode/opencode.json" ;;
    esac
}

tool_config_format() {
    case "$1" in
        opencode)         echo "opencode" ;;
        vscode_continue)  echo "continue" ;;
        *)                echo "standard" ;;
    esac
}

# Tool display names
tool_display_name() {
    case "$1" in
        claude_code)      echo "Claude Code" ;;
        claude_desktop)   echo "Claude Desktop" ;;
        cursor)           echo "Cursor" ;;
        windsurf)         echo "Windsurf" ;;
        vscode_continue)  echo "VS Code + Continue" ;;
        opencode)         echo "OpenCode" ;;
    esac
}

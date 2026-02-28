#!/usr/bin/env bash
# familiar init — Interactive setup wizard
# Usage: bash scripts/familiar-init.sh
#   or:  familiar init  (when installed)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=familiar-lib.sh
. "$SCRIPT_DIR/familiar-lib.sh"

FAMILIAR_DIR="$HOME/.familiar"

# ── All supported tools ───────────────────────────────────────────────────────

ALL_TOOLS=(claude_code claude_desktop cursor windsurf vscode_continue opencode)

# ── Step 1: Name ──────────────────────────────────────────────────────────────

get_name() {
    step "Step 1: Name your familiar"

    local default_name="Familiar"
    # If config already exists, read existing name as default
    if [ -f "$FAMILIAR_DIR/config.toml" ]; then
        local existing
        existing=$(grep '^name' "$FAMILIAR_DIR/config.toml" 2>/dev/null | head -1 | sed 's/.*= *"\(.*\)"/\1/')
        [ -n "$existing" ] && default_name="$existing"
    fi

    printf "  Name [%s]: " "$default_name"
    read -r FAMILIAR_NAME
    FAMILIAR_NAME="${FAMILIAR_NAME:-$default_name}"
}

# ── Step 2: Tool selection ────────────────────────────────────────────────────

select_tools() {
    step "Step 2: Coding tools"

    # Detect which tools are installed
    declare -a detected=()
    declare -a selected=()

    for i in "${!ALL_TOOLS[@]}"; do
        local tool="${ALL_TOOLS[$i]}"
        local name
        name=$(tool_display_name "$tool")
        local idx=$((i + 1))

        if "detect_$tool" 2>/dev/null; then
            detected+=("$i")
            selected+=("$i")
            printf "  %d) ${GREEN}[x]${RESET} %-22s ${DIM}(detected)${RESET}\n" "$idx" "$name"
        else
            printf "  %d) [ ] %s\n" "$idx" "$name"
        fi
    done

    echo ""
    printf "  Enter numbers to toggle, 'all', or enter to accept: "
    read -r toggle_input

    if [ -n "$toggle_input" ]; then
        if [ "$toggle_input" = "all" ]; then
            selected=()
            for i in "${!ALL_TOOLS[@]}"; do
                selected+=("$i")
            done
        else
            # Parse space or comma-separated numbers
            for num in $(echo "$toggle_input" | tr ',' ' '); do
                num=$(echo "$num" | tr -d '[:space:]')
                if [[ "$num" =~ ^[0-9]+$ ]] && [ "$num" -ge 1 ] && [ "$num" -le "${#ALL_TOOLS[@]}" ]; then
                    local idx=$((num - 1))
                    # Toggle: add if missing, remove if present
                    local found=0
                    local new_selected=()
                    for s in "${selected[@]+"${selected[@]}"}"; do
                        if [ "$s" = "$idx" ]; then
                            found=1
                        else
                            new_selected+=("$s")
                        fi
                    done
                    if [ "$found" -eq 0 ]; then
                        new_selected+=("$idx")
                    fi
                    selected=("${new_selected[@]+"${new_selected[@]}"}")
                fi
            done
        fi
    fi

    # Build SELECTED_TOOLS array
    SELECTED_TOOLS=()
    for s in "${selected[@]+"${selected[@]}"}"; do
        SELECTED_TOOLS+=("${ALL_TOOLS[$s]}")
    done

    if [ "${#SELECTED_TOOLS[@]}" -eq 0 ]; then
        warn "No tools selected. You can re-run this wizard later."
    fi
}

# ── Step 3: Capabilities ─────────────────────────────────────────────────────

configure_capabilities() {
    step "Step 3: Capabilities"

    printf "  All 17 capability groups enabled by default.\n"
    printf "  Customize later: %s/daemon/permissions.toml\n" "$FAMILIAR_DIR"
    printf "  Enable all? [Y/n]: "
    read -r caps_answer
    caps_answer="${caps_answer:-Y}"
    ENABLE_ALL_CAPS=true
    if [[ "$caps_answer" =~ ^[Nn] ]]; then
        ENABLE_ALL_CAPS=false
    fi
}

# ── Step 4: Confirm & Execute ─────────────────────────────────────────────────

confirm_and_execute() {
    local daemon_bin
    daemon_bin=$(find_daemon_bin)

    step "Step 4: Confirm"

    printf "  Name:    %s\n" "$FAMILIAR_NAME"
    printf "  Binary:  %s\n" "$daemon_bin"

    if [ "${#SELECTED_TOOLS[@]}" -gt 0 ]; then
        local tool_names=()
        for t in "${SELECTED_TOOLS[@]}"; do
            tool_names+=("$(tool_display_name "$t")")
        done
        # Join with comma+space
        local IFS=', '
        printf "  Tools:   %s\n" "${tool_names[*]}"
    else
        printf "  Tools:   (none)\n"
    fi

    echo ""
    printf "  Proceed? [Y/n]: "
    read -r proceed
    proceed="${proceed:-Y}"
    if [[ "$proceed" =~ ^[Nn] ]]; then
        echo "  Cancelled."
        exit 0
    fi

    echo ""

    # ── Create directories ────────────────────────────────────────────────
    mkdir -p "$FAMILIAR_DIR/daemon"

    # ── Write config.toml ─────────────────────────────────────────────────
    local config_file="$FAMILIAR_DIR/config.toml"
    cat > "$config_file" <<EOF
version = 1

[identity]
name = "${FAMILIAR_NAME}"

[daemon]
log_level = "info"

[tools]
EOF

    # Add tool entries
    for tool in "${ALL_TOOLS[@]}"; do
        local enabled="false"
        for s in "${SELECTED_TOOLS[@]+"${SELECTED_TOOLS[@]}"}"; do
            if [ "$s" = "$tool" ]; then
                enabled="true"
                break
            fi
        done
        echo "${tool} = ${enabled}" >> "$config_file"
    done

    info "Created $config_file"

    # ── Write permissions.toml ────────────────────────────────────────────
    local perms_file="$FAMILIAR_DIR/daemon/permissions.toml"
    if [ ! -f "$perms_file" ]; then
        local allowed="true"
        if [ "$ENABLE_ALL_CAPS" = false ]; then
            allowed="false"
        fi

        cat > "$perms_file" <<EOF
# Familiar Daemon — Permission Configuration
# Each capability must be explicitly allowed. Deny by default.

version = 1

[capabilities.system_info]
allowed = ${allowed}

[capabilities.clipboard]
allowed = ${allowed}

[capabilities.notifications]
allowed = ${allowed}

[capabilities.screenshots]
allowed = ${allowed}

[capabilities.window_mgmt]
allowed = ${allowed}

[capabilities.app_control]
allowed = ${allowed}

[capabilities.input_sim]
allowed = ${allowed}

[capabilities.audio]
allowed = ${allowed}

[capabilities.display]
allowed = ${allowed}

[capabilities.file_search]
allowed = ${allowed}

[capabilities.accessibility]
allowed = ${allowed}

[capabilities.file_ops]
allowed = ${allowed}

[capabilities.network]
allowed = ${allowed}

[capabilities.browser]
allowed = ${allowed}

[capabilities.defaults]
allowed = ${allowed}

[capabilities.terminal]
allowed = ${allowed}

[capabilities.ocr]
allowed = ${allowed}
EOF
        info "Created $perms_file"
    else
        info "Kept existing $perms_file"
    fi

    # ── Configure MCP in each selected tool ───────────────────────────────
    for tool in "${SELECTED_TOOLS[@]+"${SELECTED_TOOLS[@]}"}"; do
        local config_path format
        config_path=$(tool_config_path "$tool")
        format=$(tool_config_format "$tool")

        local rc=0
        json_merge_mcp_server "$config_path" "familiar-daemon" "$daemon_bin" "$format" || rc=$?

        if [ "$rc" -eq 2 ]; then
            # Already exists — ask user
            local display
            display=$(tool_display_name "$tool")
            printf "  familiar-daemon already configured in %s. Overwrite? [y/N]: " "$display"
            read -r overwrite
            if [[ "$overwrite" =~ ^[Yy] ]]; then
                # Remove old entry and re-merge
                _remove_mcp_entry "$config_path" "familiar-daemon" "$format"
                json_merge_mcp_server "$config_path" "familiar-daemon" "$daemon_bin" "$format" || true
            else
                info "Skipped $(tool_display_name "$tool")"
            fi
        fi
    done

    echo ""
    printf "  ${BOLD}%s is ready.${RESET} Restart your coding tools to connect.\n\n" "$FAMILIAR_NAME"
}

_remove_mcp_entry() {
    local file="$1" key="$2" format="$3"
    local parent
    if [ "$format" = "opencode" ]; then
        parent="mcp"
    else
        parent="mcpServers"
    fi

    ensure_json_tool

    if [ "$_JSON_TOOL" = "jq" ]; then
        local tmp
        tmp=$(mktemp)
        jq "del(.\"$parent\".\"$key\")" "$file" > "$tmp" && mv "$tmp" "$file"
    else
        python3 -c "
import json
with open('$file') as f:
    data = json.load(f)
if '$parent' in data and '$key' in data['$parent']:
    del data['$parent']['$key']
with open('$file', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
    printf "\n  ${BOLD}familiar.run${RESET} — setup wizard\n"

    get_name
    select_tools
    configure_capabilities
    confirm_and_execute
}

main "$@"

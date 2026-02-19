#!/bin/bash
# Start OpenClaw gateway with env vars from config/.env
# All paths are resolved relative to $HOME — no hardcoded user paths.

ENGIE_HOME="${ENGIE_HOME:-$HOME/.engie}"
ENV_FILE="${ENGIE_HOME}/config/.env"

# Fall back to legacy location if ~/.engie/config/.env doesn't exist
if [ ! -f "$ENV_FILE" ]; then
  ENV_FILE="$HOME/engie/config/.env"
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

exec /opt/homebrew/bin/openclaw gateway --bind lan --port 18789

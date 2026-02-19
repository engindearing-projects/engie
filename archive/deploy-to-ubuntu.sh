#!/bin/bash
set -euo pipefail

# Deploy Engie to Ubuntu server
# Usage: ./scripts/deploy-to-ubuntu.sh <user@host>
#
# This syncs the project directory to the Ubuntu server and starts the services.
# The .env file is transferred separately (contains secrets).

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <user@host> [remote-path]"
  echo "  Example: $0 grant@ubuntu-server"
  echo "  Example: $0 grant@192.168.1.100 /home/grant/engie"
  exit 1
fi

REMOTE_HOST="$1"
REMOTE_PATH="${2:-~/engie}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Deploy Engie to Ubuntu ==="
echo "Remote: $REMOTE_HOST:$REMOTE_PATH"
echo ""

# Sync project files (excluding .env secrets and build artifacts)
echo "Syncing project files..."
rsync -avz --progress \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude '.git' \
  "$PROJECT_DIR/" "$REMOTE_HOST:$REMOTE_PATH/"

echo ""
echo "✓ Files synced"

# Check if .env exists on remote
echo "Checking .env on remote..."
if ssh "$REMOTE_HOST" "test -f $REMOTE_PATH/.env"; then
  echo "✓ .env exists on remote"
else
  echo "⚠ No .env on remote. Copying..."
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    scp "$PROJECT_DIR/.env" "$REMOTE_HOST:$REMOTE_PATH/.env"
    echo "✓ .env copied (review and update if needed)"
  else
    echo "  No local .env either. Run setup.sh on the remote."
  fi
fi

# Enable GPU in docker-compose on Ubuntu (if nvidia GPU detected)
echo ""
echo "Checking for GPU on remote..."
if ssh "$REMOTE_HOST" "command -v nvidia-smi &>/dev/null"; then
  echo "  GPU detected. To enable GPU for Ollama, uncomment the deploy section"
  echo "  in docker-compose.yml on the remote server."
fi

echo ""
echo "=== Next Steps ==="
echo ""
echo "  SSH into the server:"
echo "    ssh $REMOTE_HOST"
echo ""
echo "  Run the setup:"
echo "    cd $REMOTE_PATH"
echo "    ./scripts/setup.sh"
echo ""
echo "  Or if already set up, just restart:"
echo "    cd $REMOTE_PATH"
echo "    docker compose pull"
echo "    docker compose up -d"
echo ""

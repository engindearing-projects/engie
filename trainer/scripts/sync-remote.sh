#!/usr/bin/env bash
set -euo pipefail

# The Forge — Sync with Remote Training Server
# Pushes training data to the remote PC and pulls trained models back.
#
# Usage:
#   bash scripts/sync-remote.sh push          # push training data to remote
#   bash scripts/sync-remote.sh pull          # pull trained adapters from remote
#   bash scripts/sync-remote.sh full          # push data, train remotely, pull results
#   bash scripts/sync-remote.sh status        # check remote status

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRAINER_DIR="$(dirname "$SCRIPT_DIR")"

# Remote server config — edit these
REMOTE_USER="${FORGE_REMOTE_USER:-j}"
REMOTE_HOST="${FORGE_REMOTE_HOST:-192.168.0.50}"
REMOTE_DIR="${FORGE_REMOTE_DIR:-~/engie/trainer}"
SSH_OPTS="-o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new"

REMOTE="$REMOTE_USER@$REMOTE_HOST"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

ACTION="${1:-help}"

case "$ACTION" in
    push)
        echo -e "${CYAN}Pushing training data to $REMOTE...${NC}"

        # Push raw training data
        rsync -avz --progress \
            "$TRAINER_DIR/data/raw/" \
            "$REMOTE:$REMOTE_DIR/data/raw/"

        # Push domain configs
        rsync -avz --progress \
            "$TRAINER_DIR/domains/" \
            "$REMOTE:$REMOTE_DIR/domains/"

        # Push benchmark tasks
        rsync -avz --progress \
            "$TRAINER_DIR/benchmarks/"*.jsonl \
            "$REMOTE:$REMOTE_DIR/benchmarks/"

        # Push scripts
        rsync -avz --progress \
            "$TRAINER_DIR/scripts/" \
            "$REMOTE:$REMOTE_DIR/scripts/"

        # Push requirements
        rsync -avz --progress \
            "$TRAINER_DIR/requirements-cuda.txt" \
            "$REMOTE:$REMOTE_DIR/"

        echo -e "${GREEN}Push complete.${NC}"
        ;;

    pull)
        echo -e "${CYAN}Pulling trained models from $REMOTE...${NC}"

        # Pull adapters
        rsync -avz --progress \
            "$REMOTE:$REMOTE_DIR/models/adapters/" \
            "$TRAINER_DIR/models/adapters/"

        # Pull GGUF files
        rsync -avz --progress \
            "$REMOTE:$REMOTE_DIR/models/gguf/" \
            "$TRAINER_DIR/models/gguf/"

        # Pull benchmark results
        rsync -avz --progress \
            "$REMOTE:$REMOTE_DIR/benchmarks/results/" \
            "$TRAINER_DIR/benchmarks/results/" 2>/dev/null || true

        echo -e "${GREEN}Pull complete.${NC}"
        echo ""
        echo "To deploy a pulled GGUF to Ollama:"
        echo "  ls $TRAINER_DIR/models/gguf/"
        echo "  # Then create a Modelfile and run: ollama create engie-coder:vN -f Modelfile"
        ;;

    full)
        echo -e "${CYAN}Full remote training cycle...${NC}"
        echo ""

        # Step 1: Push
        echo -e "${CYAN}[1/4] Pushing data...${NC}"
        bash "$0" push
        echo ""

        # Step 2: Prepare data on remote
        echo -e "${CYAN}[2/4] Preparing data on remote...${NC}"
        ssh $SSH_OPTS "$REMOTE" "cd $REMOTE_DIR && .venv/bin/python scripts/prepare-data.py"
        echo ""

        # Step 3: Train on remote
        echo -e "${CYAN}[3/4] Training on remote (CUDA)...${NC}"
        ssh $SSH_OPTS "$REMOTE" "cd $REMOTE_DIR && .venv/bin/python scripts/train-cuda.py"
        echo ""

        # Step 4: Pull results
        echo -e "${CYAN}[4/4] Pulling results...${NC}"
        bash "$0" pull
        echo ""

        echo -e "${GREEN}Remote training cycle complete.${NC}"
        ;;

    status)
        echo -e "${CYAN}Remote server status ($REMOTE):${NC}"
        ssh $SSH_OPTS "$REMOTE" "
            echo ''
            echo '  GPU:'
            nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null || echo '    (nvidia-smi not available)'
            echo ''
            echo '  Training data:'
            if [ -d '$REMOTE_DIR/data/raw' ]; then
                count=\$(find $REMOTE_DIR/data/raw -name '*.jsonl' 2>/dev/null | wc -l)
                echo \"    Raw files: \$count\"
            fi
            if [ -f '$REMOTE_DIR/data/train.jsonl' ]; then
                lines=\$(wc -l < $REMOTE_DIR/data/train.jsonl)
                echo \"    Train examples: \$lines\"
            fi
            echo ''
            echo '  Adapters:'
            ls -d $REMOTE_DIR/models/adapters/v* 2>/dev/null || echo '    (none)'
            echo ''
            echo '  GGUF files:'
            ls -lh $REMOTE_DIR/models/gguf/*.gguf 2>/dev/null || echo '    (none)'
            echo ''
        " 2>&1 || echo -e "${RED}Cannot connect to $REMOTE${NC}"
        ;;

    *)
        echo "The Forge — Remote Sync"
        echo ""
        echo "Usage: bash scripts/sync-remote.sh <command>"
        echo ""
        echo "Commands:"
        echo "  push      Push training data and configs to remote"
        echo "  pull      Pull trained adapters and GGUFs from remote"
        echo "  full      Full cycle: push → prepare → train → pull"
        echo "  status    Check remote server status"
        echo ""
        echo "Environment variables:"
        echo "  FORGE_REMOTE_USER  SSH user (default: j)"
        echo "  FORGE_REMOTE_HOST  SSH host (default: 192.168.0.50)"
        echo "  FORGE_REMOTE_DIR   Remote trainer dir (default: ~/engie/trainer)"
        ;;
esac

#!/bin/bash
set -euo pipefail

# Migrate from ~/.engie to ~/.cozyterm
# Creates backward-compat symlink and unloads old plists.

OLD_HOME="$HOME/.engie"
NEW_HOME="$HOME/.cozyterm"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

echo "CozyTerm Migration"
echo "=================="
echo ""

# Check if already migrated
if [ -d "$NEW_HOME" ] && [ ! -L "$NEW_HOME" ]; then
  echo "~/.cozyterm already exists. Nothing to migrate."
  exit 0
fi

# Check if old home exists
if [ ! -d "$OLD_HOME" ]; then
  echo "~/.engie not found. Nothing to migrate."
  echo "Run 'cozy init' for a fresh setup."
  exit 0
fi

# If old home is a symlink pointing to new home, already done
if [ -L "$OLD_HOME" ]; then
  target=$(readlink "$OLD_HOME")
  if [ "$target" = "$NEW_HOME" ]; then
    echo "Already migrated (~/.engie -> ~/.cozyterm)."
    exit 0
  fi
fi

echo "Moving ~/.engie -> ~/.cozyterm..."
mv "$OLD_HOME" "$NEW_HOME"

echo "Creating backward-compat symlink ~/.engie -> ~/.cozyterm..."
ln -s "$NEW_HOME" "$OLD_HOME"

# Rename memory DB if it exists
if [ -f "$NEW_HOME/memory/engie.db" ] && [ ! -f "$NEW_HOME/memory/cozyterm.db" ]; then
  echo "Renaming memory database..."
  cp "$NEW_HOME/memory/engie.db" "$NEW_HOME/memory/cozyterm.db"
  echo "  Kept engie.db as backup, created cozyterm.db"
fi

# Unload old plist services
echo ""
echo "Unloading old service plists..."
OLD_PLISTS=(
  "com.engie.gateway"
  "com.engie.claude-proxy"
  "com.engie.activity-sync"
  "com.engie.telegram-push"
)

for label in "${OLD_PLISTS[@]}"; do
  plist="$LAUNCH_AGENTS/$label.plist"
  if [ -f "$plist" ]; then
    echo "  Unloading $label..."
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    echo "  Removing $plist..."
    rm -f "$plist"
  fi
done

# Update ~/.openclaw symlink to point to new config location
OPENCLAW_DIR="$HOME/.openclaw"
NEW_CONFIG="$NEW_HOME/config"
if [ -L "$OPENCLAW_DIR" ]; then
  current=$(readlink "$OPENCLAW_DIR")
  if [ "$current" != "$NEW_CONFIG" ]; then
    echo ""
    echo "Updating ~/.openclaw symlink..."
    rm "$OPENCLAW_DIR"
    ln -s "$NEW_CONFIG" "$OPENCLAW_DIR"
  fi
fi

echo ""
echo "Migration complete!"
echo ""
echo "Next steps:"
echo "  1. cd cli && bun link      # Register the 'cozy' command"
echo "  2. cozy start              # Install new service plists and start services"
echo "  3. cozy status             # Verify everything is running"
echo ""
echo "Both 'cozy' and 'engie' commands will work."

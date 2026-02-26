#!/bin/bash
# Start Familiar TUI in a named tmux session for mobile access via Mosh/SSH
SESSION="familiar"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already running. Attach with: tmux attach -t $SESSION"
  exit 0
fi

tmux new-session -d -s "$SESSION" "bun $HOME/engie/cli/bin/familiar.mjs"
echo "Started Familiar TUI in tmux session '$SESSION'"
echo ""
echo "Attach locally:  tmux attach -t $SESSION"
echo "From iPhone:     mosh $(hostname) -- tmux attach -t $SESSION"
echo ""
echo "Tip: Install Blink Shell on iOS for the best Mosh experience."

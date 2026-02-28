#!/bin/bash
# Stop any existing instance and start the bot
lsof -ti:3000 | xargs kill -9 2>/dev/null
echo "[transBoot] Starting service..."
echo "[transBoot] Logs: tail -f data/bot.log"

export NODE_TLS_REJECT_UNAUTHORIZED=0
# Log level: debug (verbose) | info (default) | warn | error
export LOG_LEVEL="${LOG_LEVEL:-info}"

if [ "$1" = "-w" ]; then
  echo "[transBoot] Watch mode (auto-restart on file change)"
  bun --watch src/index.ts
elif [ "$1" = "-d" ]; then
  bun run src/index.ts &
  echo "[transBoot] Running in background (PID: $!)"
else
  bun run src/index.ts
fi

#!/bin/bash
# Stop the bot service
PID=$(lsof -ti:3000)
if [ -n "$PID" ]; then
  kill -9 $PID
  echo "[transBoot] Service stopped (PID: $PID)"
else
  echo "[transBoot] Service is not running"
fi

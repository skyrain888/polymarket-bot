# Hot Reload (Dev Mode) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `bun --watch` dev mode so code changes auto-restart the bot without manual intervention.

**Architecture:** Three minimal changes — a `dev` npm script, a `-w` flag in `start.sh`, and a duplicate-patch guard in `logger.ts`. No new dependencies. Production behavior unchanged.

**Tech Stack:** Bun `--watch` (built-in), Bash

---

### Task 1: Add `dev` script to `package.json`

**Files:**
- Modify: `package.json`

**Step 1: Add the dev script**

In `package.json`, add `"dev"` to the `scripts` block:

```json
"scripts": {
  "dev": "bun --watch src/index.ts",
  "start": "bun run src/index.ts",
  "test": "bun test",
  "backtest": "bun run src/backtest/cli.ts"
},
```

**Step 2: Verify it works**

```bash
bun run dev
```

Expected: Bot starts normally. Edit any `.ts` file and save — bot should restart within ~2 seconds with a `[Bun] File changed, restarting...` message.

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add dev script with bun --watch for hot reload"
```

---

### Task 2: Add `-w` watch flag to `start.sh`

**Files:**
- Modify: `start.sh`

**Step 1: Update start.sh**

Replace the current `if/else` block with a three-branch version:

```bash
#!/bin/bash
# Stop any existing instance and start the bot
lsof -ti:3000 | xargs kill -9 2>/dev/null
echo "[transBoot] Starting service..."
echo "[transBoot] Logs: tail -f data/bot.log"

export NODE_TLS_REJECT_UNAUTHORIZED=0

if [ "$1" = "-w" ]; then
  echo "[transBoot] Watch mode (auto-restart on file change)"
  bun --watch src/index.ts
elif [ "$1" = "-d" ]; then
  bun run src/index.ts &
  echo "[transBoot] Running in background (PID: $!)"
else
  bun run src/index.ts
fi
```

**Step 2: Verify**

```bash
./start.sh -w
```

Expected: Bot starts. Edit a `.ts` file, save — bot restarts automatically.

**Step 3: Commit**

```bash
git add start.sh
git commit -m "feat: add -w watch mode flag to start.sh"
```

---

### Task 3: Add duplicate-patch guard to `logger.ts`

**Files:**
- Modify: `src/infrastructure/logger.ts`

**Step 1: Wrap monkey-patch in guard**

Replace the three `console.X = ...` assignments with a guard block:

```ts
if (!(console as any).__loggerPatched) {
  (console as any).__loggerPatched = true

  console.log = (...args: any[]) => {
    origLog(...args)
    writeToFile('INFO', args)
  }

  console.error = (...args: any[]) => {
    origError(...args)
    writeToFile('ERROR', args)
  }

  console.warn = (...args: any[]) => {
    origWarn(...args)
    writeToFile('WARN', args)
  }
}
```

Note: `bun --watch` does a full process restart, so this guard is not needed in practice today. It protects against accidental double-import or future `--hot` mode usage.

**Step 2: Restart in watch mode and confirm logs still work**

```bash
./start.sh -w
tail -f data/bot.log
```

Expected: Timestamps and log lines appear normally. Edit a file, save, confirm bot restarts and logging resumes.

**Step 3: Commit**

```bash
git add src/infrastructure/logger.ts
git commit -m "fix: guard logger monkey-patch against duplicate execution"
```

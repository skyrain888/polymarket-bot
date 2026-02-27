# Hot Reload (Dev Mode) Design

**Date:** 2026-02-28
**Status:** Approved

## Problem

Every code change requires manually stopping and restarting the server, which slows down development iteration.

## Goal

Support automatic restart on file save during development. Production behavior unchanged.

## Approach

Use Bun's built-in `--watch` flag, which monitors `.ts` files and automatically restarts the process on change. Restart time is ~1-2 seconds; SQLite-persisted state is recovered on restart.

## Changes

### 1. `package.json`
Add a `dev` script:
```json
"dev": "bun --watch src/index.ts"
```

### 2. `start.sh`
Add `-w` flag for watch mode:
```bash
if [ "$1" = "-w" ]; then
  bun --watch src/index.ts
```

### 3. `src/infrastructure/logger.ts`
Add a guard to prevent duplicate monkey-patching if the module is re-executed:
```ts
if (!(console as any).__patched) {
  // monkey-patch console.log/error/warn
  (console as any).__patched = true
}
```

## Usage

```bash
# Development (auto-restart on file change)
bun run dev
# or
./start.sh -w

# Production (unchanged)
./start.sh
./start.sh -d   # background
```

## Out of Scope

- True HMR (`bun --hot`): not suitable due to HTTP server port binding and timer duplication issues
- Production zero-downtime reload: not needed at this stage

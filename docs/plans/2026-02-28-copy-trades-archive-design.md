# Copy Trades Archive Feature Design

**Date:** 2026-02-28
**Phase:** 1 — Time-based archiving

## Overview

Add an archive capability to copy-trade records. Records older than a configurable number of days are moved from the active in-memory list (and `data/copy-trades.json`) into a dedicated SQLite table. Archiving can be triggered manually from the dashboard or automatically on a daily schedule.

## Requirements

- Archive is one-way (no restore).
- Storage: SQLite table `copy_trades_archive`.
- Auto-archive: by record age (configurable days), scanned once per day.
- Manual archive: button on dashboard triggers immediate archiving.
- Archived records are viewable in a separate "历史存档" page with wallet/time filters.
- Archive config is part of `CopyTradingConfig` and persists to `data/copy-trading.json`.

## Data Layer

### New SQLite table

```sql
CREATE TABLE IF NOT EXISTS copy_trades_archive (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  data        TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  label       TEXT NOT NULL,
  market_id   TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`data` stores the full `CopiedTrade` as JSON. `wallet`, `label`, `market_id`, and `timestamp` are redundant columns for efficient filtering.

### Schema migration

Add the new table definition to `src/infrastructure/storage/schema.ts`. Since Bun SQLite uses `CREATE TABLE IF NOT EXISTS`, existing databases are upgraded automatically on next start.

## Config Schema Change

Extend `CopyTradingConfig` in `src/strategies/copy-trading/types.ts`:

```ts
export interface ArchiveConfig {
  enabled: boolean         // auto-archive on/off (default false)
  autoArchiveDays: number  // archive records older than N days (default 30)
}

export interface CopyTradingConfig {
  // ... existing fields ...
  archive?: ArchiveConfig
}
```

Default (when field is absent): `{ enabled: false, autoArchiveDays: 30 }`.

## ArchiveService

**File:** `src/infrastructure/archive/service.ts`

```
class ArchiveService
  constructor(db, copyTradingStrategy, getConfig)
  start(): void          — runs archiveNow() immediately, then every 24h
  stop(): void           — clears the interval
  archiveNow(): number   — moves qualifying records, returns count archived
```

Logic of `archiveNow()`:
1. Read `archive` config; if `!enabled`, no-op (unless called from manual button which bypasses the flag).
2. Compute cutoff = `Date.now()/1000 - autoArchiveDays * 86400`.
3. Find all entries in `recentCopies` where `timestamp < cutoff`.
4. Insert each into SQLite `copy_trades_archive`.
5. Remove them from `recentCopies` in-place.
6. Call `saveCopies()` on the strategy to persist updated JSON.
7. Return count.

## Dashboard Changes

### Archive config panel

In the existing `/copy-trading` page, add a new card below the risk limits card:

- Toggle: **启用自动归档**
- Input: **超过 N 天自动归档** (number input, 1–365)
- Button: **立即归档** (POST `/copy-trading/archive/now`)

### Manual archive endpoint

```
POST /copy-trading/archive/now
→ calls archiveService.archiveNow(/* force=true */)
→ returns updated copy-trading page body with toast: "已归档 N 条记录"
```

### History page

```
GET /copy-trading/history
```

- Separate full page layout with title "历史存档"
- Filters: wallet (select), time range (select: 全部 / 近7天 / 近30天 / 近90天 / 近1年)
- Pagination: 100 records per page, page param in query string
- Table columns: 时间 | 钱包 | 市场 | 结果 | 方向 | 原始金额 | 入场价 | 跟单金额 | 交易哈希 | 归档时间
- No PnL enrichment (keep it lightweight; prices may be stale for old resolved markets)
- Nav link added to sidebar/header

## Wiring

In `src/bot.ts` (or `src/index.ts`):
1. Instantiate `ArchiveService` after `CopyTradingStrategy` and the DB are ready.
2. Pass `ArchiveService` reference to `createDashboard`.
3. Call `archiveService.start()`.

## File Changes Summary

| File | Change |
|------|--------|
| `src/infrastructure/storage/schema.ts` | Add `copy_trades_archive` table |
| `src/strategies/copy-trading/types.ts` | Add `ArchiveConfig`, extend `CopyTradingConfig` |
| `src/infrastructure/archive/service.ts` | New — `ArchiveService` class |
| `src/infrastructure/dashboard/server.ts` | Archive config panel, manual archive route, history page route |
| `src/bot.ts` | Instantiate and start `ArchiveService` |

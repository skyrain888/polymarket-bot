# Copy Trades Archive Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move aging copy-trade records from the active in-memory list into a persistent SQLite archive table, with daily auto-archiving and a dashboard page for viewing history.

**Architecture:** A new `ArchiveService` owns all archive logic (query, insert, prune). It is wired into `bot.ts` and exposed to the dashboard. Config lives in `CopyTradingConfig.archive` and persists via `ConfigStore`.

**Tech Stack:** Bun, SQLite (bun:sqlite), Hono, HTMX

---

### Task 1: Add `copy_trades_archive` table to schema

**Files:**
- Modify: `src/infrastructure/storage/schema.ts`

**Step 1: Add the table DDL**

Append to the `SCHEMA` string (inside the template literal, after `account_snapshots`):

```ts
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

**Step 2: Verify the file looks right**

Run: `cat src/infrastructure/storage/schema.ts`
Expected: file ends with the new `copy_trades_archive` block before the closing backtick.

**Step 3: Commit**

```bash
git add src/infrastructure/storage/schema.ts
git commit -m "feat: add copy_trades_archive SQLite table to schema"
```

---

### Task 2: Extend config types with `ArchiveConfig`

**Files:**
- Modify: `src/strategies/copy-trading/types.ts`

**Step 1: Add `ArchiveConfig` interface and extend `CopyTradingConfig`**

In `src/strategies/copy-trading/types.ts`, add before `CopyTradingConfig`:

```ts
export interface ArchiveConfig {
  enabled: boolean         // enable daily auto-archiving
  autoArchiveDays: number  // archive records older than N days
}
```

Then add the optional field to `CopyTradingConfig`:

```ts
export interface CopyTradingConfig {
  enabled: boolean
  wallets: WalletConfig[]
  maxDailyTradesPerWallet: number
  maxWalletExposureUsdc: number
  maxTotalExposureUsdc: number
  pollIntervalSeconds: number
  archive?: ArchiveConfig  // <-- add this line
}
```

**Step 2: Commit**

```bash
git add src/strategies/copy-trading/types.ts
git commit -m "feat: add ArchiveConfig to CopyTradingConfig"
```

---

### Task 3: Create `ArchiveRepository`

**Files:**
- Create: `src/infrastructure/archive/repository.ts`

**Step 1: Write the repository class**

```ts
import type { Database } from 'bun:sqlite'
import type { CopiedTrade } from '../../strategies/copy-trading/types.ts'

export interface ArchiveRow {
  id: number
  data: string
  wallet: string
  label: string
  marketId: string
  timestamp: number
  archivedAt: string
}

export class ArchiveRepository {
  constructor(private db: Database) {}

  insertMany(trades: CopiedTrade[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO copy_trades_archive (data, wallet, label, market_id, timestamp)
      VALUES ($data, $wallet, $label, $marketId, $timestamp)
    `)
    const insertAll = this.db.transaction((rows: CopiedTrade[]) => {
      for (const t of rows) {
        stmt.run({
          $data: JSON.stringify(t),
          $wallet: t.walletAddress,
          $label: t.label,
          $marketId: t.marketId,
          $timestamp: t.timestamp,
        })
      }
    })
    insertAll(trades)
  }

  findAll(opts: { wallet?: string; since?: number; page?: number; pageSize?: number } = {}): { rows: (CopiedTrade & { archivedAt: string })[]; total: number } {
    const { wallet, since, page = 0, pageSize = 100 } = opts
    const conditions: string[] = []
    const params: Record<string, unknown> = {}

    if (wallet) { conditions.push('label = $wallet'); params.$wallet = wallet }
    if (since != null) { conditions.push('timestamp >= $since'); params.$since = since }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = (this.db.query(`SELECT COUNT(*) as n FROM copy_trades_archive ${where}`).get(params) as any).n as number

    params.$limit = pageSize
    params.$offset = page * pageSize
    const raw = this.db.query(
      `SELECT data, archived_at FROM copy_trades_archive ${where} ORDER BY timestamp DESC LIMIT $limit OFFSET $offset`
    ).all(params) as { data: string; archived_at: string }[]

    const rows = raw.map(r => ({ ...(JSON.parse(r.data) as CopiedTrade), archivedAt: r.archived_at }))
    return { rows, total }
  }

  countAll(): number {
    return ((this.db.query('SELECT COUNT(*) as n FROM copy_trades_archive').get() as any).n) as number
  }
}
```

**Step 2: Commit**

```bash
git add src/infrastructure/archive/repository.ts
git commit -m "feat: add ArchiveRepository for copy_trades_archive table"
```

---

### Task 4: Create `ArchiveService`

**Files:**
- Create: `src/infrastructure/archive/service.ts`

**Step 1: Write the service**

```ts
import type { CopyTradingStrategy } from '../../strategies/copy-trading/index.ts'
import type { ArchiveConfig } from '../../strategies/copy-trading/types.ts'
import type { ArchiveRepository } from './repository.ts'

export class ArchiveService {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private repo: ArchiveRepository,
    private strategy: CopyTradingStrategy,
    private getConfig: () => ArchiveConfig | undefined,
  ) {}

  start(): void {
    this.archiveNow()
    // Run every 24 hours
    this.timer = setInterval(() => this.archiveNow(), 24 * 60 * 60 * 1000)
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Archive records older than `overrideDays` days (or config value). Returns count archived. */
  archiveNow(overrideDays?: number): number {
    const cfg = this.getConfig()
    const days = overrideDays ?? cfg?.autoArchiveDays ?? 30

    if (overrideDays == null && !cfg?.enabled) {
      console.log('[Archive] Auto-archive disabled, skipping')
      return 0
    }

    const cutoff = Math.floor(Date.now() / 1000) - days * 86400
    const copies = this.strategy.getRecentCopies(200)
    const toArchive = copies.filter(c => c.timestamp < cutoff)

    if (toArchive.length === 0) {
      console.log(`[Archive] No records older than ${days} days to archive`)
      return 0
    }

    this.repo.insertMany(toArchive)
    this.strategy.removeCopies(toArchive.map(c => c.txHash))
    console.log(`[Archive] Archived ${toArchive.length} records older than ${days} days`)
    return toArchive.length
  }
}
```

**Step 2: Commit**

```bash
git add src/infrastructure/archive/service.ts
git commit -m "feat: add ArchiveService with auto and manual archive"
```

---

### Task 5: Add `removeCopies()` to `CopyTradingStrategy`

The `ArchiveService` needs a way to remove specific records from the strategy's in-memory list.

**Files:**
- Modify: `src/strategies/copy-trading/index.ts`

**Step 1: Add the method after `getRecentCopies()`**

```ts
removeCopies(txHashes: string[]): void {
  const set = new Set(txHashes)
  this.recentCopies = this.recentCopies.filter(c => !set.has(c.txHash))
  this.saveCopies()
}
```

**Step 2: Commit**

```bash
git add src/strategies/copy-trading/index.ts
git commit -m "feat: add removeCopies() to CopyTradingStrategy for archive support"
```

---

### Task 6: Wire `ArchiveService` into `bot.ts`

**Files:**
- Modify: `src/bot.ts`
- Modify: `src/infrastructure/storage/db.ts` (check DB init exports)

**Step 1: Read `src/bot.ts` and `src/infrastructure/storage/db.ts` to understand current wiring**

Check how `db` is instantiated and passed, and where `createDashboard` is called.

**Step 2: Import and instantiate**

In `src/bot.ts`, after `CopyTradingStrategy` is instantiated:

```ts
import { ArchiveRepository } from './infrastructure/archive/repository.ts'
import { ArchiveService } from './infrastructure/archive/service.ts'

// After copyTradingStrategy is created:
const archiveRepo = new ArchiveRepository(db)
const archiveService = new ArchiveService(
  archiveRepo,
  copyTradingStrategy,
  () => config.copyTrading.archive,
)
archiveService.start()
```

**Step 3: Pass to `createDashboard`**

Add `archiveService` and `archiveRepo` to `DashboardDeps` and the `createDashboard` call:

```ts
// In the createDashboard call:
archiveService,
archiveRepo,
```

**Step 4: Commit**

```bash
git add src/bot.ts
git commit -m "feat: wire ArchiveService into bot startup and dashboard"
```

---

### Task 7: Update `DashboardDeps` and add archive config panel

**Files:**
- Modify: `src/infrastructure/dashboard/server.ts`

**Step 1: Add deps to `DashboardDeps` interface**

```ts
import type { ArchiveService } from '../archive/service.ts'
import type { ArchiveRepository } from '../archive/repository.ts'

interface DashboardDeps {
  // ... existing fields ...
  archiveService?: ArchiveService
  archiveRepo?: ArchiveRepository
}
```

**Step 2: Add archive config panel to `copyTradingBody()`**

After the risk limits card (`</div>` that closes the limits card), insert:

```ts
const archiveCfg = cfg.archive ?? { enabled: false, autoArchiveDays: 30 }
const archivePanel = `
<div class="card" style="margin-bottom:1rem">
  <h3 style="margin-bottom:1rem;color:#7c83fd">归档设置</h3>
  <form hx-post="/copy-trading/archive/config" hx-target="#ct-page" hx-swap="innerHTML"
        style="display:grid;grid-template-columns:auto 1fr auto auto;gap:0.75rem;align-items:end">
    <div>
      <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">启用自动归档</label>
      <input name="enabled" type="checkbox" ${archiveCfg.enabled ? 'checked' : ''}
             style="width:16px;height:16px;margin-top:6px">
    </div>
    <div>
      <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">超过 N 天自动归档</label>
      <input name="autoArchiveDays" type="number" min="1" max="365" value="${archiveCfg.autoArchiveDays}"
             style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px">
    </div>
    <button type="submit"
            style="background:#1e3a5e;color:#5b9bd5;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;height:34px">
      保存
    </button>
    <button type="button"
            hx-post="/copy-trading/archive/now" hx-target="#ct-page" hx-swap="innerHTML"
            style="background:#3a2a1e;color:#e0a84c;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;height:34px">
      立即归档
    </button>
  </form>
</div>`
```

Return `archivePanel` in the template string inside `copyTradingBody()`, just before `${tradesCard}`.

**Step 3: Add archive config save route**

```ts
app.post('/copy-trading/archive/config', async (c) => {
  const body = await c.req.parseBody()
  const enabled = body.enabled === 'on'
  const days = Math.max(1, Number(body.autoArchiveDays ?? 30))
  deps.config.copyTrading.archive = { enabled, autoArchiveDays: days }
  applyConfig()
  return c.html(await copyTradingBody())
})
```

**Step 4: Add manual archive route**

```ts
app.post('/copy-trading/archive/now', async (c) => {
  const count = deps.archiveService?.archiveNow(
    deps.config.copyTrading.archive?.autoArchiveDays ?? 30
  ) ?? 0
  // Temporarily inject toast into page title area via OOB or just re-render with a flash var
  return c.html(await copyTradingBody(`已归档 ${count} 条记录`))
})
```

Update `copyTradingBody` signature to accept an optional `toast?: string` param:

```ts
async function copyTradingBody(toast?: string) {
  // At top of returned string, before <h2>:
  const toastHtml = toast
    ? `<div style="background:#1e4d2b;border:1px solid #2ecc71;color:#2ecc71;padding:0.5rem 1rem;border-radius:4px;margin-bottom:1rem">${toast}</div>`
    : ''
  // prepend toastHtml before <h2 ...>跟单交易</h2>
}
```

**Step 5: Commit**

```bash
git add src/infrastructure/dashboard/server.ts
git commit -m "feat: add archive config panel and manual archive button to dashboard"
```

---

### Task 8: Add history page `/copy-trading/history`

**Files:**
- Modify: `src/infrastructure/dashboard/server.ts`

**Step 1: Add the history route**

```ts
app.get('/copy-trading/history', async (c) => {
  const wallet = c.req.query('wallet') || undefined
  const days = c.req.query('days') ? Number(c.req.query('days')) : undefined
  const page = Math.max(0, Number(c.req.query('page') ?? 0))
  const pageSize = 100

  const since = days != null ? Math.floor(Date.now() / 1000) - days * 86400 : undefined
  const { rows, total } = deps.archiveRepo?.findAll({ wallet, since, page, pageSize })
    ?? { rows: [], total: 0 }

  const walletLabels = [...new Set(deps.config.copyTrading.wallets.map(w => w.label))]
  const selStyle = 'background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:4px 8px;border-radius:4px;font-size:0.8rem'

  const walletOpts = [`<option value="">全部钱包</option>`]
    .concat(walletLabels.map(l => `<option value="${l}"${wallet === l ? ' selected' : ''}>${l}</option>`))
    .join('')

  const dayOpts = [
    { v: '', label: '全部时间' },
    { v: '7', label: '近7天' },
    { v: '30', label: '近30天' },
    { v: '90', label: '近90天' },
    { v: '365', label: '近1年' },
  ].map(o => `<option value="${o.v}"${String(days ?? '') === o.v ? ' selected' : ''}>${o.label}</option>`).join('')

  const archiveRows = rows.map(r => `<tr>
    <td style="color:#888;font-size:0.8rem">${new Date(r.timestamp * 1000).toLocaleString()}</td>
    <td>${r.label}</td>
    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.85rem">${r.title || r.marketId.slice(0,16) + '…'}</td>
    <td><span style="color:#c0a0ff;font-weight:600">${r.outcome || '-'}</span></td>
    <td><span class="badge ${r.side === 'buy' ? 'badge-ok' : 'badge-err'}">${r.side}</span></td>
    <td>$${r.originalSize.toFixed(2)}</td>
    <td>$${r.price.toFixed(3)}</td>
    <td>$${r.copiedSize.toFixed(2)}</td>
    <td style="font-size:0.8rem"><a href="https://polygonscan.com/tx/${r.txHash}" target="_blank" style="color:#5b9bd5;text-decoration:none">${r.txHash.slice(0,10)}…</a></td>
    <td style="color:#888;font-size:0.75rem">${r.archivedAt}</td>
  </tr>`).join('')

  const totalPages = Math.ceil(total / pageSize)
  const qs = (p: number) => {
    const ps = new URLSearchParams()
    if (wallet) ps.set('wallet', wallet)
    if (days != null) ps.set('days', String(days))
    ps.set('page', String(p))
    return ps.toString()
  }
  const pagination = totalPages > 1 ? `
    <div style="display:flex;gap:0.5rem;justify-content:center;margin-top:1rem">
      ${page > 0 ? `<a href="/copy-trading/history?${qs(page-1)}" style="color:#5b9bd5">← 上一页</a>` : ''}
      <span style="color:#888">第 ${page+1} / ${totalPages} 页 (共 ${total} 条)</span>
      ${page < totalPages-1 ? `<a href="/copy-trading/history?${qs(page+1)}" style="color:#5b9bd5">下一页 →</a>` : ''}
    </div>` : `<div style="color:#888;font-size:0.8rem;text-align:right;margin-top:0.5rem">共 ${total} 条归档记录</div>`

  const filterJs = `window.location='/copy-trading/history?'+new URLSearchParams({wallet:document.getElementById('h-wallet').value,days:document.getElementById('h-days').value,page:0}).toString()`

  return c.html(layout('历史存档', `
    <h2 style="margin-bottom:1rem">历史存档</h2>
    <div class="card">
      <div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:4px">
          <label style="color:#888;font-size:0.8rem">钱包:</label>
          <select id="h-wallet" onchange="${filterJs}" style="${selStyle}">${walletOpts}</select>
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          <label style="color:#888;font-size:0.8rem">时间:</label>
          <select id="h-days" onchange="${filterJs}" style="${selStyle}">${dayOpts}</select>
        </div>
        <a href="/copy-trading" style="margin-left:auto;color:#5b9bd5;font-size:0.85rem">← 返回跟单</a>
      </div>
      <table>
        <thead><tr><th>时间</th><th>钱包</th><th>市场</th><th>结果</th><th>方向</th><th>原始金额</th><th>入场价</th><th>跟单金额</th><th>交易哈希</th><th>归档时间</th></tr></thead>
        <tbody>${archiveRows || '<tr><td colspan="10" style="text-align:center;color:#888">暂无归档记录</td></tr>'}</tbody>
      </table>
      ${pagination}
    </div>
  `))
})
```

**Step 2: Add nav link to history page**

In `src/infrastructure/dashboard/views.ts`, find the nav links section and add:

```html
<a href="/copy-trading/history">历史存档</a>
```

(Place it after the copy-trading nav link.)

**Step 3: Commit**

```bash
git add src/infrastructure/dashboard/server.ts src/infrastructure/dashboard/views.ts
git commit -m "feat: add copy-trades history archive page"
```

---

### Task 9: Smoke test the full flow

**Step 1: Start the bot**

```bash
./start.sh
```

**Step 2: Open dashboard**

Navigate to `http://localhost:3000/copy-trading`.

Expected: new "归档设置" card visible with checkbox and days input.

**Step 3: Test manual archive**

Click "立即归档". Expected: toast "已归档 N 条记录" appears at top of page.

**Step 4: View history page**

Navigate to `http://localhost:3000/copy-trading/history`.

Expected: shows archived records (or empty state message).

**Step 5: Test auto-archive config**

Check "启用自动归档", set days to 1, click 保存. Verify `data/copy-trading.json` contains `"archive": { "enabled": true, "autoArchiveDays": 1 }`.

**Step 6: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix: copy-trades archive smoke test fixes"
```

---

## Summary of files changed

| File | Type |
|------|------|
| `src/infrastructure/storage/schema.ts` | Modify |
| `src/strategies/copy-trading/types.ts` | Modify |
| `src/strategies/copy-trading/index.ts` | Modify |
| `src/infrastructure/archive/repository.ts` | Create |
| `src/infrastructure/archive/service.ts` | Create |
| `src/infrastructure/dashboard/server.ts` | Modify |
| `src/infrastructure/dashboard/views.ts` | Modify |
| `src/bot.ts` | Modify |

# Copy Trading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add copy trading that monitors target Polymarket wallet addresses via The Graph, replicates their trades with configurable sizing, and enforces per-wallet risk limits.

**Architecture:** `CopyTradingStrategy` implements the existing `Strategy` interface and plugs into `StrategyEngine`. On each tick it polls The Graph for new trades per watched wallet, deduplicates by txHash, calculates size via `fixed` or `proportional` mode, runs copy-specific risk checks, then returns `TradeIntent[]` for the existing `RiskManager` + `OrderManager` pipeline.

**Tech Stack:** Bun, TypeScript, native `fetch` for GraphQL, Bun test runner (`bun test`)

---

### Task 1: Types

**Files:**
- Create: `src/strategies/copy-trading/types.ts`
- Modify: `src/config/types.ts`

**Step 1: Create copy trading types**

```typescript
// src/strategies/copy-trading/types.ts

export type SizeMode = 'fixed' | 'proportional'

export interface WalletConfig {
  address: string
  label: string
  sizeMode: SizeMode
  fixedAmount?: number      // USDC, used when sizeMode === 'fixed'
  proportionPct?: number    // 0-1, fraction of copied trade size, used when sizeMode === 'proportional'
}

export interface CopiedTrade {
  walletAddress: string
  label: string
  marketId: string
  tokenId: string
  side: 'buy' | 'sell'
  originalSize: number
  copiedSize: number
  price: number
  txHash: string
  timestamp: number
}

export interface CopyTradingConfig {
  enabled: boolean
  wallets: WalletConfig[]
  maxDailyTradesPerWallet: number
  maxWalletExposureUsdc: number
  maxTotalExposureUsdc: number
}
```

**Step 2: Add `copyTrading` to `BotConfig` in `src/config/types.ts`**

Add this field to the `BotConfig` interface (after the `dashboard` field):

```typescript
copyTrading: CopyTradingConfig
```

And add the import at the top:

```typescript
import type { CopyTradingConfig } from '../strategies/copy-trading/types.ts'
```

**Step 3: Commit**

```bash
git add src/strategies/copy-trading/types.ts src/config/types.ts
git commit -m "feat: add copy trading types and BotConfig field"
```

---

### Task 2: Config parsing

**Files:**
- Modify: `src/config/index.ts`
- Modify: `.env.example`

**Step 1: Parse copy trading config in `loadConfig()`**

Add to the return value inside `loadConfig()`:

```typescript
copyTrading: {
  enabled: process.env.COPY_TRADING_ENABLED === 'true',
  wallets: process.env.COPY_WALLETS
    ? JSON.parse(process.env.COPY_WALLETS) as WalletConfig[]
    : [],
  maxDailyTradesPerWallet: Number(process.env.COPY_MAX_DAILY_TRADES ?? 10),
  maxWalletExposureUsdc: Number(process.env.COPY_MAX_WALLET_EXPOSURE ?? 500),
  maxTotalExposureUsdc: Number(process.env.COPY_MAX_TOTAL_EXPOSURE ?? 2000),
},
```

Add the import at the top of `src/config/index.ts`:

```typescript
import type { WalletConfig } from '../strategies/copy-trading/types.ts'
```

**Step 2: Update `.env.example`**

Add after the `# Bot` section:

```bash
# Copy Trading
COPY_TRADING_ENABLED=false
# JSON array of wallets to copy
# COPY_WALLETS='[{"address":"0xABC...","label":"Smart Wallet 1","sizeMode":"fixed","fixedAmount":50}]'
COPY_MAX_DAILY_TRADES=10
COPY_MAX_WALLET_EXPOSURE=500
COPY_MAX_TOTAL_EXPOSURE=2000
```

**Step 3: Commit**

```bash
git add src/config/index.ts .env.example
git commit -m "feat: parse copy trading config from env"
```

---

### Task 3: GraphClient

**Files:**
- Create: `src/strategies/copy-trading/graph-client.ts`
- Create: `src/strategies/copy-trading/graph-client.test.ts`

**Step 1: Write failing test**

```typescript
// src/strategies/copy-trading/graph-client.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { GraphClient } from './graph-client.ts'

describe('GraphClient', () => {
  it('returns empty array when fetch returns no events', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        data: { orderFilledEvents: [] }
      })))
    ) as any

    const client = new GraphClient()
    const trades = await client.getRecentTrades('0xABC', 0)
    expect(trades).toEqual([])
  })

  it('maps GraphQL response to CopiedTrade shape', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        data: {
          orderFilledEvents: [{
            id: 'evt1',
            market: { id: 'mkt1' },
            outcomeIndex: 0,
            side: 'BUY',
            size: '100',
            price: '0.45',
            timestamp: '1000',
            transactionHash: '0xTX1',
          }]
        }
      })))
    ) as any

    const client = new GraphClient()
    const trades = await client.getRecentTrades('0xABC', 0)
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({
      marketId: 'mkt1',
      side: 'buy',
      size: 100,
      price: 0.45,
      txHash: '0xTX1',
      timestamp: 1000,
    })
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test src/strategies/copy-trading/graph-client.test.ts
```
Expected: FAIL — `Cannot find module './graph-client.ts'`

**Step 3: Implement GraphClient**

```typescript
// src/strategies/copy-trading/graph-client.ts
import type { CopiedTrade } from './types.ts'

const SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/polymarket/polymarket-orderbook-v2'

const QUERY = `
  query GetRecentTrades($wallet: String!, $since: Int!) {
    orderFilledEvents(
      where: { maker: $wallet, timestamp_gt: $since }
      orderBy: timestamp
      orderDirection: desc
      first: 10
    ) {
      id
      market { id }
      outcomeIndex
      side
      size
      price
      timestamp
      transactionHash
    }
  }
`

export class GraphClient {
  constructor(private url = SUBGRAPH_URL) {}

  async getRecentTrades(walletAddress: string, since: number): Promise<Omit<CopiedTrade, 'walletAddress' | 'label' | 'copiedSize' | 'originalSize'>[]> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { wallet: walletAddress.toLowerCase(), since } }),
    })

    if (!res.ok) throw new Error(`Graph request failed: ${res.status}`)

    const json = await res.json() as any
    const events = json?.data?.orderFilledEvents ?? []

    return events.map((e: any) => ({
      marketId: e.market.id,
      tokenId: `${e.market.id}-${e.outcomeIndex === 0 ? 'YES' : 'NO'}`,
      side: (e.side as string).toLowerCase() as 'buy' | 'sell',
      size: Number(e.size),
      price: Number(e.price),
      txHash: e.transactionHash,
      timestamp: Number(e.timestamp),
    }))
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test src/strategies/copy-trading/graph-client.test.ts
```
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/strategies/copy-trading/graph-client.ts src/strategies/copy-trading/graph-client.test.ts
git commit -m "feat: add GraphClient for Polymarket subgraph queries"
```

---

### Task 4: CopyTradingStrategy

**Files:**
- Create: `src/strategies/copy-trading/index.ts`
- Create: `src/strategies/copy-trading/index.test.ts`

**Step 1: Write failing tests**

```typescript
// src/strategies/copy-trading/index.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { CopyTradingStrategy } from './index.ts'
import type { CopyTradingConfig } from '../../config/types.ts'

const baseConfig: CopyTradingConfig = {
  enabled: true,
  wallets: [{ address: '0xAAA', label: 'Wallet A', sizeMode: 'fixed', fixedAmount: 50 }],
  maxDailyTradesPerWallet: 3,
  maxWalletExposureUsdc: 200,
  maxTotalExposureUsdc: 500,
}

const mockMarket = { id: 'mkt1', conditionId: 'cond1', question: 'Q?', category: 'test', endDate: '', yesPrice: 0.5, noPrice: 0.5, volume24h: 1000, liquidity: 500, active: true }
const mockSignals = { quant: { spread: 0.04, momentum: 0, liquidityScore: 0.5 }, llm: null, composite: { bias: 0, confidence: 0 } }

describe('CopyTradingStrategy', () => {
  it('returns null when disabled', async () => {
    const strategy = new CopyTradingStrategy({ ...baseConfig, enabled: false }, mock(() => Promise.resolve([])) as any)
    const intent = await strategy.evaluate(mockMarket, mockSignals)
    expect(intent).toBeNull()
  })

  it('returns null when no wallets configured', async () => {
    const strategy = new CopyTradingStrategy({ ...baseConfig, wallets: [] }, mock(() => Promise.resolve([])) as any)
    const intent = await strategy.evaluate(mockMarket, mockSignals)
    expect(intent).toBeNull()
  })

  it('generates TradeIntent for new trade with fixed sizing', async () => {
    const mockGetTrades = mock(() => Promise.resolve([{
      marketId: 'mkt1',
      tokenId: 'mkt1-YES',
      side: 'buy' as const,
      size: 200,
      price: 0.45,
      txHash: '0xTX1',
      timestamp: 1000,
    }]))

    const strategy = new CopyTradingStrategy(baseConfig, { getRecentTrades: mockGetTrades } as any)
    const intent = await strategy.evaluate(mockMarket, mockSignals)

    expect(intent).not.toBeNull()
    expect(intent!.size).toBe(50)           // fixed amount
    expect(intent!.side).toBe('buy')
    expect(intent!.price).toBe(0.45)
    expect(intent!.strategyId).toBe('copy-trading')
  })

  it('does not re-fire same txHash twice', async () => {
    const trade = { marketId: 'mkt1', tokenId: 'mkt1-YES', side: 'buy' as const, size: 200, price: 0.45, txHash: '0xTX1', timestamp: 1000 }
    const mockGetTrades = mock(() => Promise.resolve([trade]))
    const strategy = new CopyTradingStrategy(baseConfig, { getRecentTrades: mockGetTrades } as any)

    await strategy.evaluate(mockMarket, mockSignals) // first tick - fires
    const second = await strategy.evaluate(mockMarket, mockSignals) // same tx - skip
    expect(second).toBeNull()
  })

  it('blocks trade when daily limit reached', async () => {
    const mockGetTrades = mock()
      .mockResolvedValueOnce([{ marketId: 'mkt1', tokenId: 'mkt1-YES', side: 'buy' as const, size: 100, price: 0.45, txHash: '0xT1', timestamp: 1000 }])
      .mockResolvedValueOnce([{ marketId: 'mkt1', tokenId: 'mkt1-YES', side: 'buy' as const, size: 100, price: 0.45, txHash: '0xT2', timestamp: 1001 }])
      .mockResolvedValueOnce([{ marketId: 'mkt1', tokenId: 'mkt1-YES', side: 'buy' as const, size: 100, price: 0.45, txHash: '0xT3', timestamp: 1002 }])
      .mockResolvedValueOnce([{ marketId: 'mkt1', tokenId: 'mkt1-YES', side: 'buy' as const, size: 100, price: 0.45, txHash: '0xT4', timestamp: 1003 }])

    const strategy = new CopyTradingStrategy({ ...baseConfig, maxDailyTradesPerWallet: 3 }, { getRecentTrades: mockGetTrades } as any)

    await strategy.evaluate(mockMarket, mockSignals) // trade 1
    await strategy.evaluate(mockMarket, mockSignals) // trade 2
    await strategy.evaluate(mockMarket, mockSignals) // trade 3
    const blocked = await strategy.evaluate(mockMarket, mockSignals) // should be blocked
    expect(blocked).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test src/strategies/copy-trading/index.test.ts
```
Expected: FAIL — `Cannot find module './index.ts'`

**Step 3: Implement CopyTradingStrategy**

```typescript
// src/strategies/copy-trading/index.ts
import type { Strategy, TradeIntent } from '../base.strategy.ts'
import type { Market } from '../../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../signals/aggregator.ts'
import type { CopyTradingConfig } from '../../config/types.ts'
import type { CopiedTrade } from './types.ts'
import { GraphClient } from './graph-client.ts'

export class CopyTradingStrategy implements Strategy {
  readonly id = 'copy-trading'
  readonly name = 'Copy Trading'

  private graphClient: GraphClient
  private lastSeenTxHash = new Map<string, string>()
  private dailyTradeCount = new Map<string, number>()
  private walletExposure = new Map<string, number>()
  private totalExposure = 0
  private lastResetDay = new Date().toDateString()
  private recentCopies: CopiedTrade[] = []

  constructor(
    private config: CopyTradingConfig,
    graphClient?: GraphClient,
  ) {
    this.graphClient = graphClient ?? new GraphClient()
  }

  get enabled() { return this.config.enabled }
  getWeight() { return 0 }

  getRecentCopies(limit = 50): CopiedTrade[] {
    return this.recentCopies.slice(-limit)
  }

  private resetDailyCountersIfNeeded() {
    const today = new Date().toDateString()
    if (today !== this.lastResetDay) {
      this.dailyTradeCount.clear()
      this.walletExposure.clear()
      this.totalExposure = 0
      this.lastResetDay = today
    }
  }

  async evaluate(market: Market, _signals: SignalBundle): Promise<TradeIntent | null> {
    if (!this.config.enabled || this.config.wallets.length === 0) return null

    this.resetDailyCountersIfNeeded()

    for (const wallet of this.config.wallets) {
      const dailyCount = this.dailyTradeCount.get(wallet.address) ?? 0
      if (dailyCount >= this.config.maxDailyTradesPerWallet) continue

      const walletExp = this.walletExposure.get(wallet.address) ?? 0

      const since = 0 // in production: track last seen timestamp
      let rawTrades: Awaited<ReturnType<GraphClient['getRecentTrades']>>
      try {
        rawTrades = await this.graphClient.getRecentTrades(wallet.address, since)
      } catch (err) {
        console.error(`[CopyTrading] Graph query failed for ${wallet.label}:`, err)
        continue
      }

      for (const raw of rawTrades) {
        const seen = this.lastSeenTxHash.get(wallet.address)
        if (seen === raw.txHash) continue
        if (this.recentCopies.some(c => c.txHash === raw.txHash)) continue

        // Calculate copy size
        const copiedSize = wallet.sizeMode === 'fixed'
          ? (wallet.fixedAmount ?? 50)
          : raw.size * (wallet.proportionPct ?? 0.1)

        // Copy-specific risk checks
        if (walletExp + copiedSize > this.config.maxWalletExposureUsdc) continue
        if (this.totalExposure + copiedSize > this.config.maxTotalExposureUsdc) continue

        // Update state
        this.lastSeenTxHash.set(wallet.address, raw.txHash)
        this.dailyTradeCount.set(wallet.address, dailyCount + 1)
        this.walletExposure.set(wallet.address, walletExp + copiedSize)
        this.totalExposure += copiedSize

        const copy: CopiedTrade = {
          walletAddress: wallet.address,
          label: wallet.label,
          marketId: raw.marketId,
          tokenId: raw.tokenId,
          side: raw.side,
          originalSize: raw.size,
          copiedSize,
          price: raw.price,
          txHash: raw.txHash,
          timestamp: raw.timestamp,
        }
        this.recentCopies.push(copy)
        if (this.recentCopies.length > 200) this.recentCopies.shift()

        return {
          strategyId: this.id,
          marketId: raw.marketId,
          tokenId: raw.tokenId,
          side: raw.side,
          size: copiedSize,
          price: raw.price,
          reasoning: `Copy: ${wallet.label} ${raw.side} ${raw.size} @ ${raw.price} (tx: ${raw.txHash.slice(0, 10)}...)`,
        }
      }
    }

    return null
  }
}
```

**Step 4: Run tests**

```bash
bun test src/strategies/copy-trading/index.test.ts
```
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/strategies/copy-trading/index.ts src/strategies/copy-trading/index.test.ts
git commit -m "feat: implement CopyTradingStrategy with fixed/proportional sizing and risk limits"
```

---

### Task 5: Wire into bot

**Files:**
- Modify: `src/bot.ts`

**Step 1: Register CopyTradingStrategy in `startBot()`**

Add import near the other strategy imports:
```typescript
import { CopyTradingStrategy } from './strategies/copy-trading/index.ts'
```

In the strategies array (after `FundamentalStrategy`):
```typescript
const strategies = [
  new MarketMakerStrategy(...),
  new ArbitrageStrategy(...),
  new MomentumStrategy(...),
  new FundamentalStrategy(...),
  new CopyTradingStrategy(config.copyTrading),   // ← add this
]
```

Also extract the strategy reference for the dashboard:
```typescript
const copyTradingStrategy = strategies[4] as CopyTradingStrategy
```

Update `createDashboard` call to pass it:
```typescript
createDashboard({
  positionTracker,
  riskManager,
  strategyEngine,
  orderRepo,
  signalRepo,
  getBalance: () => polyClient.getBalance(),
  config,
  copyTradingStrategy,  // ← add this
}, config.dashboard.port)
```

**Step 2: Start the bot to verify no runtime errors**

```bash
bun run start
```
Expected: `Dashboard running at http://localhost:3000` — no errors

**Step 3: Commit**

```bash
git add src/bot.ts
git commit -m "feat: register CopyTradingStrategy in bot startup"
```

---

### Task 6: Dashboard page

**Files:**
- Modify: `src/infrastructure/dashboard/server.ts`
- Modify: `src/infrastructure/dashboard/views.ts`

**Step 1: Add `copyTradingStrategy` to `DashboardDeps`**

In `server.ts`, update the interface:
```typescript
import type { CopyTradingStrategy } from '../../strategies/copy-trading/index.ts'

interface DashboardDeps {
  // ... existing fields ...
  copyTradingStrategy?: CopyTradingStrategy
}
```

**Step 2: Add `/copy-trading` route in `server.ts`**

Add before the `// SSE endpoint` comment:

```typescript
app.get('/copy-trading', (c) => {
  const strategy = deps.copyTradingStrategy
  const wallets = deps.config.copyTrading.wallets
  const copies = strategy?.getRecentCopies(50) ?? []

  const walletRows = wallets.map(w => `<tr>
    <td style="font-family:monospace;font-size:0.85rem">${w.address.slice(0, 8)}…${w.address.slice(-6)}</td>
    <td>${w.label}</td>
    <td><span class="badge badge-warn">${w.sizeMode}</span></td>
    <td>${w.sizeMode === 'fixed' ? `$${w.fixedAmount}` : `${((w.proportionPct ?? 0) * 100).toFixed(0)}%`}</td>
  </tr>`).join('')

  const copyRows = copies.slice().reverse().map(c => `<tr>
    <td style="color:#888;font-size:0.8rem">${new Date(c.timestamp * 1000).toLocaleString()}</td>
    <td>${c.label}</td>
    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem">${c.marketId}</td>
    <td><span class="badge ${c.side === 'buy' ? 'badge-ok' : 'badge-err'}">${c.side}</span></td>
    <td>$${c.copiedSize.toFixed(2)}</td>
    <td style="color:#888;font-size:0.8rem">${c.txHash.slice(0, 10)}…</td>
  </tr>`).join('')

  const enabled = deps.config.copyTrading.enabled
  return c.html(layout('Copy Trading', `
    <h2 style="margin-bottom:0.5rem">Copy Trading</h2>
    <p style="margin-bottom:1rem;color:#888">Status: <span class="badge ${enabled ? 'badge-ok' : 'badge-err'}">${enabled ? 'Enabled' : 'Disabled'}</span></p>
    <div class="card" style="margin-bottom:1rem">
      <h3 style="margin-bottom:1rem;color:#7c83fd">Monitored Wallets</h3>
      <table>
        <thead><tr><th>Address</th><th>Label</th><th>Mode</th><th>Size</th></tr></thead>
        <tbody>${walletRows || '<tr><td colspan="4" style="text-align:center;color:#888">No wallets configured</td></tr>'}</tbody>
      </table>
    </div>
    <div class="card">
      <h3 style="margin-bottom:1rem;color:#7c83fd">Recent Copy Trades</h3>
      <table>
        <thead><tr><th>Time</th><th>Wallet</th><th>Market</th><th>Side</th><th>Size</th><th>TxHash</th></tr></thead>
        <tbody>${copyRows || '<tr><td colspan="6" style="text-align:center;color:#888">No copy trades yet</td></tr>'}</tbody>
      </table>
    </div>
  `))
})
```

**Step 3: Add nav link in `views.ts`**

In the `<nav>` section, add after `<a href="/config">Config</a>`:
```html
<a href="/copy-trading">Copy Trading</a>
```

**Step 4: Verify in browser**

```bash
bun run start
```
Open `http://localhost:3000/copy-trading` — should show wallet table and empty copy trades.

**Step 5: Commit**

```bash
git add src/infrastructure/dashboard/server.ts src/infrastructure/dashboard/views.ts
git commit -m "feat: add copy trading dashboard page"
```

---

### Task 7: Run all tests

**Step 1: Run full test suite**

```bash
bun test
```
Expected: all tests pass

**Step 2: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: copy trading test cleanup"
```

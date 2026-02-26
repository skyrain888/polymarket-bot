# Polymarket Trading Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a modular TypeScript trading bot for Polymarket with multi-strategy execution, dual-track AI analysis, comprehensive risk management, and a real-time web dashboard.

**Architecture:** Modular monolith with a layered design — Strategy → Signal → Core → Infrastructure. Modules communicate via a typed EventBus. The bot runs as a single Bun process with an embedded Hono HTTP server for the dashboard.

**Tech Stack:** Bun runtime, TypeScript, `@polymarket/clob-client`, Hono + HTMX, SQLite (`bun:sqlite`), Anthropic SDK, OpenAI SDK, `node-telegram-bot-api`.

---

## Phase 1: Project Foundation

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Initialize Bun project**

```bash
cd /Users/sky/Documents/dev/project/specTest/transBoot
bun init -y
```

**Step 2: Install dependencies**

```bash
bun add @polymarket/clob-client hono @hono/node-server ethers @anthropic-ai/sdk openai node-telegram-bot-api
bun add -d @types/node @types/node-telegram-bot-api
```

**Step 3: Replace tsconfig.json with**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**Step 4: Create .env.example**

```bash
# Polymarket
POLY_API_KEY=
POLY_API_SECRET=
POLY_API_PASSPHRASE=
POLY_PRIVATE_KEY=

# LLM
LLM_PROVIDER=claude
LLM_API_KEY=
LLM_MODEL=claude-opus-4-6

# Telegram
TELEGRAM_TOKEN=
TELEGRAM_CHAT_ID=

# Discord
DISCORD_WEBHOOK_URL=

# Bot
BOT_MODE=paper
DASHBOARD_PORT=3000
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
.env
*.db
*.db-shm
*.db-wal
```

**Step 6: Create src/index.ts stub**

```ts
console.log('transBoot starting...')
```

**Step 7: Verify it runs**

```bash
bun run src/index.ts
```
Expected output: `transBoot starting...`

**Step 8: Commit**

```bash
git add package.json tsconfig.json src/index.ts .env.example .gitignore bun.lockb
git commit -m "feat: initialize Bun project with dependencies"
```

---

### Task 2: Configuration System

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/index.ts`
- Create: `tests/config.test.ts`

**Step 1: Write the failing test**

```ts
// tests/config.test.ts
import { describe, test, expect } from 'bun:test'

describe('Config', () => {
  test('loads config with defaults', async () => {
    process.env.BOT_MODE = 'paper'
    process.env.LLM_PROVIDER = 'claude'
    const { loadConfig } = await import('../src/config/index.ts')
    const config = loadConfig()
    expect(config.mode).toBe('paper')
    expect(config.llm.provider).toBe('claude')
    expect(config.risk.maxPositionPct).toBe(0.20)
  })

  test('throws if required env missing', async () => {
    delete process.env.POLY_PRIVATE_KEY
    process.env.BOT_MODE = 'live'
    const { loadConfig } = await import('../src/config/index.ts')
    expect(() => loadConfig()).toThrow('POLY_PRIVATE_KEY required in live mode')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/config.test.ts
```
Expected: FAIL — `Cannot find module`

**Step 3: Create src/config/types.ts**

```ts
export type BotMode = 'backtest' | 'paper' | 'live'
export type LLMProviderName = 'claude' | 'openai' | 'gemini' | 'ollama'

export interface RiskConfig {
  maxPositionPct: number
  maxTotalExposurePct: number
  maxDailyLossPct: number
  maxConsecutiveLosses: number
  cooldownMinutes: number
  maxVolumeImpactPct: number
  maxSlippagePct: number
}

export interface StrategyConfig {
  enabled: boolean
  weight: number
}

export interface BotConfig {
  mode: BotMode
  polymarket: {
    apiKey: string
    apiSecret: string
    apiPassphrase: string
    privateKey: string
    host: string
  }
  llm: {
    provider: LLMProviderName
    apiKey: string
    model: string
    ollamaHost?: string
  }
  risk: RiskConfig
  strategies: {
    marketMaker: StrategyConfig
    arbitrage: StrategyConfig
    momentum: StrategyConfig
    fundamental: StrategyConfig
  }
  notify: {
    telegram: { token: string; chatId: string } | null
    discord: { webhookUrl: string } | null
  }
  dashboard: { port: number }
  dbPath: string
}
```

**Step 4: Create src/config/index.ts**

```ts
import type { BotConfig } from './types.ts'

export function loadConfig(): BotConfig {
  const mode = (process.env.BOT_MODE ?? 'paper') as BotConfig['mode']

  if (mode === 'live' && !process.env.POLY_PRIVATE_KEY) {
    throw new Error('POLY_PRIVATE_KEY required in live mode')
  }

  return {
    mode,
    polymarket: {
      apiKey: process.env.POLY_API_KEY ?? '',
      apiSecret: process.env.POLY_API_SECRET ?? '',
      apiPassphrase: process.env.POLY_API_PASSPHRASE ?? '',
      privateKey: process.env.POLY_PRIVATE_KEY ?? '',
      host: 'https://clob.polymarket.com',
    },
    llm: {
      provider: (process.env.LLM_PROVIDER ?? 'claude') as BotConfig['llm']['provider'],
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? 'claude-opus-4-6',
      ollamaHost: process.env.OLLAMA_HOST,
    },
    risk: {
      maxPositionPct: Number(process.env.RISK_MAX_POSITION_PCT ?? 0.20),
      maxTotalExposurePct: Number(process.env.RISK_MAX_EXPOSURE_PCT ?? 0.60),
      maxDailyLossPct: Number(process.env.RISK_MAX_DAILY_LOSS_PCT ?? 0.05),
      maxConsecutiveLosses: Number(process.env.RISK_MAX_CONSECUTIVE_LOSSES ?? 5),
      cooldownMinutes: Number(process.env.RISK_COOLDOWN_MINUTES ?? 60),
      maxVolumeImpactPct: Number(process.env.RISK_MAX_VOLUME_IMPACT_PCT ?? 0.05),
      maxSlippagePct: Number(process.env.RISK_MAX_SLIPPAGE_PCT ?? 0.02),
    },
    strategies: {
      marketMaker: { enabled: process.env.STRAT_MM_ENABLED !== 'false', weight: Number(process.env.STRAT_MM_WEIGHT ?? 0.25) },
      arbitrage:   { enabled: process.env.STRAT_ARB_ENABLED !== 'false', weight: Number(process.env.STRAT_ARB_WEIGHT ?? 0.25) },
      momentum:    { enabled: process.env.STRAT_MOM_ENABLED !== 'false', weight: Number(process.env.STRAT_MOM_WEIGHT ?? 0.25) },
      fundamental: { enabled: process.env.STRAT_FUND_ENABLED !== 'false', weight: Number(process.env.STRAT_FUND_WEIGHT ?? 0.25) },
    },
    notify: {
      telegram: process.env.TELEGRAM_TOKEN
        ? { token: process.env.TELEGRAM_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID ?? '' }
        : null,
      discord: process.env.DISCORD_WEBHOOK_URL
        ? { webhookUrl: process.env.DISCORD_WEBHOOK_URL }
        : null,
    },
    dashboard: { port: Number(process.env.DASHBOARD_PORT ?? 3000) },
    dbPath: process.env.DB_PATH ?? './data/transBoot.db',
  }
}
```

**Step 5: Run test to verify it passes**

```bash
bun test tests/config.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/config/ tests/config.test.ts
git commit -m "feat: add typed configuration system with env loading"
```

---

### Task 3: Event Bus

**Files:**
- Create: `src/core/event-bus.ts`
- Create: `tests/core/event-bus.test.ts`

**Step 1: Write the failing test**

```ts
// tests/core/event-bus.test.ts
import { describe, test, expect, mock } from 'bun:test'
import { EventBus } from '../../src/core/event-bus.ts'

describe('EventBus', () => {
  test('emits events to subscribers', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.on('trade:executed', handler)
    bus.emit('trade:executed', { marketId: 'x', side: 'buy' })
    expect(handler).toHaveBeenCalledWith({ marketId: 'x', side: 'buy' })
  })

  test('off() unsubscribes handler', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.on('trade:executed', handler)
    bus.off('trade:executed', handler)
    bus.emit('trade:executed', {})
    expect(handler).not.toHaveBeenCalled()
  })

  test('once() fires only one time', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.once('risk:breach', handler)
    bus.emit('risk:breach', {})
    bus.emit('risk:breach', {})
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/core/event-bus.test.ts
```
Expected: FAIL

**Step 3: Create src/core/event-bus.ts**

```ts
export type EventMap = {
  'trade:intent':    { strategyId: string; marketId: string; side: 'buy' | 'sell'; size: number; price: number }
  'trade:executed':  { orderId: string; marketId: string; side: string; size: number; price: number }
  'trade:rejected':  { reason: string; strategyId: string; marketId: string }
  'risk:breach':     { type: string; strategyId?: string; message: string }
  'circuit:tripped': { strategyId: string; reason: string }
  'circuit:reset':   { strategyId: string }
  'signal:ready':    { marketId: string }
  'position:updated':{ marketId: string }
  [key: string]: unknown
}

type Handler<T = unknown> = (payload: T) => void

export class EventBus {
  private listeners = new Map<string, Set<Handler>>()

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set())
    }
    this.listeners.get(event as string)!.add(handler as Handler)
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.listeners.get(event as string)?.delete(handler as Handler)
  }

  once<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    const wrapper: Handler = (payload) => {
      handler(payload as EventMap[K])
      this.off(event, wrapper as Handler<EventMap[K]>)
    }
    this.on(event, wrapper as Handler<EventMap[K]>)
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.listeners.get(event as string)?.forEach(h => h(payload))
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/core/event-bus.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/event-bus.ts tests/core/event-bus.test.ts
git commit -m "feat: add typed EventBus for inter-module communication"
```

---

## Phase 2: Infrastructure

### Task 4: SQLite Storage Layer

**Files:**
- Create: `src/infrastructure/storage/schema.ts`
- Create: `src/infrastructure/storage/db.ts`
- Create: `src/infrastructure/storage/repositories.ts`
- Create: `tests/infrastructure/storage.test.ts`

**Step 1: Write the failing test**

```ts
// tests/infrastructure/storage.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { createDb } from '../../src/infrastructure/storage/db.ts'
import { OrderRepository } from '../../src/infrastructure/storage/repositories.ts'

describe('OrderRepository', () => {
  let db: ReturnType<typeof createDb>
  let repo: OrderRepository

  beforeEach(() => {
    db = createDb(':memory:')
    repo = new OrderRepository(db)
  })

  test('inserts and retrieves orders', () => {
    const id = repo.insert({
      strategyId: 'momentum',
      marketId: 'market-1',
      side: 'buy',
      size: 10,
      price: 0.55,
      status: 'filled',
      reason: null,
    })
    const order = repo.findById(id)
    expect(order?.marketId).toBe('market-1')
    expect(order?.price).toBe(0.55)
  })

  test('lists orders by strategy', () => {
    repo.insert({ strategyId: 'arb', marketId: 'm1', side: 'buy', size: 5, price: 0.4, status: 'filled', reason: null })
    repo.insert({ strategyId: 'arb', marketId: 'm2', side: 'sell', size: 5, price: 0.6, status: 'filled', reason: null })
    repo.insert({ strategyId: 'mm', marketId: 'm3', side: 'buy', size: 5, price: 0.5, status: 'filled', reason: null })
    const arbOrders = repo.findByStrategy('arb')
    expect(arbOrders).toHaveLength(2)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/infrastructure/storage.test.ts
```
Expected: FAIL

**Step 3: Create src/infrastructure/storage/schema.ts**

```ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  end_date TEXT,
  yes_price REAL,
  no_price REAL,
  volume REAL,
  snapshot_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  size REAL NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  size REAL NOT NULL DEFAULT 0,
  avg_price REAL NOT NULL DEFAULT 0,
  unrealized_pnl REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(market_id, strategy_id)
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  sentiment TEXT,
  confidence REAL,
  summary TEXT,
  raw_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  balance REAL NOT NULL,
  total_pnl REAL NOT NULL DEFAULT 0,
  snapshot_date TEXT NOT NULL DEFAULT (date('now')),
  UNIQUE(snapshot_date)
);
`
```

**Step 4: Create src/infrastructure/storage/db.ts**

```ts
import { Database } from 'bun:sqlite'
import { SCHEMA } from './schema.ts'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function createDb(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec(SCHEMA)
  return db
}
```

**Step 5: Create src/infrastructure/storage/repositories.ts**

```ts
import type { Database } from 'bun:sqlite'

export interface OrderRow {
  id?: number
  strategyId: string
  marketId: string
  side: string
  size: number
  price: number
  status: string
  reason: string | null
}

export class OrderRepository {
  constructor(private db: Database) {}

  insert(order: Omit<OrderRow, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO orders (strategy_id, market_id, side, size, price, status, reason)
      VALUES ($strategyId, $marketId, $side, $size, $price, $status, $reason)
    `)
    const result = stmt.run({
      $strategyId: order.strategyId,
      $marketId: order.marketId,
      $side: order.side,
      $size: order.size,
      $price: order.price,
      $status: order.status,
      $reason: order.reason,
    })
    return result.lastInsertRowid as number
  }

  findById(id: number): OrderRow | null {
    const row = this.db.query(`SELECT * FROM orders WHERE id = ?`).get(id) as any
    if (!row) return null
    return { id: row.id, strategyId: row.strategy_id, marketId: row.market_id, side: row.side, size: row.size, price: row.price, status: row.status, reason: row.reason }
  }

  findByStrategy(strategyId: string): OrderRow[] {
    const rows = this.db.query(`SELECT * FROM orders WHERE strategy_id = ? ORDER BY created_at DESC`).all(strategyId) as any[]
    return rows.map(r => ({ id: r.id, strategyId: r.strategy_id, marketId: r.market_id, side: r.side, size: r.size, price: r.price, status: r.status, reason: r.reason }))
  }

  findRecent(limit = 50): OrderRow[] {
    const rows = this.db.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`).all(limit) as any[]
    return rows.map(r => ({ id: r.id, strategyId: r.strategy_id, marketId: r.market_id, side: r.side, size: r.size, price: r.price, status: r.status, reason: r.reason }))
  }
}

export interface PositionRow {
  id?: number
  marketId: string
  strategyId: string
  size: number
  avgPrice: number
  unrealizedPnl: number
}

export class PositionRepository {
  constructor(private db: Database) {}

  upsert(pos: Omit<PositionRow, 'id'>): void {
    this.db.prepare(`
      INSERT INTO positions (market_id, strategy_id, size, avg_price, unrealized_pnl, updated_at)
      VALUES ($marketId, $strategyId, $size, $avgPrice, $unrealizedPnl, datetime('now'))
      ON CONFLICT(market_id, strategy_id) DO UPDATE SET
        size = $size, avg_price = $avgPrice, unrealized_pnl = $unrealizedPnl, updated_at = datetime('now')
    `).run({ $marketId: pos.marketId, $strategyId: pos.strategyId, $size: pos.size, $avgPrice: pos.avgPrice, $unrealizedPnl: pos.unrealizedPnl })
  }

  findAll(): PositionRow[] {
    const rows = this.db.query(`SELECT * FROM positions WHERE size != 0`).all() as any[]
    return rows.map(r => ({ id: r.id, marketId: r.market_id, strategyId: r.strategy_id, size: r.size, avgPrice: r.avg_price, unrealizedPnl: r.unrealized_pnl }))
  }

  findByMarket(marketId: string): PositionRow[] {
    const rows = this.db.query(`SELECT * FROM positions WHERE market_id = ?`).all(marketId) as any[]
    return rows.map(r => ({ id: r.id, marketId: r.market_id, strategyId: r.strategy_id, size: r.size, avgPrice: r.avg_price, unrealizedPnl: r.unrealized_pnl }))
  }
}

export interface SignalRow {
  id?: number
  marketId: string
  provider: string
  sentiment: string | null
  confidence: number | null
  summary: string | null
  rawResponse: string | null
}

export class SignalRepository {
  constructor(private db: Database) {}

  insert(signal: Omit<SignalRow, 'id'>): void {
    this.db.prepare(`
      INSERT INTO signals (market_id, provider, sentiment, confidence, summary, raw_response)
      VALUES ($marketId, $provider, $sentiment, $confidence, $summary, $rawResponse)
    `).run({ $marketId: signal.marketId, $provider: signal.provider, $sentiment: signal.sentiment, $confidence: signal.confidence, $summary: signal.summary, $rawResponse: signal.rawResponse })
  }

  findRecent(marketId: string, limit = 10): SignalRow[] {
    const rows = this.db.query(`SELECT * FROM signals WHERE market_id = ? ORDER BY created_at DESC LIMIT ?`).all(marketId, limit) as any[]
    return rows.map(r => ({ id: r.id, marketId: r.market_id, provider: r.provider, sentiment: r.sentiment, confidence: r.confidence, summary: r.summary, rawResponse: r.raw_response }))
  }
}
```

**Step 6: Run test to verify it passes**

```bash
bun test tests/infrastructure/storage.test.ts
```
Expected: PASS

**Step 7: Commit**

```bash
git add src/infrastructure/storage/ tests/infrastructure/storage.test.ts
git commit -m "feat: add SQLite storage layer with schema and repositories"
```

---

### Task 5: Polymarket Client Wrapper

**Files:**
- Create: `src/infrastructure/polymarket/types.ts`
- Create: `src/infrastructure/polymarket/client.ts`
- Create: `tests/infrastructure/polymarket-client.test.ts`

**Step 1: Write the failing test**

```ts
// tests/infrastructure/polymarket-client.test.ts
import { describe, test, expect, mock } from 'bun:test'
import { PolymarketClient } from '../../src/infrastructure/polymarket/client.ts'

describe('PolymarketClient', () => {
  test('paper mode skips real API calls', async () => {
    const client = new PolymarketClient({ mode: 'paper', privateKey: '', apiKey: '', apiSecret: '', apiPassphrase: '', host: '' })
    const result = await client.placeOrder({ marketId: 'x', tokenId: 'y', side: 'buy', size: 10, price: 0.5 })
    expect(result.status).toBe('simulated')
  })

  test('getMarkets returns array', async () => {
    const client = new PolymarketClient({ mode: 'paper', privateKey: '', apiKey: '', apiSecret: '', apiPassphrase: '', host: '' })
    // Paper mode returns mock data
    const markets = await client.getMarkets()
    expect(Array.isArray(markets)).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/infrastructure/polymarket-client.test.ts
```
Expected: FAIL

**Step 3: Create src/infrastructure/polymarket/types.ts**

```ts
export interface Market {
  id: string
  conditionId: string
  question: string
  category: string
  endDate: string
  yesPrice: number
  noPrice: number
  volume24h: number
  liquidity: number
  active: boolean
}

export interface OrderIntent {
  marketId: string
  tokenId: string
  side: 'buy' | 'sell'
  size: number
  price: number
}

export interface OrderResult {
  orderId: string
  status: 'open' | 'filled' | 'cancelled' | 'simulated'
  marketId: string
  side: string
  size: number
  price: number
}

export interface OrderBook {
  bids: { price: number; size: number }[]
  asks: { price: number; size: number }[]
}
```

**Step 4: Create src/infrastructure/polymarket/client.ts**

```ts
import type { Market, OrderIntent, OrderResult, OrderBook } from './types.ts'

interface ClientConfig {
  mode: 'paper' | 'live' | 'backtest'
  privateKey: string
  apiKey: string
  apiSecret: string
  apiPassphrase: string
  host: string
}

export class PolymarketClient {
  private clobClient: any = null

  constructor(private config: ClientConfig) {}

  private async getClobClient() {
    if (this.config.mode !== 'live') return null
    if (!this.clobClient) {
      const { ClobClient } = await import('@polymarket/clob-client')
      const { ethers } = await import('ethers')
      const signer = new ethers.Wallet(this.config.privateKey)
      this.clobClient = new ClobClient(this.config.host, 137, signer, {
        key: this.config.apiKey,
        secret: this.config.apiSecret,
        passphrase: this.config.apiPassphrase,
      })
    }
    return this.clobClient
  }

  async getMarkets(nextCursor?: string): Promise<Market[]> {
    if (this.config.mode !== 'live') {
      // Paper/backtest: return mock markets
      return []
    }
    const client = await this.getClobClient()
    const resp = await client.getMarkets(nextCursor)
    return (resp.data ?? []).map((m: any) => ({
      id: m.id,
      conditionId: m.condition_id,
      question: m.question,
      category: m.category ?? 'unknown',
      endDate: m.end_date_iso,
      yesPrice: Number(m.tokens?.[0]?.price ?? 0),
      noPrice: Number(m.tokens?.[1]?.price ?? 0),
      volume24h: Number(m.volume_24hr ?? 0),
      liquidity: Number(m.liquidity ?? 0),
      active: m.active,
    }))
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    if (this.config.mode !== 'live') {
      return { bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 100 }] }
    }
    const client = await this.getClobClient()
    return client.getOrderBook(tokenId)
  }

  async placeOrder(intent: OrderIntent): Promise<OrderResult> {
    if (this.config.mode !== 'live') {
      return {
        orderId: `sim-${Date.now()}`,
        status: 'simulated',
        marketId: intent.marketId,
        side: intent.side,
        size: intent.size,
        price: intent.price,
      }
    }
    const client = await this.getClobClient()
    const { ClobClient, Side, OrderType } = await import('@polymarket/clob-client')
    const order = await client.createOrder({
      tokenID: intent.tokenId,
      price: intent.price,
      side: intent.side === 'buy' ? Side.BUY : Side.SELL,
      size: intent.size,
    })
    const resp = await client.postOrder(order, OrderType.GTC)
    return {
      orderId: resp.orderID ?? `ord-${Date.now()}`,
      status: resp.status ?? 'open',
      marketId: intent.marketId,
      side: intent.side,
      size: intent.size,
      price: intent.price,
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    if (this.config.mode !== 'live') return
    const client = await this.getClobClient()
    await client.cancelOrder({ orderID: orderId })
  }

  async getBalance(): Promise<number> {
    if (this.config.mode !== 'live') return 10000 // paper balance
    const client = await this.getClobClient()
    const bal = await client.getBalanceAllowance({ asset_type: 'USDC' })
    return Number(bal.balance ?? 0)
  }
}
```

**Step 5: Run test to verify it passes**

```bash
bun test tests/infrastructure/polymarket-client.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/infrastructure/polymarket/ tests/infrastructure/polymarket-client.test.ts
git commit -m "feat: add Polymarket CLOB client wrapper with paper mode"
```

---

## Phase 3: Signal Layer

### Task 6: LLM Provider Interface + Claude Provider

**Files:**
- Create: `src/signals/llm/provider.interface.ts`
- Create: `src/signals/llm/claude.provider.ts`
- Create: `src/signals/llm/openai.provider.ts`
- Create: `src/signals/llm/gemini.provider.ts`
- Create: `src/signals/llm/ollama.provider.ts`
- Create: `src/signals/llm/factory.ts`
- Create: `tests/signals/llm.test.ts`

**Step 1: Write the failing test**

```ts
// tests/signals/llm.test.ts
import { describe, test, expect, mock } from 'bun:test'
import { createLLMProvider } from '../../src/signals/llm/factory.ts'

describe('LLM Provider Factory', () => {
  test('creates claude provider', () => {
    const provider = createLLMProvider({ provider: 'claude', apiKey: 'test', model: 'claude-haiku-4-5-20251001' })
    expect(provider).toBeDefined()
    expect(typeof provider.analyze).toBe('function')
  })

  test('creates openai provider', () => {
    const provider = createLLMProvider({ provider: 'openai', apiKey: 'test', model: 'gpt-4o-mini' })
    expect(provider).toBeDefined()
  })

  test('throws for unknown provider', () => {
    expect(() => createLLMProvider({ provider: 'unknown' as any, apiKey: '', model: '' })).toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/signals/llm.test.ts
```
Expected: FAIL

**Step 3: Create src/signals/llm/provider.interface.ts**

```ts
export interface MarketContext {
  marketId: string
  question: string
  category: string
  yesPrice: number
  noPrice: number
  volume24h: number
  endDate: string
  recentNews?: string[]
}

export interface AnalysisResult {
  sentiment: 'bullish' | 'bearish' | 'neutral'
  confidence: number      // 0-1
  estimatedProbability: number  // 0-1, bot's estimate of YES outcome
  summary: string
  reasoning: string
  rawResponse?: string
}

export interface LLMProvider {
  name: string
  analyze(context: MarketContext): Promise<AnalysisResult>
}
```

**Step 4: Create src/signals/llm/claude.provider.ts**

```ts
import type { LLMProvider, MarketContext, AnalysisResult } from './provider.interface.ts'
import Anthropic from '@anthropic-ai/sdk'

const SYSTEM_PROMPT = `You are a prediction market analyst. Analyze the given market and return a JSON object with:
- sentiment: "bullish" | "bearish" | "neutral" (from YES perspective)
- confidence: 0-1 (how confident you are in your analysis)
- estimatedProbability: 0-1 (your estimate of YES outcome probability)
- summary: one sentence summary
- reasoning: 2-3 sentences of reasoning

Respond ONLY with valid JSON.`

export class ClaudeProvider implements LLMProvider {
  name = 'claude'
  private client: Anthropic

  constructor(private config: { apiKey: string; model: string }) {
    this.client = new Anthropic({ apiKey: config.apiKey })
  }

  async analyze(ctx: MarketContext): Promise<AnalysisResult> {
    const prompt = `Market: ${ctx.question}
Category: ${ctx.category}
Current YES price: ${ctx.yesPrice} (implies ${(ctx.yesPrice * 100).toFixed(1)}% probability)
End date: ${ctx.endDate}
24h volume: $${ctx.volume24h.toLocaleString()}
${ctx.recentNews?.length ? `\nRecent news:\n${ctx.recentNews.join('\n')}` : ''}`

    const message = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (message.content[0] as any).text
    try {
      const parsed = JSON.parse(raw)
      return { ...parsed, rawResponse: raw }
    } catch {
      return { sentiment: 'neutral', confidence: 0, estimatedProbability: ctx.yesPrice, summary: 'Parse error', reasoning: raw, rawResponse: raw }
    }
  }
}
```

**Step 5: Create src/signals/llm/openai.provider.ts**

```ts
import type { LLMProvider, MarketContext, AnalysisResult } from './provider.interface.ts'
import OpenAI from 'openai'

export class OpenAIProvider implements LLMProvider {
  name = 'openai'
  private client: OpenAI

  constructor(private config: { apiKey: string; model: string }) {
    this.client = new OpenAI({ apiKey: config.apiKey })
  }

  async analyze(ctx: MarketContext): Promise<AnalysisResult> {
    const prompt = `Analyze this prediction market as JSON only:
Market: ${ctx.question}
YES price: ${ctx.yesPrice}, End: ${ctx.endDate}
Return: {"sentiment":"bullish"|"bearish"|"neutral","confidence":0-1,"estimatedProbability":0-1,"summary":"...","reasoning":"..."}`

    const resp = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 512,
    })

    const raw = resp.choices[0]?.message?.content ?? '{}'
    try {
      return { ...JSON.parse(raw), rawResponse: raw }
    } catch {
      return { sentiment: 'neutral', confidence: 0, estimatedProbability: ctx.yesPrice, summary: 'Parse error', reasoning: raw, rawResponse: raw }
    }
  }
}
```

**Step 6: Create src/signals/llm/gemini.provider.ts**

```ts
import type { LLMProvider, MarketContext, AnalysisResult } from './provider.interface.ts'

export class GeminiProvider implements LLMProvider {
  name = 'gemini'

  constructor(private config: { apiKey: string; model: string }) {}

  async analyze(ctx: MarketContext): Promise<AnalysisResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`
    const prompt = `Analyze this prediction market, respond with JSON only:
Market: ${ctx.question}, YES price: ${ctx.yesPrice}, End: ${ctx.endDate}
JSON schema: {"sentiment":"bullish"|"bearish"|"neutral","confidence":0-1,"estimatedProbability":0-1,"summary":"...","reasoning":"..."}`

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    })
    const data = await resp.json() as any
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
    try {
      const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
      return { ...JSON.parse(clean), rawResponse: raw }
    } catch {
      return { sentiment: 'neutral', confidence: 0, estimatedProbability: ctx.yesPrice, summary: 'Parse error', reasoning: raw, rawResponse: raw }
    }
  }
}
```

**Step 7: Create src/signals/llm/ollama.provider.ts**

```ts
import type { LLMProvider, MarketContext, AnalysisResult } from './provider.interface.ts'

export class OllamaProvider implements LLMProvider {
  name = 'ollama'
  private host: string

  constructor(private config: { model: string; ollamaHost?: string }) {
    this.host = config.ollamaHost ?? 'http://localhost:11434'
  }

  async analyze(ctx: MarketContext): Promise<AnalysisResult> {
    const prompt = `Analyze this prediction market. Respond with JSON only.
Market: ${ctx.question}, YES price: ${ctx.yesPrice}, End: ${ctx.endDate}
Return JSON: {"sentiment":"bullish"|"bearish"|"neutral","confidence":0-1,"estimatedProbability":0-1,"summary":"...","reasoning":"..."}`

    const resp = await fetch(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, prompt, stream: false, format: 'json' }),
    })
    const data = await resp.json() as any
    const raw = data.response ?? '{}'
    try {
      return { ...JSON.parse(raw), rawResponse: raw }
    } catch {
      return { sentiment: 'neutral', confidence: 0, estimatedProbability: ctx.yesPrice, summary: 'Parse error', reasoning: raw, rawResponse: raw }
    }
  }
}
```

**Step 8: Create src/signals/llm/factory.ts**

```ts
import type { LLMProvider } from './provider.interface.ts'
import { ClaudeProvider } from './claude.provider.ts'
import { OpenAIProvider } from './openai.provider.ts'
import { GeminiProvider } from './gemini.provider.ts'
import { OllamaProvider } from './ollama.provider.ts'
import type { LLMProviderName } from '../../config/types.ts'

interface FactoryConfig {
  provider: LLMProviderName
  apiKey: string
  model: string
  ollamaHost?: string
}

export function createLLMProvider(config: FactoryConfig): LLMProvider {
  switch (config.provider) {
    case 'claude':  return new ClaudeProvider(config)
    case 'openai':  return new OpenAIProvider(config)
    case 'gemini':  return new GeminiProvider(config)
    case 'ollama':  return new OllamaProvider(config)
    default: throw new Error(`Unknown LLM provider: ${config.provider}`)
  }
}
```

**Step 9: Run test to verify it passes**

```bash
bun test tests/signals/llm.test.ts
```
Expected: PASS

**Step 10: Commit**

```bash
git add src/signals/llm/ tests/signals/llm.test.ts
git commit -m "feat: add pluggable LLM provider system (Claude/OpenAI/Gemini/Ollama)"
```

---

### Task 7: Quant Engine + Signal Aggregator

**Files:**
- Create: `src/signals/quant/engine.ts`
- Create: `src/signals/aggregator.ts`
- Create: `tests/signals/quant.test.ts`

**Step 1: Write the failing test**

```ts
// tests/signals/quant.test.ts
import { describe, test, expect } from 'bun:test'
import { QuantEngine } from '../../src/signals/quant/engine.ts'
import type { OrderBook } from '../../src/infrastructure/polymarket/types.ts'

describe('QuantEngine', () => {
  const engine = new QuantEngine()

  test('computes momentum from price history', () => {
    const prices = [0.40, 0.42, 0.45, 0.47, 0.50]
    const momentum = engine.computeMomentum(prices)
    expect(momentum).toBeGreaterThan(0)
  })

  test('momentum is negative when prices falling', () => {
    const prices = [0.60, 0.55, 0.50, 0.45, 0.40]
    const momentum = engine.computeMomentum(prices)
    expect(momentum).toBeLessThan(0)
  })

  test('computes spread from order book', () => {
    const book: OrderBook = {
      bids: [{ price: 0.48, size: 100 }],
      asks: [{ price: 0.52, size: 100 }],
    }
    const spread = engine.computeSpread(book)
    expect(spread).toBeCloseTo(0.04)
  })

  test('computes liquidity score', () => {
    const book: OrderBook = {
      bids: [{ price: 0.49, size: 500 }, { price: 0.48, size: 300 }],
      asks: [{ price: 0.51, size: 500 }, { price: 0.52, size: 300 }],
    }
    const score = engine.computeLiquidityScore(book)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/signals/quant.test.ts
```
Expected: FAIL

**Step 3: Create src/signals/quant/engine.ts**

```ts
import type { OrderBook } from '../../infrastructure/polymarket/types.ts'

export interface QuantSignal {
  momentum: number        // -1 to 1
  priceDeviation: number  // distance from 0.5 fair value
  liquidityScore: number  // 0 to 1
  spread: number          // bid-ask spread
  volumeScore: number     // relative volume indicator
}

export class QuantEngine {
  computeMomentum(priceHistory: number[]): number {
    if (priceHistory.length < 2) return 0
    const n = priceHistory.length
    const recent = priceHistory.slice(-3)
    const older = priceHistory.slice(0, Math.max(1, n - 3))
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length
    return Math.max(-1, Math.min(1, (recentAvg - olderAvg) / olderAvg * 10))
  }

  computeSpread(book: OrderBook): number {
    const bestBid = book.bids[0]?.price ?? 0
    const bestAsk = book.asks[0]?.price ?? 1
    return bestAsk - bestBid
  }

  computeLiquidityScore(book: OrderBook): number {
    const bidDepth = book.bids.slice(0, 5).reduce((sum, l) => sum + l.size * l.price, 0)
    const askDepth = book.asks.slice(0, 5).reduce((sum, l) => sum + l.size * l.price, 0)
    const totalDepth = bidDepth + askDepth
    // Normalize: $10k+ depth = score of 1
    return Math.min(1, totalDepth / 10000)
  }

  computePriceDeviation(price: number): number {
    // How far from 0.5 (pure uncertainty)
    return Math.abs(price - 0.5) * 2 // 0 = at 0.5, 1 = at 0 or 1
  }

  computeVolumeScore(volume24h: number): number {
    // Normalize: $100k+ = score of 1
    return Math.min(1, volume24h / 100000)
  }

  compute(priceHistory: number[], book: OrderBook, volume24h: number): QuantSignal {
    return {
      momentum: this.computeMomentum(priceHistory),
      priceDeviation: priceHistory.length ? this.computePriceDeviation(priceHistory[priceHistory.length - 1]) : 0,
      liquidityScore: this.computeLiquidityScore(book),
      spread: this.computeSpread(book),
      volumeScore: this.computeVolumeScore(volume24h),
    }
  }
}
```

**Step 4: Create src/signals/aggregator.ts**

```ts
import type { QuantSignal } from './quant/engine.ts'
import type { AnalysisResult } from './llm/provider.interface.ts'

export interface SignalBundle {
  marketId: string
  timestamp: Date
  quant: QuantSignal
  llm: AnalysisResult | null
}

export class SignalAggregator {
  private bundles = new Map<string, SignalBundle>()

  update(marketId: string, quant: QuantSignal, llm: AnalysisResult | null): SignalBundle {
    const bundle: SignalBundle = { marketId, timestamp: new Date(), quant, llm }
    this.bundles.set(marketId, bundle)
    return bundle
  }

  get(marketId: string): SignalBundle | undefined {
    return this.bundles.get(marketId)
  }

  getAll(): SignalBundle[] {
    return [...this.bundles.values()]
  }
}
```

**Step 5: Run test to verify it passes**

```bash
bun test tests/signals/quant.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/signals/ tests/signals/quant.test.ts
git commit -m "feat: add quant engine and signal aggregator"
```

---

## Phase 4: Core Layer

### Task 8: Position Tracker

**Files:**
- Create: `src/core/position-tracker.ts`
- Create: `tests/core/position-tracker.test.ts`

**Step 1: Write the failing test**

```ts
// tests/core/position-tracker.test.ts
import { describe, test, expect } from 'bun:test'
import { PositionTracker } from '../../src/core/position-tracker.ts'
import { createDb } from '../../src/infrastructure/storage/db.ts'
import { PositionRepository } from '../../src/infrastructure/storage/repositories.ts'

describe('PositionTracker', () => {
  function makeTracker() {
    const db = createDb(':memory:')
    const repo = new PositionRepository(db)
    return new PositionTracker(repo)
  }

  test('records buy and tracks position', () => {
    const tracker = makeTracker()
    tracker.recordFill({ strategyId: 's1', marketId: 'm1', side: 'buy', size: 100, price: 0.50 })
    const pos = tracker.getPosition('m1', 's1')
    expect(pos?.size).toBe(100)
    expect(pos?.avgPrice).toBeCloseTo(0.50)
  })

  test('averages down on second buy', () => {
    const tracker = makeTracker()
    tracker.recordFill({ strategyId: 's1', marketId: 'm1', side: 'buy', size: 100, price: 0.40 })
    tracker.recordFill({ strategyId: 's1', marketId: 'm1', side: 'buy', size: 100, price: 0.60 })
    const pos = tracker.getPosition('m1', 's1')
    expect(pos?.avgPrice).toBeCloseTo(0.50)
    expect(pos?.size).toBe(200)
  })

  test('getTotalExposure returns total position value', () => {
    const tracker = makeTracker()
    tracker.recordFill({ strategyId: 's1', marketId: 'm1', side: 'buy', size: 100, price: 0.50 })
    tracker.recordFill({ strategyId: 's2', marketId: 'm2', side: 'buy', size: 200, price: 0.30 })
    expect(tracker.getTotalExposure()).toBeCloseTo(50 + 60)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/core/position-tracker.test.ts
```
Expected: FAIL

**Step 3: Create src/core/position-tracker.ts**

```ts
import type { PositionRepository, PositionRow } from '../infrastructure/storage/repositories.ts'

interface FillEvent {
  strategyId: string
  marketId: string
  side: 'buy' | 'sell'
  size: number
  price: number
}

export class PositionTracker {
  private cache = new Map<string, PositionRow>()

  constructor(private repo: PositionRepository) {
    // Load existing positions into cache
    for (const pos of repo.findAll()) {
      this.cache.set(this.key(pos.marketId, pos.strategyId), pos)
    }
  }

  private key(marketId: string, strategyId: string): string {
    return `${marketId}:${strategyId}`
  }

  recordFill(fill: FillEvent): void {
    const k = this.key(fill.marketId, fill.strategyId)
    const existing = this.cache.get(k)

    let newPos: PositionRow
    if (!existing || existing.size === 0) {
      const size = fill.side === 'buy' ? fill.size : -fill.size
      newPos = { marketId: fill.marketId, strategyId: fill.strategyId, size, avgPrice: fill.price, unrealizedPnl: 0 }
    } else {
      if (fill.side === 'buy') {
        const totalCost = existing.size * existing.avgPrice + fill.size * fill.price
        const newSize = existing.size + fill.size
        newPos = { ...existing, size: newSize, avgPrice: totalCost / newSize }
      } else {
        const newSize = existing.size - fill.size
        newPos = { ...existing, size: newSize }
      }
    }

    this.cache.set(k, newPos)
    this.repo.upsert(newPos)
  }

  updatePnl(marketId: string, currentPrice: number): void {
    for (const [k, pos] of this.cache) {
      if (pos.marketId === marketId) {
        pos.unrealizedPnl = (currentPrice - pos.avgPrice) * pos.size
        this.repo.upsert(pos)
      }
    }
  }

  getPosition(marketId: string, strategyId: string): PositionRow | undefined {
    return this.cache.get(this.key(marketId, strategyId))
  }

  getStrategyExposure(strategyId: string): number {
    let total = 0
    for (const pos of this.cache.values()) {
      if (pos.strategyId === strategyId && pos.size > 0) {
        total += pos.size * pos.avgPrice
      }
    }
    return total
  }

  getTotalExposure(): number {
    let total = 0
    for (const pos of this.cache.values()) {
      if (pos.size > 0) total += pos.size * pos.avgPrice
    }
    return total
  }

  getAllPositions(): PositionRow[] {
    return [...this.cache.values()].filter(p => p.size !== 0)
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/core/position-tracker.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/position-tracker.ts tests/core/position-tracker.test.ts
git commit -m "feat: add position tracker with average price and exposure calculation"
```

---

### Task 9: Risk Manager

**Files:**
- Create: `src/core/risk-manager.ts`
- Create: `tests/core/risk-manager.test.ts`

**Step 1: Write the failing test**

```ts
// tests/core/risk-manager.test.ts
import { describe, test, expect } from 'bun:test'
import { RiskManager } from '../../src/core/risk-manager.ts'

const defaultRisk = {
  maxPositionPct: 0.20,
  maxTotalExposurePct: 0.60,
  maxDailyLossPct: 0.05,
  maxConsecutiveLosses: 3,
  cooldownMinutes: 60,
  maxVolumeImpactPct: 0.05,
  maxSlippagePct: 0.02,
}

describe('RiskManager', () => {
  test('allows trade within limits', () => {
    const rm = new RiskManager(defaultRisk, 10000)
    const result = rm.check({ strategyId: 's1', size: 100, price: 0.5, volume24h: 10000, currentExposure: 0, strategyExposure: 0 })
    expect(result.allowed).toBe(true)
  })

  test('blocks trade exceeding total exposure', () => {
    const rm = new RiskManager(defaultRisk, 10000)
    const result = rm.check({ strategyId: 's1', size: 1000, price: 0.8, volume24h: 100000, currentExposure: 5000, strategyExposure: 0 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/exposure/i)
  })

  test('blocks trade from tripped circuit breaker', () => {
    const rm = new RiskManager(defaultRisk, 10000)
    rm.recordLoss('s1')
    rm.recordLoss('s1')
    rm.recordLoss('s1') // 3 losses = trip
    const result = rm.check({ strategyId: 's1', size: 10, price: 0.5, volume24h: 100000, currentExposure: 0, strategyExposure: 0 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/circuit/i)
  })

  test('blocks high volume impact', () => {
    const rm = new RiskManager(defaultRisk, 10000)
    // 200 * 0.5 = $100 in a $500 24h volume market = 20% impact
    const result = rm.check({ strategyId: 's1', size: 200, price: 0.5, volume24h: 500, currentExposure: 0, strategyExposure: 0 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/liquidity/i)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/core/risk-manager.test.ts
```
Expected: FAIL

**Step 3: Create src/core/risk-manager.ts**

```ts
import type { RiskConfig } from '../config/types.ts'

interface CheckInput {
  strategyId: string
  size: number
  price: number
  volume24h: number
  currentExposure: number    // total portfolio exposure in $
  strategyExposure: number   // this strategy's exposure in $
}

interface CheckResult {
  allowed: boolean
  reason?: string
  maxSize?: number
}

interface CircuitState {
  consecutiveLosses: number
  trippedAt: Date | null
  dailyLoss: number
}

export class RiskManager {
  private circuits = new Map<string, CircuitState>()

  constructor(private config: RiskConfig, private balance: number) {}

  updateBalance(balance: number): void {
    this.balance = balance
  }

  private getCircuit(strategyId: string): CircuitState {
    if (!this.circuits.has(strategyId)) {
      this.circuits.set(strategyId, { consecutiveLosses: 0, trippedAt: null, dailyLoss: 0 })
    }
    return this.circuits.get(strategyId)!
  }

  recordLoss(strategyId: string, amount = 0): void {
    const c = this.getCircuit(strategyId)
    c.consecutiveLosses++
    c.dailyLoss += amount
    if (c.consecutiveLosses >= this.config.maxConsecutiveLosses || c.dailyLoss >= this.balance * this.config.maxDailyLossPct) {
      c.trippedAt = new Date()
    }
  }

  recordWin(strategyId: string): void {
    const c = this.getCircuit(strategyId)
    c.consecutiveLosses = 0
  }

  isCircuitTripped(strategyId: string): boolean {
    const c = this.getCircuit(strategyId)
    if (!c.trippedAt) return false
    const cooldownMs = this.config.cooldownMinutes * 60 * 1000
    if (Date.now() - c.trippedAt.getTime() > cooldownMs) {
      c.trippedAt = null
      c.consecutiveLosses = 0
      c.dailyLoss = 0
      return false
    }
    return true
  }

  check(input: CheckInput): CheckResult {
    // Layer 1: Circuit breaker
    if (this.isCircuitTripped(input.strategyId)) {
      return { allowed: false, reason: `Circuit breaker active for strategy ${input.strategyId}` }
    }

    // Layer 2: Position limits
    const tradeValue = input.size * input.price
    const newTotalExposure = input.currentExposure + tradeValue
    if (newTotalExposure > this.balance * this.config.maxTotalExposurePct) {
      return { allowed: false, reason: `Total exposure limit reached (${(this.config.maxTotalExposurePct * 100).toFixed(0)}% of balance)` }
    }

    const newStrategyExposure = input.strategyExposure + tradeValue
    if (newStrategyExposure > this.balance * this.config.maxPositionPct) {
      return { allowed: false, reason: `Strategy exposure limit reached (${(this.config.maxPositionPct * 100).toFixed(0)}% of balance)` }
    }

    // Layer 3: Liquidity / volume impact
    if (input.volume24h > 0) {
      const impact = tradeValue / input.volume24h
      if (impact > this.config.maxVolumeImpactPct) {
        return { allowed: false, reason: `Liquidity impact too high: ${(impact * 100).toFixed(1)}% of 24h volume` }
      }
    }

    return { allowed: true }
  }

  computeMaxSize(price: number, strategyId: string, currentExposure: number, strategyExposure: number): number {
    const byTotal = Math.max(0, this.balance * this.config.maxTotalExposurePct - currentExposure) / price
    const byStrategy = Math.max(0, this.balance * this.config.maxPositionPct - strategyExposure) / price
    return Math.min(byTotal, byStrategy)
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/core/risk-manager.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/risk-manager.ts tests/core/risk-manager.test.ts
git commit -m "feat: add 3-layer risk manager with circuit breakers"
```

---

### Task 10: Order Manager

**Files:**
- Create: `src/core/order-manager.ts`
- Create: `tests/core/order-manager.test.ts`

**Step 1: Write the failing test**

```ts
// tests/core/order-manager.test.ts
import { describe, test, expect, mock } from 'bun:test'
import { OrderManager } from '../../src/core/order-manager.ts'
import { EventBus } from '../../src/core/event-bus.ts'
import { createDb } from '../../src/infrastructure/storage/db.ts'
import { OrderRepository } from '../../src/infrastructure/storage/repositories.ts'

describe('OrderManager', () => {
  function makeManager() {
    const db = createDb(':memory:')
    const repo = new OrderRepository(db)
    const bus = new EventBus()
    const mockClient = { placeOrder: mock(async () => ({ orderId: 'ord-1', status: 'simulated', marketId: 'm1', side: 'buy', size: 10, price: 0.5 })) }
    return { manager: new OrderManager(mockClient as any, repo, bus), bus, mockClient }
  }

  test('executes order and emits trade:executed', async () => {
    const { manager, bus } = makeManager()
    const executed = mock(() => {})
    bus.on('trade:executed', executed)

    await manager.execute({ strategyId: 's1', marketId: 'm1', tokenId: 't1', side: 'buy', size: 10, price: 0.5 })
    expect(executed).toHaveBeenCalled()
  })

  test('persists order to repository', async () => {
    const db = createDb(':memory:')
    const repo = new OrderRepository(db)
    const bus = new EventBus()
    const mockClient = { placeOrder: mock(async () => ({ orderId: 'ord-1', status: 'filled', marketId: 'm1', side: 'buy', size: 10, price: 0.5 })) }
    const manager = new OrderManager(mockClient as any, repo, bus)

    await manager.execute({ strategyId: 's1', marketId: 'm1', tokenId: 't1', side: 'buy', size: 10, price: 0.5 })
    const orders = repo.findByStrategy('s1')
    expect(orders).toHaveLength(1)
    expect(orders[0].status).toBe('filled')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/core/order-manager.test.ts
```
Expected: FAIL

**Step 3: Create src/core/order-manager.ts**

```ts
import type { PolymarketClient } from '../infrastructure/polymarket/client.ts'
import type { OrderRepository } from '../infrastructure/storage/repositories.ts'
import type { EventBus } from './event-bus.ts'

export interface ExecuteIntent {
  strategyId: string
  marketId: string
  tokenId: string
  side: 'buy' | 'sell'
  size: number
  price: number
}

export class OrderManager {
  constructor(
    private client: PolymarketClient,
    private repo: OrderRepository,
    private bus: EventBus,
  ) {}

  async execute(intent: ExecuteIntent): Promise<void> {
    try {
      const result = await this.client.placeOrder({
        marketId: intent.marketId,
        tokenId: intent.tokenId,
        side: intent.side,
        size: intent.size,
        price: intent.price,
      })

      this.repo.insert({
        strategyId: intent.strategyId,
        marketId: intent.marketId,
        side: intent.side,
        size: intent.size,
        price: intent.price,
        status: result.status,
        reason: null,
      })

      this.bus.emit('trade:executed', {
        orderId: result.orderId,
        marketId: intent.marketId,
        side: intent.side,
        size: intent.size,
        price: intent.price,
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      this.repo.insert({
        strategyId: intent.strategyId,
        marketId: intent.marketId,
        side: intent.side,
        size: intent.size,
        price: intent.price,
        status: 'error',
        reason,
      })
      this.bus.emit('trade:rejected', { reason, strategyId: intent.strategyId, marketId: intent.marketId })
    }
  }

  reject(intent: Omit<ExecuteIntent, 'tokenId'>, reason: string): void {
    this.repo.insert({
      strategyId: intent.strategyId,
      marketId: intent.marketId,
      side: intent.side,
      size: intent.size,
      price: intent.price,
      status: 'rejected',
      reason,
    })
    this.bus.emit('trade:rejected', { reason, strategyId: intent.strategyId, marketId: intent.marketId })
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/core/order-manager.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/order-manager.ts tests/core/order-manager.test.ts
git commit -m "feat: add order manager with persistence and event emission"
```

---

## Phase 5: Strategies

### Task 11: Base Strategy + Strategy Engine

**Files:**
- Create: `src/strategies/base.strategy.ts`
- Create: `src/strategies/engine.ts`
- Create: `tests/strategies/engine.test.ts`

**Step 1: Write the failing test**

```ts
// tests/strategies/engine.test.ts
import { describe, test, expect, mock } from 'bun:test'
import { StrategyEngine } from '../../src/strategies/engine.ts'
import type { Strategy } from '../../src/strategies/base.strategy.ts'
import type { Market } from '../../src/infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../src/signals/aggregator.ts'

describe('StrategyEngine', () => {
  const market: Market = { id: 'm1', conditionId: 'c1', question: 'Q?', category: 'politics', endDate: '2026-12-31', yesPrice: 0.55, noPrice: 0.45, volume24h: 50000, liquidity: 10000, active: true }
  const signals: SignalBundle = { marketId: 'm1', timestamp: new Date(), quant: { momentum: 0.5, priceDeviation: 0.1, liquidityScore: 0.8, spread: 0.04, volumeScore: 0.5 }, llm: null }

  test('runs enabled strategies', async () => {
    const mockStrategy: Strategy = {
      id: 'test', name: 'Test', enabled: true,
      evaluate: mock(async () => null),
      getWeight: () => 1.0,
    }
    const engine = new StrategyEngine([mockStrategy])
    await engine.run(market, signals)
    expect(mockStrategy.evaluate).toHaveBeenCalled()
  })

  test('skips disabled strategies', async () => {
    const mockStrategy: Strategy = {
      id: 'test', name: 'Test', enabled: false,
      evaluate: mock(async () => null),
      getWeight: () => 1.0,
    }
    const engine = new StrategyEngine([mockStrategy])
    await engine.run(market, signals)
    expect(mockStrategy.evaluate).not.toHaveBeenCalled()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/strategies/engine.test.ts
```
Expected: FAIL

**Step 3: Create src/strategies/base.strategy.ts**

```ts
import type { Market } from '../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../signals/aggregator.ts'

export interface TradeIntent {
  strategyId: string
  marketId: string
  tokenId: string
  side: 'buy' | 'sell'
  size: number
  price: number
  reasoning: string
}

export interface Strategy {
  id: string
  name: string
  enabled: boolean
  evaluate(market: Market, signals: SignalBundle): Promise<TradeIntent | null>
  getWeight(): number
}
```

**Step 4: Create src/strategies/engine.ts**

```ts
import type { Strategy, TradeIntent } from './base.strategy.ts'
import type { Market } from '../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../signals/aggregator.ts'

export class StrategyEngine {
  constructor(private strategies: Strategy[]) {}

  async run(market: Market, signals: SignalBundle): Promise<TradeIntent[]> {
    const results: TradeIntent[] = []

    const enabled = this.strategies.filter(s => s.enabled)
    const intents = await Promise.allSettled(enabled.map(s => s.evaluate(market, signals)))

    for (const result of intents) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value)
      } else if (result.status === 'rejected') {
        console.error(`Strategy error:`, result.reason)
      }
    }

    return results
  }

  getStrategies(): Strategy[] {
    return this.strategies
  }
}
```

**Step 5: Run test to verify it passes**

```bash
bun test tests/strategies/engine.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/strategies/base.strategy.ts src/strategies/engine.ts tests/strategies/engine.test.ts
git commit -m "feat: add strategy base interface and engine"
```

---

### Task 12: Four Trading Strategies

**Files:**
- Create: `src/strategies/market-maker/index.ts`
- Create: `src/strategies/arbitrage/index.ts`
- Create: `src/strategies/momentum/index.ts`
- Create: `src/strategies/fundamental/index.ts`
- Create: `tests/strategies/strategies.test.ts`

**Step 1: Write the failing test**

```ts
// tests/strategies/strategies.test.ts
import { describe, test, expect } from 'bun:test'
import { MarketMakerStrategy } from '../../src/strategies/market-maker/index.ts'
import { MomentumStrategy } from '../../src/strategies/momentum/index.ts'
import { FundamentalStrategy } from '../../src/strategies/fundamental/index.ts'
import type { Market } from '../../src/infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../src/signals/aggregator.ts'

const baseMarket: Market = { id: 'm1', conditionId: 'c1', question: 'Q?', category: 'politics', endDate: '2026-12-31', yesPrice: 0.55, noPrice: 0.45, volume24h: 50000, liquidity: 10000, active: true }
const baseSignals: SignalBundle = { marketId: 'm1', timestamp: new Date(), quant: { momentum: 0, priceDeviation: 0.1, liquidityScore: 0.8, spread: 0.04, volumeScore: 0.5 }, llm: null }

describe('MarketMakerStrategy', () => {
  test('returns null when spread too tight', async () => {
    const s = new MarketMakerStrategy({ enabled: true, weight: 1, maxOrderSize: 100, minSpread: 0.05 }, 1000)
    // spread = 0.04 < minSpread 0.05
    const intent = await s.evaluate(baseMarket, baseSignals)
    expect(intent).toBeNull()
  })

  test('returns intent when spread is wide enough', async () => {
    const signals = { ...baseSignals, quant: { ...baseSignals.quant, spread: 0.10 } }
    const s = new MarketMakerStrategy({ enabled: true, weight: 1, maxOrderSize: 100, minSpread: 0.05 }, 1000)
    const intent = await s.evaluate(baseMarket, signals)
    expect(intent).not.toBeNull()
    expect(intent?.side).toBe('buy') // Buy at bid
  })
})

describe('MomentumStrategy', () => {
  test('returns null on flat momentum', async () => {
    const s = new MomentumStrategy({ enabled: true, weight: 1, threshold: 0.3, maxOrderSize: 100 }, 1000)
    const intent = await s.evaluate(baseMarket, baseSignals)
    expect(intent).toBeNull()
  })

  test('returns buy on strong bullish momentum', async () => {
    const signals = { ...baseSignals, quant: { ...baseSignals.quant, momentum: 0.8 }, llm: { sentiment: 'bullish' as const, confidence: 0.7, estimatedProbability: 0.65, summary: '', reasoning: '' } }
    const s = new MomentumStrategy({ enabled: true, weight: 1, threshold: 0.3, maxOrderSize: 100 }, 1000)
    const intent = await s.evaluate(baseMarket, signals)
    expect(intent?.side).toBe('buy')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/strategies/strategies.test.ts
```
Expected: FAIL

**Step 3: Create src/strategies/market-maker/index.ts**

```ts
import type { Strategy, TradeIntent } from '../base.strategy.ts'
import type { Market } from '../../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../signals/aggregator.ts'

interface MMConfig {
  enabled: boolean
  weight: number
  maxOrderSize: number
  minSpread: number
}

export class MarketMakerStrategy implements Strategy {
  id = 'market-maker'
  name = 'Market Maker'

  constructor(private config: MMConfig, private balance: number) {}

  get enabled() { return this.config.enabled }
  getWeight() { return this.config.weight }

  async evaluate(market: Market, signals: SignalBundle): Promise<TradeIntent | null> {
    const { spread, liquidityScore } = signals.quant
    if (spread < this.config.minSpread) return null
    if (liquidityScore < 0.2) return null

    // Place buy at best bid (mid - half spread)
    const mid = (market.yesPrice + market.noPrice) / 2
    const bidPrice = Math.max(0.01, mid - spread / 2)
    const size = Math.min(this.config.maxOrderSize, this.balance * this.config.weight * 0.1)

    return {
      strategyId: this.id,
      marketId: market.id,
      tokenId: `${market.conditionId}-YES`,
      side: 'buy',
      size,
      price: bidPrice,
      reasoning: `MM: spread ${(spread * 100).toFixed(1)}% ≥ min ${(this.config.minSpread * 100).toFixed(1)}%, placing at bid ${bidPrice.toFixed(3)}`,
    }
  }
}
```

**Step 4: Create src/strategies/arbitrage/index.ts**

```ts
import type { Strategy, TradeIntent } from '../base.strategy.ts'
import type { Market } from '../../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../signals/aggregator.ts'

interface ArbConfig {
  enabled: boolean
  weight: number
  minEdge: number
  maxOrderSize: number
}

export class ArbitrageStrategy implements Strategy {
  id = 'arbitrage'
  name = 'Arbitrage'
  private marketHistory = new Map<string, number[]>()

  constructor(private config: ArbConfig, private balance: number) {}

  get enabled() { return this.config.enabled }
  getWeight() { return this.config.weight }

  async evaluate(market: Market, signals: SignalBundle): Promise<TradeIntent | null> {
    const { estimatedProbability, confidence } = signals.llm ?? {}
    if (!estimatedProbability || !confidence || confidence < 0.6) return null

    // Edge = difference between our estimate and market price
    const edge = estimatedProbability - market.yesPrice
    if (Math.abs(edge) < this.config.minEdge) return null

    const side = edge > 0 ? 'buy' : 'sell'
    const size = Math.min(this.config.maxOrderSize, this.balance * this.config.weight * Math.abs(edge))

    return {
      strategyId: this.id,
      marketId: market.id,
      tokenId: `${market.conditionId}-YES`,
      side,
      size,
      price: market.yesPrice,
      reasoning: `Arb: estimated ${(estimatedProbability * 100).toFixed(1)}% vs market ${(market.yesPrice * 100).toFixed(1)}%, edge=${(edge * 100).toFixed(1)}%`,
    }
  }
}
```

**Step 5: Create src/strategies/momentum/index.ts**

```ts
import type { Strategy, TradeIntent } from '../base.strategy.ts'
import type { Market } from '../../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../signals/aggregator.ts'

interface MomConfig {
  enabled: boolean
  weight: number
  threshold: number
  maxOrderSize: number
}

export class MomentumStrategy implements Strategy {
  id = 'momentum'
  name = 'Momentum'

  constructor(private config: MomConfig, private balance: number) {}

  get enabled() { return this.config.enabled }
  getWeight() { return this.config.weight }

  async evaluate(market: Market, signals: SignalBundle): Promise<TradeIntent | null> {
    const { momentum, liquidityScore } = signals.quant
    if (Math.abs(momentum) < this.config.threshold) return null
    if (liquidityScore < 0.3) return null

    const llmAligned = !signals.llm || (momentum > 0 && signals.llm.sentiment === 'bullish') || (momentum < 0 && signals.llm.sentiment === 'bearish')
    if (!llmAligned) return null

    const side = momentum > 0 ? 'buy' : 'sell'
    const size = Math.min(this.config.maxOrderSize, this.balance * this.config.weight * Math.abs(momentum) * 0.5)

    return {
      strategyId: this.id,
      marketId: market.id,
      tokenId: `${market.conditionId}-YES`,
      side,
      size,
      price: market.yesPrice,
      reasoning: `Momentum: ${(momentum * 100).toFixed(0)}% signal, ${signals.llm?.sentiment ?? 'no'} LLM alignment`,
    }
  }
}
```

**Step 6: Create src/strategies/fundamental/index.ts**

```ts
import type { Strategy, TradeIntent } from '../base.strategy.ts'
import type { Market } from '../../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../signals/aggregator.ts'

interface FundConfig {
  enabled: boolean
  weight: number
  minConfidence: number
  minEdge: number
  maxOrderSize: number
}

export class FundamentalStrategy implements Strategy {
  id = 'fundamental'
  name = 'Fundamental'

  constructor(private config: FundConfig, private balance: number) {}

  get enabled() { return this.config.enabled }
  getWeight() { return this.config.weight }

  async evaluate(market: Market, signals: SignalBundle): Promise<TradeIntent | null> {
    if (!signals.llm) return null
    const { estimatedProbability, confidence } = signals.llm
    if (confidence < this.config.minConfidence) return null

    const edge = estimatedProbability - market.yesPrice
    if (Math.abs(edge) < this.config.minEdge) return null

    const side = edge > 0 ? 'buy' : 'sell'
    // Kelly-inspired sizing: f = edge / price
    const kellyFraction = Math.abs(edge) / market.yesPrice
    const size = Math.min(this.config.maxOrderSize, this.balance * this.config.weight * kellyFraction * 0.25)

    return {
      strategyId: this.id,
      marketId: market.id,
      tokenId: `${market.conditionId}-YES`,
      side,
      size,
      price: market.yesPrice,
      reasoning: `Fundamental: LLM estimates ${(estimatedProbability * 100).toFixed(1)}% (conf ${(confidence * 100).toFixed(0)}%), edge=${(edge * 100).toFixed(1)}%`,
    }
  }
}
```

**Step 7: Run test to verify it passes**

```bash
bun test tests/strategies/strategies.test.ts
```
Expected: PASS

**Step 8: Commit**

```bash
git add src/strategies/ tests/strategies/strategies.test.ts
git commit -m "feat: add 4 trading strategies (MM, Arb, Momentum, Fundamental)"
```

---

## Phase 6: Infrastructure UI

### Task 13: Notifier

**Files:**
- Create: `src/infrastructure/notifier/types.ts`
- Create: `src/infrastructure/notifier/telegram.ts`
- Create: `src/infrastructure/notifier/discord.ts`
- Create: `src/infrastructure/notifier/index.ts`

**Step 1: Create src/infrastructure/notifier/types.ts**

```ts
export type NotifyLevel = 'info' | 'warning' | 'critical'
export type NotifyEventType =
  | 'trade_executed'
  | 'trade_rejected'
  | 'circuit_breaker'
  | 'daily_loss_limit'
  | 'llm_alert'
  | 'system'

export interface NotifyEvent {
  level: NotifyLevel
  type: NotifyEventType
  message: string
  metadata?: Record<string, unknown>
}

export interface NotifyChannel {
  send(event: NotifyEvent): Promise<void>
}
```

**Step 2: Create src/infrastructure/notifier/telegram.ts**

```ts
import type { NotifyChannel, NotifyEvent } from './types.ts'

const EMOJI = { info: 'ℹ️', warning: '⚠️', critical: '🚨' }

export class TelegramNotifier implements NotifyChannel {
  constructor(private config: { token: string; chatId: string }) {}

  async send(event: NotifyEvent): Promise<void> {
    const emoji = EMOJI[event.level]
    const text = `${emoji} *[${event.type.toUpperCase()}]*\n${event.message}`
    const url = `https://api.telegram.org/bot${this.config.token}/sendMessage`
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.config.chatId, text, parse_mode: 'Markdown' }),
    }).catch(err => console.error('Telegram send failed:', err))
  }
}
```

**Step 3: Create src/infrastructure/notifier/discord.ts**

```ts
import type { NotifyChannel, NotifyEvent } from './types.ts'

const COLOR = { info: 0x3498db, warning: 0xf39c12, critical: 0xe74c3c }

export class DiscordNotifier implements NotifyChannel {
  constructor(private config: { webhookUrl: string }) {}

  async send(event: NotifyEvent): Promise<void> {
    await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: event.type.toUpperCase(),
          description: event.message,
          color: COLOR[event.level],
          timestamp: new Date().toISOString(),
        }],
      }),
    }).catch(err => console.error('Discord send failed:', err))
  }
}
```

**Step 4: Create src/infrastructure/notifier/index.ts**

```ts
import type { NotifyEvent, NotifyChannel } from './types.ts'
import { TelegramNotifier } from './telegram.ts'
import { DiscordNotifier } from './discord.ts'

export class Notifier {
  private channels: NotifyChannel[] = []

  constructor(config: {
    telegram: { token: string; chatId: string } | null
    discord: { webhookUrl: string } | null
  }) {
    if (config.telegram) this.channels.push(new TelegramNotifier(config.telegram))
    if (config.discord) this.channels.push(new DiscordNotifier(config.discord))
  }

  async send(event: NotifyEvent): Promise<void> {
    await Promise.allSettled(this.channels.map(c => c.send(event)))
  }

  async info(type: NotifyEvent['type'], message: string): Promise<void> {
    return this.send({ level: 'info', type, message })
  }

  async warning(type: NotifyEvent['type'], message: string): Promise<void> {
    return this.send({ level: 'warning', type, message })
  }

  async critical(type: NotifyEvent['type'], message: string): Promise<void> {
    return this.send({ level: 'critical', type, message })
  }
}
```

**Step 5: Commit**

```bash
git add src/infrastructure/notifier/
git commit -m "feat: add Telegram and Discord notification channels"
```

---

### Task 14: Web Dashboard

**Files:**
- Create: `src/infrastructure/dashboard/server.ts`
- Create: `src/infrastructure/dashboard/views.ts`

**Step 1: Create src/infrastructure/dashboard/views.ts**

```ts
// HTML fragments rendered server-side
export function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>transBoot - ${title}</title>
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; }
    nav { background: #1a1a2e; padding: 1rem 2rem; display: flex; gap: 2rem; align-items: center; }
    nav a { color: #7c83fd; text-decoration: none; }
    nav a:hover { color: #fff; }
    .container { padding: 2rem; max-width: 1200px; margin: 0 auto; }
    .card { background: #1a1a2e; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
    .stat { font-size: 2rem; font-weight: bold; color: #7c83fd; }
    .label { font-size: 0.85rem; color: #888; margin-top: 0.25rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #2a2a3e; }
    th { color: #888; font-weight: normal; }
    .positive { color: #2ecc71; }
    .negative { color: #e74c3c; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; }
    .badge-ok { background: #1e4d2b; color: #2ecc71; }
    .badge-warn { background: #4d3a1e; color: #f39c12; }
    .badge-err { background: #4d1e1e; color: #e74c3c; }
  </style>
</head>
<body>
  <nav>
    <strong style="color:#7c83fd">transBoot</strong>
    <a href="/">Overview</a>
    <a href="/strategies">Strategies</a>
    <a href="/positions">Positions</a>
    <a href="/orders">Orders</a>
    <a href="/signals">Signals</a>
    <a href="/config">Config</a>
  </nav>
  <div class="container" hx-get="/api/refresh" hx-trigger="every 5s" hx-swap="none">
    ${body}
  </div>
</body>
</html>`
}

export function overviewView(data: {
  balance: number
  todayPnl: number
  activeStrategies: number
  openPositions: number
}): string {
  const pnlClass = data.todayPnl >= 0 ? 'positive' : 'negative'
  return layout('Overview', `
    <h2 style="margin-bottom:1rem">Overview</h2>
    <div class="grid">
      <div class="card"><div class="stat">$${data.balance.toFixed(2)}</div><div class="label">Balance (USDC)</div></div>
      <div class="card"><div class="stat ${pnlClass}">${data.todayPnl >= 0 ? '+' : ''}$${data.todayPnl.toFixed(2)}</div><div class="label">Today PnL</div></div>
      <div class="card"><div class="stat">${data.activeStrategies}</div><div class="label">Active Strategies</div></div>
      <div class="card"><div class="stat">${data.openPositions}</div><div class="label">Open Positions</div></div>
    </div>
  `)
}
```

**Step 2: Create src/infrastructure/dashboard/server.ts**

```ts
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import type { PositionTracker } from '../../core/position-tracker.ts'
import type { RiskManager } from '../../core/risk-manager.ts'
import type { StrategyEngine } from '../../strategies/engine.ts'
import type { OrderRepository, SignalRepository } from '../storage/repositories.ts'
import { overviewView, layout } from './views.ts'

interface DashboardDeps {
  positionTracker: PositionTracker
  riskManager: RiskManager
  strategyEngine: StrategyEngine
  orderRepo: OrderRepository
  signalRepo: SignalRepository
  getBalance: () => Promise<number>
}

export function createDashboard(deps: DashboardDeps, port: number) {
  const app = new Hono()

  app.get('/', async (c) => {
    const [balance, positions] = await Promise.all([deps.getBalance(), deps.positionTracker.getAllPositions()])
    const todayPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0)
    return c.html(overviewView({ balance, todayPnl, activeStrategies: deps.strategyEngine.getStrategies().filter(s => s.enabled).length, openPositions: positions.length }))
  })

  app.get('/positions', (c) => {
    const positions = deps.positionTracker.getAllPositions()
    const rows = positions.map(p => `<tr>
      <td>${p.marketId}</td>
      <td>${p.strategyId}</td>
      <td>${p.size.toFixed(2)}</td>
      <td>$${p.avgPrice.toFixed(3)}</td>
      <td class="${p.unrealizedPnl >= 0 ? 'positive' : 'negative'}">${p.unrealizedPnl >= 0 ? '+' : ''}$${p.unrealizedPnl.toFixed(2)}</td>
    </tr>`).join('')
    return c.html(layout('Positions', `
      <h2 style="margin-bottom:1rem">Positions</h2>
      <div class="card">
        <table>
          <thead><tr><th>Market</th><th>Strategy</th><th>Size</th><th>Avg Price</th><th>Unrealized PnL</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#888">No open positions</td></tr>'}</tbody>
        </table>
      </div>
    `))
  })

  app.get('/orders', (c) => {
    const orders = deps.orderRepo.findRecent(50)
    const rows = orders.map(o => `<tr>
      <td>${o.strategyId}</td>
      <td>${o.marketId.slice(0, 12)}…</td>
      <td>${o.side}</td>
      <td>${o.size.toFixed(2)}</td>
      <td>$${o.price.toFixed(3)}</td>
      <td><span class="badge ${o.status === 'filled' || o.status === 'simulated' ? 'badge-ok' : o.status === 'rejected' ? 'badge-err' : 'badge-warn'}">${o.status}</span></td>
    </tr>`).join('')
    return c.html(layout('Orders', `
      <h2 style="margin-bottom:1rem">Order History</h2>
      <div class="card">
        <table>
          <thead><tr><th>Strategy</th><th>Market</th><th>Side</th><th>Size</th><th>Price</th><th>Status</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#888">No orders yet</td></tr>'}</tbody>
        </table>
      </div>
    `))
  })

  app.get('/strategies', (c) => {
    const strategies = deps.strategyEngine.getStrategies()
    const rows = strategies.map(s => `<tr>
      <td>${s.name}</td>
      <td><span class="badge ${s.enabled ? 'badge-ok' : 'badge-err'}">${s.enabled ? 'Active' : 'Disabled'}</span></td>
      <td>${(deps.riskManager.isCircuitTripped(s.id) ? '🔴 Tripped' : '🟢 OK')}</td>
      <td>${(s.getWeight() * 100).toFixed(0)}%</td>
    </tr>`).join('')
    return c.html(layout('Strategies', `
      <h2 style="margin-bottom:1rem">Strategies</h2>
      <div class="card">
        <table>
          <thead><tr><th>Strategy</th><th>Status</th><th>Circuit</th><th>Weight</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `))
  })

  // SSE endpoint for real-time updates (no-op ping, clients refresh via hx-trigger)
  app.get('/events', (c) => streamSSE(c, async (stream) => {
    while (true) {
      await stream.writeSSE({ data: 'ping', event: 'heartbeat' })
      await Bun.sleep(5000)
    }
  }))

  serve({ fetch: app.fetch, port }, () => {
    console.log(`Dashboard running at http://localhost:${port}`)
  })

  return app
}
```

**Step 3: Commit**

```bash
git add src/infrastructure/dashboard/
git commit -m "feat: add Hono web dashboard with HTMX real-time updates"
```

---

## Phase 7: Backtest Module

### Task 15: Backtest Engine

**Files:**
- Create: `src/backtest/engine.ts`
- Create: `src/backtest/reporter.ts`
- Create: `tests/backtest/engine.test.ts`

**Step 1: Write the failing test**

```ts
// tests/backtest/engine.test.ts
import { describe, test, expect } from 'bun:test'
import { BacktestEngine } from '../../src/backtest/engine.ts'
import { MomentumStrategy } from '../../src/strategies/momentum/index.ts'

describe('BacktestEngine', () => {
  test('runs through historical ticks', async () => {
    const strategy = new MomentumStrategy({ enabled: true, weight: 1, threshold: 0.3, maxOrderSize: 50 }, 1000)
    const engine = new BacktestEngine([strategy], { initialBalance: 1000 })

    const ticks = [
      { marketId: 'm1', yesPrice: 0.40, volume24h: 50000, timestamp: new Date('2026-01-01') },
      { marketId: 'm1', yesPrice: 0.45, volume24h: 55000, timestamp: new Date('2026-01-02') },
      { marketId: 'm1', yesPrice: 0.52, volume24h: 60000, timestamp: new Date('2026-01-03') },
      { marketId: 'm1', yesPrice: 0.58, volume24h: 65000, timestamp: new Date('2026-01-04') },
    ]

    const report = await engine.run(ticks)
    expect(report.totalTrades).toBeGreaterThanOrEqual(0)
    expect(report.finalBalance).toBeGreaterThan(0)
    expect(report.sharpeRatio).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/backtest/engine.test.ts
```
Expected: FAIL

**Step 3: Create src/backtest/engine.ts**

```ts
import type { Strategy } from '../strategies/base.strategy.ts'
import type { Market } from '../infrastructure/polymarket/types.ts'
import { QuantEngine } from '../signals/quant/engine.ts'
import { SignalAggregator } from '../signals/aggregator.ts'
import { StrategyEngine } from '../strategies/engine.ts'

export interface HistoricalTick {
  marketId: string
  yesPrice: number
  volume24h: number
  timestamp: Date
}

export interface BacktestReport {
  totalTrades: number
  winRate: number
  finalBalance: number
  totalReturn: number
  maxDrawdown: number
  sharpeRatio: number
  tradeLog: { timestamp: Date; strategyId: string; side: string; size: number; price: number; pnl: number }[]
}

export class BacktestEngine {
  private quant = new QuantEngine()
  private aggregator = new SignalAggregator()
  private strategyEngine: StrategyEngine

  constructor(strategies: Strategy[], private config: { initialBalance: number }) {
    this.strategyEngine = new StrategyEngine(strategies)
  }

  async run(ticks: HistoricalTick[]): Promise<BacktestReport> {
    let balance = this.config.initialBalance
    const priceHistory = new Map<string, number[]>()
    const tradeLog: BacktestReport['tradeLog'] = []
    const balanceHistory: number[] = [balance]
    let wins = 0

    for (const tick of ticks) {
      const history = priceHistory.get(tick.marketId) ?? []
      history.push(tick.yesPrice)
      if (history.length > 20) history.shift()
      priceHistory.set(tick.marketId, history)

      const book = { bids: [{ price: tick.yesPrice - 0.02, size: 1000 }], asks: [{ price: tick.yesPrice + 0.02, size: 1000 }] }
      const quantSignal = this.quant.compute(history, book, tick.volume24h)
      const bundle = this.aggregator.update(tick.marketId, quantSignal, null)

      const market: Market = { id: tick.marketId, conditionId: tick.marketId, question: '', category: '', endDate: '', yesPrice: tick.yesPrice, noPrice: 1 - tick.yesPrice, volume24h: tick.volume24h, liquidity: 10000, active: true }
      const intents = await this.strategyEngine.run(market, bundle)

      for (const intent of intents) {
        const cost = intent.size * intent.price
        if (cost > balance) continue
        balance -= cost
        // Simulate: resolve at next tick's price
        const nextPrice = ticks.find(t => t.marketId === intent.marketId && t.timestamp > tick.timestamp)?.yesPrice ?? intent.price
        const pnl = intent.side === 'buy' ? (nextPrice - intent.price) * intent.size : (intent.price - nextPrice) * intent.size
        balance += cost + pnl
        if (pnl > 0) wins++
        tradeLog.push({ timestamp: tick.timestamp, strategyId: intent.strategyId, side: intent.side, size: intent.size, price: intent.price, pnl })
        balanceHistory.push(balance)
      }
    }

    const totalTrades = tradeLog.length
    const winRate = totalTrades > 0 ? wins / totalTrades : 0
    const totalReturn = (balance - this.config.initialBalance) / this.config.initialBalance
    const maxDrawdown = this.computeMaxDrawdown(balanceHistory)
    const sharpeRatio = this.computeSharpe(balanceHistory)

    return { totalTrades, winRate, finalBalance: balance, totalReturn, maxDrawdown, sharpeRatio, tradeLog }
  }

  private computeMaxDrawdown(balances: number[]): number {
    let peak = balances[0]
    let maxDD = 0
    for (const b of balances) {
      if (b > peak) peak = b
      const dd = (peak - b) / peak
      if (dd > maxDD) maxDD = dd
    }
    return maxDD
  }

  private computeSharpe(balances: number[]): number {
    if (balances.length < 2) return 0
    const returns = balances.slice(1).map((b, i) => (b - balances[i]) / balances[i])
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
    const stddev = Math.sqrt(variance)
    return stddev === 0 ? 0 : mean / stddev * Math.sqrt(252)
  }
}
```

**Step 4: Create src/backtest/reporter.ts**

```ts
import type { BacktestReport } from './engine.ts'

export function printReport(report: BacktestReport): void {
  console.log('\n=== Backtest Report ===')
  console.log(`Total Trades:  ${report.totalTrades}`)
  console.log(`Win Rate:      ${(report.winRate * 100).toFixed(1)}%`)
  console.log(`Final Balance: $${report.finalBalance.toFixed(2)}`)
  console.log(`Total Return:  ${(report.totalReturn * 100).toFixed(2)}%`)
  console.log(`Max Drawdown:  ${(report.maxDrawdown * 100).toFixed(2)}%`)
  console.log(`Sharpe Ratio:  ${report.sharpeRatio.toFixed(2)}`)
  console.log('======================\n')
}
```

**Step 5: Run test to verify it passes**

```bash
bun test tests/backtest/engine.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/backtest/ tests/backtest/engine.test.ts
git commit -m "feat: add backtest engine with Sharpe ratio and drawdown metrics"
```

---

## Phase 8: Bot Orchestration

### Task 16: Main Bot Loop + Entry Point

**Files:**
- Create: `src/bot.ts`
- Modify: `src/index.ts`

**Step 1: Create src/bot.ts**

```ts
import { loadConfig } from './config/index.ts'
import { createDb } from './infrastructure/storage/db.ts'
import { OrderRepository, PositionRepository, SignalRepository } from './infrastructure/storage/repositories.ts'
import { PolymarketClient } from './infrastructure/polymarket/client.ts'
import { EventBus } from './core/event-bus.ts'
import { PositionTracker } from './core/position-tracker.ts'
import { RiskManager } from './core/risk-manager.ts'
import { OrderManager } from './core/order-manager.ts'
import { QuantEngine } from './signals/quant/engine.ts'
import { SignalAggregator } from './signals/aggregator.ts'
import { createLLMProvider } from './signals/llm/factory.ts'
import { StrategyEngine } from './strategies/engine.ts'
import { MarketMakerStrategy } from './strategies/market-maker/index.ts'
import { ArbitrageStrategy } from './strategies/arbitrage/index.ts'
import { MomentumStrategy } from './strategies/momentum/index.ts'
import { FundamentalStrategy } from './strategies/fundamental/index.ts'
import { Notifier } from './infrastructure/notifier/index.ts'
import { createDashboard } from './infrastructure/dashboard/server.ts'

export async function startBot() {
  const config = loadConfig()
  console.log(`[transBoot] Starting in ${config.mode.toUpperCase()} mode...`)

  // Infrastructure
  const db = createDb(config.dbPath)
  const orderRepo = new OrderRepository(db)
  const positionRepo = new PositionRepository(db)
  const signalRepo = new SignalRepository(db)
  const bus = new EventBus()
  const polyClient = new PolymarketClient({ mode: config.mode, ...config.polymarket })
  const notifier = new Notifier(config.notify)

  // Core
  const balance = await polyClient.getBalance()
  const positionTracker = new PositionTracker(positionRepo)
  const riskManager = new RiskManager(config.risk, balance)
  const orderManager = new OrderManager(polyClient, orderRepo, bus)

  // Signals
  const quantEngine = new QuantEngine()
  const aggregator = new SignalAggregator()
  const llmProvider = config.llm.apiKey ? createLLMProvider(config.llm) : null

  // Strategies
  const strategies = [
    new MarketMakerStrategy({ ...config.strategies.marketMaker, minSpread: 0.04, maxOrderSize: 200 }, balance),
    new ArbitrageStrategy({ ...config.strategies.arbitrage, minEdge: 0.05, maxOrderSize: 300 }, balance),
    new MomentumStrategy({ ...config.strategies.momentum, threshold: 0.3, maxOrderSize: 200 }, balance),
    new FundamentalStrategy({ ...config.strategies.fundamental, minConfidence: 0.65, minEdge: 0.08, maxOrderSize: 400 }, balance),
  ]
  const strategyEngine = new StrategyEngine(strategies)

  // Wire up event listeners
  bus.on('trade:executed', async (e) => {
    console.log(`[Order] Executed: ${e.side} ${e.size} @ ${e.price} on ${e.marketId}`)
    if (config.notify.telegram || config.notify.discord) {
      await notifier.info('trade_executed', `${e.side.toUpperCase()} ${e.size.toFixed(2)} @ $${e.price.toFixed(3)} on ${e.marketId}`)
    }
  })

  bus.on('circuit:tripped', async (e) => {
    console.warn(`[Risk] Circuit tripped for strategy ${e.strategyId}: ${e.reason}`)
    await notifier.warning('circuit_breaker', `Circuit tripped: ${e.strategyId} - ${e.reason}`)
  })

  // Dashboard
  createDashboard({ positionTracker, riskManager, strategyEngine, orderRepo, signalRepo, getBalance: () => polyClient.getBalance() }, config.dashboard.port)

  // Main loop
  console.log('[transBoot] Bot loop starting...')
  const INTERVAL_MS = 30_000

  async function tick() {
    try {
      const markets = await polyClient.getMarkets()
      const freshBalance = await polyClient.getBalance()
      riskManager.updateBalance(freshBalance)

      for (const market of markets.slice(0, 20)) { // process top 20 markets per tick
        const book = await polyClient.getOrderBook(`${market.conditionId}-YES`)
        const priceHistory = [market.yesPrice] // TODO: fetch from DB for real history

        const quantSignal = quantEngine.compute(priceHistory, book, market.volume24h)

        let llmResult = null
        if (llmProvider) {
          try {
            llmResult = await llmProvider.analyze({ marketId: market.id, question: market.question, category: market.category, yesPrice: market.yesPrice, noPrice: market.noPrice, volume24h: market.volume24h, endDate: market.endDate })
            signalRepo.insert({ marketId: market.id, provider: llmProvider.name, sentiment: llmResult.sentiment, confidence: llmResult.confidence, summary: llmResult.summary, rawResponse: llmResult.rawResponse ?? null })
          } catch (err) {
            console.error('[LLM] Analysis failed:', err)
          }
        }

        const bundle = aggregator.update(market.id, quantSignal, llmResult)
        const intents = await strategyEngine.run(market, bundle)

        for (const intent of intents) {
          const exposure = positionTracker.getTotalExposure()
          const stratExposure = positionTracker.getStrategyExposure(intent.strategyId)
          const check = riskManager.check({ strategyId: intent.strategyId, size: intent.size, price: intent.price, volume24h: market.volume24h, currentExposure: exposure, strategyExposure: stratExposure })

          if (check.allowed) {
            await orderManager.execute(intent)
          } else {
            orderManager.reject(intent, check.reason!)
          }
        }
      }
    } catch (err) {
      console.error('[tick] Error:', err)
    }
  }

  // Run first tick immediately
  await tick()
  setInterval(tick, INTERVAL_MS)
  console.log(`[transBoot] Running. Next tick in ${INTERVAL_MS / 1000}s`)
}
```

**Step 2: Replace src/index.ts**

```ts
import { startBot } from './bot.ts'

startBot().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
```

**Step 3: Add scripts to package.json — run this command**

```bash
bun run -e "
const pkg = JSON.parse(await Bun.file('package.json').text())
pkg.scripts = {
  ...pkg.scripts,
  'start': 'bun run src/index.ts',
  'test': 'bun test',
  'backtest': 'bun run src/backtest/cli.ts'
}
await Bun.write('package.json', JSON.stringify(pkg, null, 2))
"
```

**Step 4: Verify bot starts in paper mode**

```bash
BOT_MODE=paper bun run src/index.ts
```
Expected: Bot starts, dashboard logs, loop begins

**Step 5: Run all tests**

```bash
bun test
```
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/bot.ts src/index.ts package.json
git commit -m "feat: add main bot orchestration loop and entry point"
```

---

## Run All Tests (Final Verification)

```bash
bun test --reporter=verbose
```

Expected: All test suites pass.

```bash
BOT_MODE=paper bun run src/index.ts
```

Expected:
```
[transBoot] Starting in PAPER mode...
Dashboard running at http://localhost:3000
[transBoot] Bot loop starting...
[transBoot] Running. Next tick in 30s
```

Visit `http://localhost:3000` to verify dashboard renders.

---

## Summary

| Phase | Tasks | Key Deliverables |
|---|---|---|
| 1 | 1-3 | Project scaffold, config, event bus |
| 2 | 4-5 | SQLite storage, Polymarket client |
| 3 | 6-7 | LLM providers (4x), quant engine, signal aggregator |
| 4 | 8-10 | Position tracker, risk manager, order manager |
| 5 | 11-12 | Strategy base, engine, 4 strategies |
| 6 | 13-14 | Notifier, web dashboard |
| 7 | 15 | Backtest engine |
| 8 | 16 | Main bot loop + entry point |

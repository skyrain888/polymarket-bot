# Wallet Screener Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an intelligent wallet screening feature that discovers top Polymarket traders, scores them quantitatively, then uses Claude API to generate copy-trading recommendations with reasoning and strategy suggestions.

**Architecture:** Pipeline approach: Polymarket Leaderboard API → quantitative 4-dimension scoring → Claude LLM analysis of top candidates → Dashboard UI with one-click add to copy trading. Scheduler runs independently like ArchiveService.

**Tech Stack:** Bun runtime, Hono (dashboard), HTMX (frontend), @anthropic-ai/sdk (Claude API), Polymarket Data API

---

### Task 1: Screener Types

**Files:**
- Create: `src/strategies/copy-trading/screener/types.ts`

**Step 1: Create the types file**

```typescript
export interface LeaderboardEntry {
  rank: number
  address: string
  username: string
  profileImage: string
  pnl: number
  volume: number
}

export interface TraderProfile {
  entry: LeaderboardEntry
  positions: TraderPosition[]
  recentTrades: TraderTrade[]
  totalPortfolioValue: number
}

export interface TraderPosition {
  conditionId: string
  title: string
  outcome: string
  size: number
  currentValue: number
}

export interface TraderTrade {
  marketId: string
  title: string
  outcome: string
  side: 'buy' | 'sell'
  size: number
  price: number
  timestamp: number
}

export interface DimensionScores {
  returns: number      // 0-100, weight 35%
  activity: number     // 0-100, weight 25%
  portfolioSize: number // 0-100, weight 20%
  diversification: number // 0-100, weight 20%
}

export interface ScoredTrader {
  profile: TraderProfile
  scores: DimensionScores
  totalScore: number
}

export interface LLMRecommendation {
  level: 'recommended' | 'cautious' | 'not_recommended'
  reasoning: string
  suggestedSizeMode: 'fixed' | 'proportional'
  suggestedAmount: number       // USDC if fixed, pct 0-1 if proportional
  suggestedMaxCopiesPerMarket: number
  riskWarning: string
}

export interface ScreenerResult {
  address: string
  username: string
  profileImage: string
  rank: number
  pnl: number
  volume: number
  totalPortfolioValue: number
  scores: DimensionScores
  totalScore: number
  recommendation: LLMRecommendation
  screenedAt: number  // unix timestamp seconds
}

export interface ScreenerConfig {
  enabled: boolean
  scheduleCron: 'daily' | 'disabled'
  lastRunAt: number | null
}

export type ScreenerStatus = 'idle' | 'running' | 'done' | 'error'

export interface ScreenerState {
  status: ScreenerStatus
  progress: number       // 0-100
  progressLabel: string
  results: ScreenerResult[]
  lastError: string | null
}
```

**Step 2: Commit**

```bash
git add src/strategies/copy-trading/screener/types.ts
git commit -m "feat(screener): add type definitions for wallet screener"
```

---

### Task 2: Data Fetcher

**Files:**
- Create: `src/strategies/copy-trading/screener/data-fetcher.ts`

**Dependencies:** Task 1 (types)

**Step 1: Create data-fetcher.ts**

This module fetches data from Polymarket APIs. It extends the patterns used in `src/strategies/copy-trading/graph-client.ts` (uses same fetch + `tls: { rejectUnauthorized: false }` pattern).

```typescript
import type { LeaderboardEntry, TraderProfile, TraderPosition, TraderTrade } from './types.ts'

const LEADERBOARD_URL = 'https://data-api.polymarket.com/v1/leaderboard'
const ACTIVITY_URL = 'https://data-api.polymarket.com/activity'
const POSITIONS_URL = 'https://data-api.polymarket.com/positions'
const PROFILE_URL = 'https://gamma-api.polymarket.com/public-profile'

const FETCH_OPTS = { tls: { rejectUnauthorized: false } } as any

export class DataFetcher {
  /** Fetch top traders from leaderboard */
  async getLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
    const res = await fetch(LEADERBOARD_URL, FETCH_OPTS)
    if (!res.ok) throw new Error(`Leaderboard API failed: ${res.status}`)
    const data = (await res.json()) as any[]
    return data.slice(0, limit).map((d: any, i: number) => ({
      rank: d.rank ?? i + 1,
      address: (d.proxyWallet ?? d.address ?? '').toLowerCase(),
      username: d.userName ?? d.pseudonym ?? '',
      profileImage: d.profileImage ?? '',
      pnl: Number(d.pnl ?? 0),
      volume: Number(d.vol ?? d.volume ?? 0),
    }))
  }

  /** Fetch a trader's recent activity (last 50 trades) */
  async getRecentTrades(address: string, limit = 50): Promise<TraderTrade[]> {
    const params = new URLSearchParams({ user: address.toLowerCase(), limit: String(limit) })
    const res = await fetch(`${ACTIVITY_URL}?${params}`, FETCH_OPTS)
    if (!res.ok) return []
    const events = (await res.json()) as any[]
    return events
      .filter((e: any) => e.type === 'TRADE' && e.side)
      .map((e: any) => ({
        marketId: e.conditionId ?? '',
        title: e.title ?? '',
        outcome: e.outcome ?? '',
        side: (e.side as string).toLowerCase() as 'buy' | 'sell',
        size: Number(e.usdcSize ?? e.size ?? 0),
        price: Number(e.price ?? 0),
        timestamp: Number(e.timestamp ?? 0),
      }))
  }

  /** Fetch a trader's current positions */
  async getPositions(address: string): Promise<{ positions: TraderPosition[]; totalValue: number }> {
    const params = new URLSearchParams({ user: address.toLowerCase() })
    const res = await fetch(`${POSITIONS_URL}?${params}`, FETCH_OPTS)
    if (!res.ok) return { positions: [], totalValue: 0 }
    const raw = (await res.json()) as any[]
    const positions: TraderPosition[] = raw.map((p: any) => ({
      conditionId: p.conditionId ?? p.asset ?? '',
      title: p.title ?? '',
      outcome: p.outcome ?? '',
      size: Number(p.size ?? 0),
      currentValue: Number(p.currentValue ?? 0),
    }))
    const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0)
    return { positions, totalValue }
  }

  /** Build full trader profile from leaderboard entry */
  async buildProfile(entry: LeaderboardEntry): Promise<TraderProfile> {
    const [tradesResult, positionsResult] = await Promise.all([
      this.getRecentTrades(entry.address),
      this.getPositions(entry.address),
    ])
    return {
      entry,
      positions: positionsResult.positions,
      recentTrades: tradesResult,
      totalPortfolioValue: positionsResult.totalValue,
    }
  }

  /** Build profiles for multiple entries with concurrency limit */
  async buildProfiles(entries: LeaderboardEntry[], concurrency = 5): Promise<TraderProfile[]> {
    const results: TraderProfile[] = []
    for (let i = 0; i < entries.length; i += concurrency) {
      const batch = entries.slice(i, i + concurrency)
      const profiles = await Promise.allSettled(batch.map(e => this.buildProfile(e)))
      for (const r of profiles) {
        if (r.status === 'fulfilled') results.push(r.value)
      }
    }
    return results
  }
}
```

**Step 2: Commit**

```bash
git add src/strategies/copy-trading/screener/data-fetcher.ts
git commit -m "feat(screener): add Polymarket data fetcher for leaderboard, positions, activity"
```

---

### Task 3: Scoring Engine

**Files:**
- Create: `src/strategies/copy-trading/screener/scoring-engine.ts`

**Dependencies:** Task 1 (types)

**Step 1: Create scoring-engine.ts**

```typescript
import type { TraderProfile, DimensionScores, ScoredTrader } from './types.ts'

const WEIGHTS = { returns: 0.35, activity: 0.25, portfolioSize: 0.20, diversification: 0.20 }

export class ScoringEngine {
  score(profiles: TraderProfile[]): ScoredTrader[] {
    const scored = profiles.map(profile => {
      const scores = this.computeScores(profile)
      const totalScore = Math.round(
        scores.returns * WEIGHTS.returns +
        scores.activity * WEIGHTS.activity +
        scores.portfolioSize * WEIGHTS.portfolioSize +
        scores.diversification * WEIGHTS.diversification
      )
      return { profile, scores, totalScore }
    })
    return scored.sort((a, b) => b.totalScore - a.totalScore)
  }

  private computeScores(profile: TraderProfile): DimensionScores {
    return {
      returns: this.scoreReturns(profile),
      activity: this.scoreActivity(profile),
      portfolioSize: this.scorePortfolioSize(profile),
      diversification: this.scoreDiversification(profile),
    }
  }

  /** PnL and win rate from leaderboard + recent trades */
  private scoreReturns(p: TraderProfile): number {
    let score = 0
    // PnL component (0-50): positive PnL is good, scale logarithmically
    if (p.entry.pnl > 0) {
      score += Math.min(50, Math.log10(p.entry.pnl + 1) * 12)
    }
    // Win rate component (0-50): from recent trades
    const trades = p.recentTrades
    if (trades.length >= 5) {
      // Approximate win rate: buys at low price (<0.5) that went up, sells at high price
      // Simple heuristic: count trades and use price patterns
      const buyTrades = trades.filter(t => t.side === 'buy')
      const goodBuys = buyTrades.filter(t => t.price < 0.65) // bought before likely resolution
      const winRate = buyTrades.length > 0 ? goodBuys.length / buyTrades.length : 0.5
      score += winRate * 50
    } else {
      score += 25 // neutral if not enough data
    }
    return Math.min(100, Math.round(score))
  }

  /** Recent trading frequency and recency */
  private scoreActivity(p: TraderProfile): number {
    const trades = p.recentTrades
    if (trades.length === 0) return 0

    let score = 0
    // Volume of trades (0-50): more trades = more active
    score += Math.min(50, trades.length * 2)

    // Recency (0-50): how recent is the last trade
    const now = Math.floor(Date.now() / 1000)
    const latestTrade = Math.max(...trades.map(t => t.timestamp))
    const daysSinceLastTrade = (now - latestTrade) / 86400
    if (daysSinceLastTrade < 1) score += 50
    else if (daysSinceLastTrade < 3) score += 40
    else if (daysSinceLastTrade < 7) score += 25
    else if (daysSinceLastTrade < 14) score += 10

    return Math.min(100, Math.round(score))
  }

  /** Total portfolio value and average trade size */
  private scorePortfolioSize(p: TraderProfile): number {
    let score = 0
    // Portfolio value (0-60): log scale
    if (p.totalPortfolioValue > 0) {
      score += Math.min(60, Math.log10(p.totalPortfolioValue + 1) * 15)
    }
    // Average trade size (0-40): prefer medium-sized traders
    const trades = p.recentTrades
    if (trades.length > 0) {
      const avgSize = trades.reduce((s, t) => s + t.size, 0) / trades.length
      if (avgSize >= 10 && avgSize <= 5000) score += 40
      else if (avgSize > 5000) score += 25 // too big, harder to copy
      else score += 15 // too small
    }
    return Math.min(100, Math.round(score))
  }

  /** Market diversification and concentration risk */
  private scoreDiversification(p: TraderProfile): number {
    const positions = p.positions
    if (positions.length === 0) return 0

    let score = 0
    // Number of distinct markets (0-50)
    const uniqueMarkets = new Set(positions.map(pos => pos.conditionId))
    const marketCount = uniqueMarkets.size
    score += Math.min(50, marketCount * 8)

    // Concentration: max single-market value as pct of total (0-50)
    if (p.totalPortfolioValue > 0) {
      // Group by conditionId and sum values
      const marketValues = new Map<string, number>()
      for (const pos of positions) {
        const cur = marketValues.get(pos.conditionId) ?? 0
        marketValues.set(pos.conditionId, cur + pos.currentValue)
      }
      const maxValue = Math.max(...marketValues.values())
      const maxPct = maxValue / p.totalPortfolioValue
      // Lower concentration = better. maxPct=1 means all in one market → 0 points
      score += Math.round((1 - maxPct) * 50)
    }

    return Math.min(100, Math.round(score))
  }
}
```

**Step 2: Commit**

```bash
git add src/strategies/copy-trading/screener/scoring-engine.ts
git commit -m "feat(screener): add 4-dimension quantitative scoring engine"
```

---

### Task 4: LLM Analyzer

**Files:**
- Create: `src/strategies/copy-trading/screener/llm-analyzer.ts`

**Dependencies:** Task 1 (types)

**Context:** The project already has `@anthropic-ai/sdk` in package.json. The LLM API key is available at `config.llm.apiKey` and model at `config.llm.model`. See `src/config/index.ts:21-25` for how config is loaded.

**Step 1: Create llm-analyzer.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ScoredTrader, LLMRecommendation, ScreenerResult } from './types.ts'

export class LLMAnalyzer {
  private client: Anthropic

  constructor(private apiKey: string, private model = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey })
  }

  async analyze(traders: ScoredTrader[]): Promise<ScreenerResult[]> {
    const results: ScreenerResult[] = []
    // Process in batches of 5
    for (let i = 0; i < traders.length; i += 5) {
      const batch = traders.slice(i, i + 5)
      const batchResults = await this.analyzeBatch(batch)
      results.push(...batchResults)
    }
    return results
  }

  private async analyzeBatch(traders: ScoredTrader[]): Promise<ScreenerResult[]> {
    const tradersData = traders.map(t => this.formatTraderData(t)).join('\n---\n')

    const prompt = `你是一个 Polymarket 跟单分析师。分析以下交易者数据，为每个交易者给出跟单建议。

对每个交易者，输出严格的 JSON 数组，每个元素包含：
- "address": 交易者地址
- "level": "recommended" | "cautious" | "not_recommended"
- "reasoning": 2-3句话的跟单理由（中文）
- "suggestedSizeMode": "fixed" | "proportional"
- "suggestedAmount": 数字（fixed模式为USDC金额如30，proportional模式为比例如0.1）
- "suggestedMaxCopiesPerMarket": 数字（建议1-5）
- "riskWarning": 风险提示（中文，1句话）

分析要点：
- 综合评分高且活跃度高的交易者更值得跟单
- 资金规模大的交易者建议用比例模式，小资金用固定模式
- 分散度低的交易者要降低跟单金额
- 胜率高但交易少的需要谨慎

交易者数据：
${tradersData}

只输出JSON数组，不要其他内容。`

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        console.error('[Screener] LLM response did not contain valid JSON array')
        return traders.map(t => this.fallbackResult(t))
      }

      const recommendations = JSON.parse(jsonMatch[0]) as any[]
      return traders.map(t => {
        const rec = recommendations.find((r: any) =>
          r.address?.toLowerCase() === t.profile.entry.address.toLowerCase()
        )
        if (!rec) return this.fallbackResult(t)

        return {
          address: t.profile.entry.address,
          username: t.profile.entry.username,
          profileImage: t.profile.entry.profileImage,
          rank: t.profile.entry.rank,
          pnl: t.profile.entry.pnl,
          volume: t.profile.entry.volume,
          totalPortfolioValue: t.profile.totalPortfolioValue,
          scores: t.scores,
          totalScore: t.totalScore,
          recommendation: {
            level: rec.level ?? 'cautious',
            reasoning: rec.reasoning ?? '数据不足，建议谨慎',
            suggestedSizeMode: rec.suggestedSizeMode ?? 'fixed',
            suggestedAmount: Number(rec.suggestedAmount ?? 30),
            suggestedMaxCopiesPerMarket: Number(rec.suggestedMaxCopiesPerMarket ?? 2),
            riskWarning: rec.riskWarning ?? '请注意风险',
          } as LLMRecommendation,
          screenedAt: Math.floor(Date.now() / 1000),
        }
      })
    } catch (err) {
      console.error('[Screener] LLM analysis failed:', err)
      return traders.map(t => this.fallbackResult(t))
    }
  }

  private formatTraderData(t: ScoredTrader): string {
    const e = t.profile.entry
    const topPositions = t.profile.positions.slice(0, 5).map(p =>
      `  - ${p.title || p.conditionId.slice(0, 12)}: $${p.currentValue.toFixed(2)} (${p.outcome})`
    ).join('\n')
    const recentTradesSummary = t.profile.recentTrades.slice(0, 10).map(tr =>
      `  - ${tr.side.toUpperCase()} $${tr.size.toFixed(2)} @ ${tr.price.toFixed(3)} | ${tr.title || tr.marketId.slice(0, 12)}`
    ).join('\n')

    return `地址: ${e.address}
用户名: ${e.username || '匿名'}
排名: #${e.rank}
PnL: $${e.pnl.toFixed(2)}
总成交量: $${e.volume.toFixed(2)}
持仓总值: $${t.profile.totalPortfolioValue.toFixed(2)}
评分: 总分${t.totalScore} (收益${t.scores.returns} 活跃${t.scores.activity} 规模${t.scores.portfolioSize} 分散${t.scores.diversification})
持仓数: ${t.profile.positions.length}个市场
最近交易数: ${t.profile.recentTrades.length}笔
主要持仓:
${topPositions || '  (无)'}
最近交易:
${recentTradesSummary || '  (无)'}`
  }

  private fallbackResult(t: ScoredTrader): ScreenerResult {
    return {
      address: t.profile.entry.address,
      username: t.profile.entry.username,
      profileImage: t.profile.entry.profileImage,
      rank: t.profile.entry.rank,
      pnl: t.profile.entry.pnl,
      volume: t.profile.entry.volume,
      totalPortfolioValue: t.profile.totalPortfolioValue,
      scores: t.scores,
      totalScore: t.totalScore,
      recommendation: {
        level: 'cautious',
        reasoning: 'LLM分析未能完成，基于量化评分建议谨慎跟单',
        suggestedSizeMode: 'fixed',
        suggestedAmount: 30,
        suggestedMaxCopiesPerMarket: 2,
        riskWarning: '分析数据不完整，请自行评估风险',
      },
      screenedAt: Math.floor(Date.now() / 1000),
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/strategies/copy-trading/screener/llm-analyzer.ts
git commit -m "feat(screener): add Claude LLM analyzer for wallet recommendations"
```

---

### Task 5: Screener Service (Orchestrator)

**Files:**
- Create: `src/strategies/copy-trading/screener/index.ts`

**Dependencies:** Tasks 1-4

**Context:** This follows the same service pattern as `src/infrastructure/archive/service.ts` — a class with `start()`/`stop()` methods and an interval timer.

**Step 1: Create screener/index.ts**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ScreenerConfig, ScreenerResult, ScreenerState, ScreenerStatus } from './types.ts'
import { DataFetcher } from './data-fetcher.ts'
import { ScoringEngine } from './scoring-engine.ts'
import { LLMAnalyzer } from './llm-analyzer.ts'

const RESULTS_PATH = './data/screener-results.json'
const SCHEDULE_INTERVAL_MS = 24 * 60 * 60 * 1000
const TOP_N_FOR_LLM = 20

export class ScreenerService {
  private fetcher = new DataFetcher()
  private scorer = new ScoringEngine()
  private analyzer: LLMAnalyzer
  private timer: ReturnType<typeof setInterval> | null = null
  private state: ScreenerState = {
    status: 'idle',
    progress: 0,
    progressLabel: '',
    results: [],
    lastError: null,
  }
  private config: ScreenerConfig = { enabled: false, scheduleCron: 'disabled', lastRunAt: null }

  constructor(apiKey: string, model?: string) {
    this.analyzer = new LLMAnalyzer(apiKey, model)
    this.loadResults()
  }

  getState(): ScreenerState { return { ...this.state } }
  getConfig(): ScreenerConfig { return { ...this.config } }

  updateConfig(cfg: Partial<ScreenerConfig>) {
    this.config = { ...this.config, ...cfg }
    // Restart scheduler if needed
    this.stop()
    if (this.config.enabled && this.config.scheduleCron === 'daily') {
      this.start()
    }
  }

  start(): void {
    if (this.timer != null) return
    if (this.config.scheduleCron === 'daily') {
      this.timer = setInterval(() => this.run(), SCHEDULE_INTERVAL_MS)
      console.log('[Screener] Scheduled daily screening')
    }
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Run screening pipeline. Can be called manually or by scheduler. */
  async run(): Promise<ScreenerResult[]> {
    if (this.state.status === 'running') {
      console.log('[Screener] Already running, skipping')
      return this.state.results
    }

    this.state = { status: 'running', progress: 0, progressLabel: '获取排行榜...', results: [], lastError: null }

    try {
      // Stage 1: Fetch leaderboard
      this.updateProgress(10, '获取排行榜数据...')
      const leaderboard = await this.fetcher.getLeaderboard(100)
      console.log(`[Screener] Fetched ${leaderboard.length} leaderboard entries`)

      // Stage 2: Build profiles (parallel with concurrency limit)
      this.updateProgress(20, `采集 ${leaderboard.length} 个钱包数据...`)
      const profiles = await this.fetcher.buildProfiles(leaderboard, 5)
      console.log(`[Screener] Built ${profiles.length} trader profiles`)

      // Stage 3: Score
      this.updateProgress(60, '量化评分中...')
      const scored = this.scorer.score(profiles)
      const topN = scored.slice(0, TOP_N_FOR_LLM)
      console.log(`[Screener] Top ${topN.length} traders selected for LLM analysis`)

      // Stage 4: LLM analysis
      this.updateProgress(70, `AI分析 ${topN.length} 个候选钱包...`)
      const results = await this.analyzer.analyze(topN)
      console.log(`[Screener] LLM analysis complete: ${results.length} results`)

      // Sort by recommendation level, then score
      const levelOrder = { recommended: 0, cautious: 1, not_recommended: 2 }
      results.sort((a, b) =>
        levelOrder[a.recommendation.level] - levelOrder[b.recommendation.level] ||
        b.totalScore - a.totalScore
      )

      this.state = { status: 'done', progress: 100, progressLabel: '筛选完成', results, lastError: null }
      this.config.lastRunAt = Math.floor(Date.now() / 1000)
      this.saveResults()
      return results
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Screener] Pipeline failed:', msg)
      this.state = { ...this.state, status: 'error', progress: 0, progressLabel: '', lastError: msg }
      return []
    }
  }

  private updateProgress(progress: number, label: string) {
    this.state.progress = progress
    this.state.progressLabel = label
  }

  private loadResults() {
    if (!existsSync(RESULTS_PATH)) return
    try {
      const raw = readFileSync(RESULTS_PATH, 'utf-8')
      const data = JSON.parse(raw) as { results: ScreenerResult[]; config?: ScreenerConfig }
      this.state.results = data.results ?? []
      if (data.config) this.config = data.config
      if (this.state.results.length > 0) this.state.status = 'done'
      console.log(`[Screener] Loaded ${this.state.results.length} previous results from disk`)
    } catch {
      console.error('[Screener] Failed to load screener results from disk')
    }
  }

  private saveResults() {
    try {
      const dir = dirname(RESULTS_PATH)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(RESULTS_PATH, JSON.stringify({ results: this.state.results, config: this.config }, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Screener] Failed to save results to disk:', err)
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/strategies/copy-trading/screener/index.ts
git commit -m "feat(screener): add ScreenerService orchestrator with pipeline and scheduling"
```

---

### Task 6: Dashboard Screener Routes

**Files:**
- Modify: `src/infrastructure/dashboard/server.ts` (add screener routes + deps)
- Modify: `src/infrastructure/dashboard/views.ts` (add nav link)

**Dependencies:** Tasks 1-5

**Context:**
- Dashboard deps interface is at `server.ts:16-28`. Add `screenerService?: ScreenerService`
- Nav bar is in `views.ts:33-43`. Add screener link after `历史存档`
- Copy trading config is accessed via `deps.config.copyTrading` and saved via `deps.configStore?.save()`
- HTMX polling pattern: see the trades card in server.ts for how `hx-get`/`hx-trigger` are used

**Step 1: Add nav link in views.ts**

In `src/infrastructure/dashboard/views.ts`, inside the `<nav>` element (after the `历史存档` link at line 42), add:

```html
    <a href="/screener">智能筛选</a>
```

**Step 2: Add screener routes and views in server.ts**

At the top of `server.ts`, add the import:
```typescript
import type { ScreenerService } from '../../strategies/copy-trading/screener/index.ts'
import type { ScreenerResult, ScreenerState } from '../../strategies/copy-trading/screener/types.ts'
```

Add to `DashboardDeps` interface:
```typescript
  screenerService?: ScreenerService
```

Add the following routes before the `serve()` call at the end of `createDashboard()`:

```typescript
  // ── Screener Routes ──────────────────────────────────────────

  app.get('/screener', (c) => {
    const screener = deps.screenerService
    const state = screener?.getState() ?? { status: 'idle', progress: 0, progressLabel: '', results: [], lastError: null }
    const cfg = screener?.getConfig() ?? { enabled: false, scheduleCron: 'disabled', lastRunAt: null }
    return c.html(layout('智能筛选', screenerPageHtml(state, cfg)))
  })

  app.post('/screener/run', async (c) => {
    const screener = deps.screenerService
    if (!screener) return c.text('Screener not configured', 500)
    // Run in background, don't await
    screener.run()
    // Return progress bar that polls
    return c.html(screenerProgressHtml(screener.getState()))
  })

  app.get('/screener/progress', (c) => {
    const screener = deps.screenerService
    const state = screener?.getState() ?? { status: 'idle', progress: 0, progressLabel: '', results: [], lastError: null }
    if (state.status === 'done' || state.status === 'error') {
      // Return full results, stop polling
      return c.html(screenerResultsHtml(state))
    }
    return c.html(screenerProgressHtml(state))
  })

  app.get('/screener/results', (c) => {
    const screener = deps.screenerService
    const state = screener?.getState() ?? { status: 'idle', progress: 0, progressLabel: '', results: [], lastError: null }
    return c.html(screenerResultsHtml(state))
  })

  app.post('/screener/add-wallet', async (c) => {
    const body = await c.req.parseBody()
    const address = String(body.address ?? '')
    const label = String(body.label ?? '')
    const sizeMode = String(body.sizeMode ?? 'fixed') as 'fixed' | 'proportional'
    const amount = Number(body.amount ?? 30)
    const maxCopiesPerMarket = Number(body.maxCopiesPerMarket ?? 2)

    if (!address) return c.text('Missing address', 400)

    // Check if wallet already exists
    const existing = deps.config.copyTrading.wallets.find(w => w.address.toLowerCase() === address.toLowerCase())
    if (existing) return c.html(`<span class="badge badge-warn">已在跟单列表中</span>`)

    deps.config.copyTrading.wallets.push({
      address: address.toLowerCase(),
      label: label || address.slice(0, 10),
      sizeMode,
      fixedAmount: sizeMode === 'fixed' ? amount : undefined,
      proportionPct: sizeMode === 'proportional' ? amount : undefined,
      maxCopiesPerMarket,
    })
    applyConfig()
    return c.html(`<span class="badge badge-ok">已添加到跟单</span>`)
  })

  app.post('/screener/schedule', async (c) => {
    const body = await c.req.parseBody()
    const schedule = String(body.schedule ?? 'disabled')
    deps.screenerService?.updateConfig({
      enabled: schedule === 'daily',
      scheduleCron: schedule as 'daily' | 'disabled',
    })
    return c.html(`<span class="badge badge-ok">${schedule === 'daily' ? '已开启每日筛选' : '已关闭定时筛选'}</span>`)
  })
```

Then add these helper functions inside `createDashboard()` (before the routes, after the existing helper functions):

```typescript
  // ── Screener HTML helpers ─────────────────────────────────────

  function screenerPageHtml(state: ScreenerState, cfg: { scheduleCron: string; lastRunAt: number | null }): string {
    const lastRun = cfg.lastRunAt ? new Date(cfg.lastRunAt * 1000).toLocaleString() : '从未'
    return `
    <h2 style="margin-bottom:1rem">智能钱包筛选</h2>
    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
        <button hx-post="/screener/run" hx-target="#screener-content" hx-swap="innerHTML"
          style="background:#7c83fd;color:#fff;border:none;padding:0.5rem 1.5rem;border-radius:6px;cursor:pointer;font-size:1rem"
          ${state.status === 'running' ? 'disabled' : ''}>
          ${state.status === 'running' ? '筛选中...' : '开始筛选'}
        </button>
        <form hx-post="/screener/schedule" hx-target="#schedule-status" hx-swap="innerHTML" style="display:flex;gap:0.5rem;align-items:center">
          <label style="color:#888;font-size:0.9rem">定时:</label>
          <select name="schedule" style="background:#2a2a3e;color:#e0e0e0;border:1px solid #3a3a4e;padding:0.3rem;border-radius:4px">
            <option value="disabled" ${cfg.scheduleCron === 'disabled' ? 'selected' : ''}>关闭</option>
            <option value="daily" ${cfg.scheduleCron === 'daily' ? 'selected' : ''}>每日</option>
          </select>
          <button type="submit" style="background:#3a3a4e;color:#e0e0e0;border:none;padding:0.3rem 0.8rem;border-radius:4px;cursor:pointer">保存</button>
          <span id="schedule-status"></span>
        </form>
        <span style="color:#888;font-size:0.85rem">上次筛选: ${lastRun}</span>
      </div>
    </div>
    <div id="screener-content">
      ${state.status === 'running' ? screenerProgressHtml(state) : screenerResultsHtml(state)}
    </div>`
  }

  function screenerProgressHtml(state: ScreenerState): string {
    return `
    <div class="card" hx-get="/screener/progress" hx-trigger="every 2s" hx-swap="outerHTML">
      <div style="margin-bottom:0.5rem;color:#888">${state.progressLabel}</div>
      <div style="background:#2a2a3e;border-radius:4px;height:24px;overflow:hidden">
        <div style="background:#7c83fd;height:100%;width:${state.progress}%;transition:width 0.3s;display:flex;align-items:center;justify-content:center;font-size:0.8rem;color:#fff">
          ${state.progress}%
        </div>
      </div>
    </div>`
  }

  function screenerResultsHtml(state: ScreenerState): string {
    if (state.lastError) {
      return `<div class="card"><span class="badge badge-err">筛选失败: ${state.lastError}</span></div>`
    }
    if (state.results.length === 0) {
      return `<div class="card" style="text-align:center;color:#888;padding:3rem">点击"开始筛选"从 Polymarket 排行榜发现优质跟单对象</div>`
    }

    const levelBadge = (l: string) => l === 'recommended' ? '<span class="badge badge-ok">推荐</span>'
      : l === 'cautious' ? '<span class="badge badge-warn">谨慎</span>'
      : '<span class="badge badge-err">不推荐</span>'

    const cards = state.results.map((r, i) => `
      <div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem">
          <div>
            <span style="color:#7c83fd;font-weight:bold;font-size:1.1rem">#${i + 1} ${r.username || r.address.slice(0, 10)}</span>
            <span style="color:#888;font-size:0.8rem;margin-left:0.5rem">${r.address.slice(0, 6)}...${r.address.slice(-4)}</span>
            <span style="margin-left:0.5rem">排名 #${r.rank}</span>
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center">
            ${levelBadge(r.recommendation.level)}
            <span style="background:#2a2a3e;padding:2px 8px;border-radius:4px;font-size:0.85rem">综合 ${r.totalScore}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:0.75rem;font-size:0.85rem">
          <div><span style="color:#888">PnL:</span> <span class="${r.pnl >= 0 ? 'positive' : 'negative'}">$${r.pnl.toFixed(0)}</span></div>
          <div><span style="color:#888">成交量:</span> $${r.volume >= 1000 ? (r.volume / 1000).toFixed(1) + 'K' : r.volume.toFixed(0)}</div>
          <div><span style="color:#888">持仓:</span> $${r.totalPortfolioValue >= 1000 ? (r.totalPortfolioValue / 1000).toFixed(1) + 'K' : r.totalPortfolioValue.toFixed(0)}</div>
          <div style="display:flex;gap:0.3rem">
            <span style="color:#2ecc71;font-size:0.75rem">收益${r.scores.returns}</span>
            <span style="color:#3498db;font-size:0.75rem">活跃${r.scores.activity}</span>
            <span style="color:#f39c12;font-size:0.75rem">规模${r.scores.portfolioSize}</span>
            <span style="color:#9b59b6;font-size:0.75rem">分散${r.scores.diversification}</span>
          </div>
        </div>
        <div style="background:#12121e;border-radius:6px;padding:0.75rem;margin-bottom:0.75rem">
          <div style="font-size:0.85rem;margin-bottom:0.5rem"><strong style="color:#7c83fd">跟单理由:</strong> ${r.recommendation.reasoning}</div>
          <div style="font-size:0.85rem;margin-bottom:0.5rem"><strong style="color:#7c83fd">推荐策略:</strong> ${r.recommendation.suggestedSizeMode === 'fixed' ? '固定金额 $' + r.recommendation.suggestedAmount : '比例 ' + (r.recommendation.suggestedAmount * 100).toFixed(0) + '%'} | 单市场上限: ${r.recommendation.suggestedMaxCopiesPerMarket}次</div>
          <div style="font-size:0.85rem;color:#e74c3c">风险提示: ${r.recommendation.riskWarning}</div>
        </div>
        <div style="text-align:right" id="add-wallet-${i}">
          <form hx-post="/screener/add-wallet" hx-target="#add-wallet-${i}" hx-swap="innerHTML" style="display:inline">
            <input type="hidden" name="address" value="${r.address}">
            <input type="hidden" name="label" value="${r.username || r.address.slice(0, 10)}">
            <input type="hidden" name="sizeMode" value="${r.recommendation.suggestedSizeMode}">
            <input type="hidden" name="amount" value="${r.recommendation.suggestedAmount}">
            <input type="hidden" name="maxCopiesPerMarket" value="${r.recommendation.suggestedMaxCopiesPerMarket}">
            <button type="submit" style="background:#1e4d2b;color:#2ecc71;border:1px solid #2ecc71;padding:0.4rem 1rem;border-radius:4px;cursor:pointer">+ 添加到跟单</button>
          </form>
        </div>
      </div>
    `).join('')

    const recommendedCount = state.results.filter(r => r.recommendation.level === 'recommended').length
    const screenedAt = state.results[0]?.screenedAt
    const timeStr = screenedAt ? new Date(screenedAt * 1000).toLocaleString() : ''

    return `
    <div style="margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:0.9rem;color:#888">共 ${state.results.length} 个钱包 | ${recommendedCount} 个推荐 | 筛选时间: ${timeStr}</span>
    </div>
    ${cards}`
  }
```

**Step 3: Commit**

```bash
git add src/infrastructure/dashboard/server.ts src/infrastructure/dashboard/views.ts
git commit -m "feat(screener): add dashboard routes and UI for wallet screening"
```

---

### Task 7: Wire ScreenerService Into Bot Startup

**Files:**
- Modify: `src/bot.ts`

**Dependencies:** Tasks 5-6

**Context:** Follow the pattern used for `ArchiveService` in `bot.ts:65-71`. The ScreenerService needs the LLM API key from config.

**Step 1: Add import at top of bot.ts**

```typescript
import { ScreenerService } from './strategies/copy-trading/screener/index.ts'
```

**Step 2: Initialize ScreenerService after archiveService**

After line 71 (`archiveService.start()`), add:

```typescript
  const screenerService = config.llm.apiKey
    ? new ScreenerService(config.llm.apiKey, config.llm.model)
    : null
  if (screenerService) {
    screenerService.start()
    console.log('[transBoot] Wallet screener initialized')
  }
```

**Step 3: Add screenerService to dashboard deps**

In the `createDashboard()` call (line 88), add `screenerService` to the deps object:

```typescript
  createDashboard({ positionTracker, riskManager, strategyEngine, orderRepo, signalRepo, getBalance: () => polyClient.getBalance(), config, copyTradingStrategy, configStore, archiveService, archiveRepo, screenerService }, config.dashboard.port)
```

**Step 4: Commit**

```bash
git add src/bot.ts
git commit -m "feat(screener): wire ScreenerService into bot startup and dashboard"
```

---

### Task 8: Manual Smoke Test

**Dependencies:** Tasks 1-7

**Step 1: Start the bot**

```bash
./start.sh
```

**Step 2: Verify in browser**

1. Open http://localhost:3000
2. Verify nav bar shows "智能筛选" link
3. Click "智能筛选" — should show the screener page with "开始筛选" button
4. Click "开始筛选" — should show progress bar updating
5. Wait for completion — should show result cards with recommendations
6. Click "添加到跟单" on one result — should show success badge
7. Navigate to "跟单" page — verify the wallet was added

**Step 3: Verify logs**

```bash
tail -20 nohup.out
```

Check for `[Screener]` log lines showing the pipeline stages.

**Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix(screener): address smoke test issues"
```

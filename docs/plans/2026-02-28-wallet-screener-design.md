# Wallet Screener Design

## Overview

Add an intelligent wallet screening feature to the copy trading system. The screener discovers and evaluates Polymarket wallets from the leaderboard, scores them on multiple dimensions, then uses Claude API to generate follow-trade recommendations with reasoning and strategy suggestions.

## Architecture

```
Leaderboard API → Quantitative Scoring → Claude LLM Analysis → Dashboard Display
```

### New Files

```
src/strategies/copy-trading/screener/
├── index.ts           # ScreenerService (orchestration, scheduling)
├── data-fetcher.ts    # Polymarket API data collection
├── scoring-engine.ts  # Multi-dimensional scoring
├── llm-analyzer.ts    # Claude API analysis
└── types.ts           # Type definitions
data/
├── screener-results.json  # Persisted screening results
```

## Data Pipeline

### Stage 1: Data Collection (data-fetcher.ts)

API calls:
1. `GET /v1/leaderboard` → Top 100 traders (rank, wallet, pnl, volume, username)
2. Per candidate wallet (parallel):
   - `GET /positions?user={wallet}` → Current positions (diversity, portfolio size)
   - `GET /activity?user={wallet}&limit=50` → Recent trades (activity, win rate)
   - `GET /public-profile?wallet={wallet}` → Public info

### Stage 2: Quantitative Scoring (scoring-engine.ts)

Four dimensions, each 0-100, weighted total:

| Dimension | Weight | Metrics | Source |
|-----------|--------|---------|--------|
| Win Rate / Returns | 35% | PnL, win rate from trades | leaderboard + activity |
| Trading Activity | 25% | Recent frequency, last trade time | activity data |
| Portfolio Size | 20% | Total position value, avg trade size | positions |
| Diversification | 20% | Market count, max single-market concentration | positions distribution |

Output: Top 20 by total score → LLM analysis

### Stage 3: LLM Analysis (llm-analyzer.ts)

- Uses Claude API (@anthropic-ai/sdk)
- Batches of 4-5 wallets per request
- For each wallet outputs:
  - Recommendation level: recommended / cautious / not recommended
  - Reasoning (2-3 sentences)
  - Suggested strategy: sizeMode, amount/proportion, maxCopiesPerMarket
  - Risk warnings

## Dashboard Integration

### Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/screener` | GET | Screener main page |
| `/screener/run` | POST | Trigger manual screening |
| `/screener/results` | GET | Get latest results (HTMX partial) |
| `/screener/add-wallet` | POST | Add recommended wallet to copy trading |
| `/screener/schedule` | POST | Configure scheduled screening |

### UI

- Screening progress bar with HTMX polling
- Result cards showing: score, recommendation, reasoning, strategy, risk warnings
- "Add to Copy Trading" button per wallet (writes to copy-trading.json, triggers hot reload)
- Schedule config: daily/disabled
- Results persisted to screener-results.json

## Integration Points

- Extends existing GraphClient with leaderboard/profile endpoints
- "Add to Copy Trading" writes directly to copy-trading.json wallets array
- Triggers CopyTradingStrategy.updateConfig() for hot reload
- Scheduler runs independently from main bot loop (like ArchiveService)
- Nav bar gets new "Smart Screener" entry

## Parallel Agent Development Plan

This feature will be built using parallel sub-agents:

1. **Agent 1: Data Layer** — data-fetcher.ts + types.ts + GraphClient extensions
2. **Agent 2: Scoring Engine** — scoring-engine.ts
3. **Agent 3: LLM Analyzer** — llm-analyzer.ts (Claude API integration)
4. **Agent 4: Dashboard UI** — routes + views + screener page
5. **Integration** — ScreenerService orchestration + bot.ts wiring + scheduling

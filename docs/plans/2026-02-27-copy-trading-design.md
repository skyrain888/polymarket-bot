# Copy Trading Feature Design
Date: 2026-02-27

## Overview

Add copy trading functionality to polymarket-bot: monitor target on-chain wallet addresses via The Graph GraphQL subgraph, and automatically replicate their Polymarket trades with configurable sizing and risk controls.

## Requirements

- **Data source:** The Graph / Polymarket OrderBook subgraph (GraphQL)
- **Sizing modes:** Fixed amount per trade, or proportional to the copied wallet's position size
- **Risk controls:** Existing RiskManager checks + copy-trading-specific limits (per-wallet daily trade count, per-wallet exposure cap, total copy exposure cap)
- **Integration:** Implemented as a `CopyTradingStrategy` that satisfies the existing `Strategy` interface, fully reusing the strategy engine, order manager, notifier, and dashboard

## Architecture

### New Files

```
src/
├── strategies/
│   └── copy-trading/
│       ├── index.ts          # CopyTradingStrategy (implements Strategy)
│       ├── graph-client.ts   # The Graph GraphQL query wrapper
│       └── types.ts          # CopiedTrade, WalletConfig types
```

### Modified Files

- `src/config/types.ts` — add `CopyTradingConfig`
- `src/config/index.ts` — parse copy trading env vars
- `src/bot.ts` — instantiate and register CopyTradingStrategy
- `src/infrastructure/dashboard/server.ts` — add `/copy-trading` route
- `.env.example` — document new env vars

### Data Flow

```
tick() → StrategyEngine.run(market, signals)
  → CopyTradingStrategy.evaluate()         # ignores market/signals params
    → GraphClient.getRecentTrades(wallet)  # query subgraph for each wallet
    → filter by lastSeenTxHash             # deduplicate
    → calculate size by sizeMode           # fixed or proportional
    → check dailyTradeCount limit          # copy-specific risk
    → check walletExposure limit           # copy-specific risk
    → return TradeIntent[]
  → RiskManager.check()                    # existing risk check
  → OrderManager.execute()                 # existing order execution
```

## Configuration

New `.env` variables:

```bash
# Master switch
COPY_TRADING_ENABLED=true

# Wallet list (JSON array)
COPY_WALLETS='[
  {"address":"0xABC...","label":"Smart Wallet 1","sizeMode":"fixed","fixedAmount":50},
  {"address":"0xDEF...","label":"Smart Wallet 2","sizeMode":"proportional","proportionPct":0.3}
]'

# Copy-trading-specific risk limits
COPY_MAX_DAILY_TRADES=10       # per wallet, resets at midnight
COPY_MAX_WALLET_EXPOSURE=500   # USDC, per wallet
COPY_MAX_TOTAL_EXPOSURE=2000   # USDC, across all copy trades
```

## Data Models

```typescript
interface WalletConfig {
  address: string
  label: string
  sizeMode: 'fixed' | 'proportional'
  fixedAmount?: number      // used when sizeMode === 'fixed'
  proportionPct?: number    // used when sizeMode === 'proportional'
}

interface CopiedTrade {
  walletAddress: string
  marketId: string
  tokenId: string
  side: 'buy' | 'sell'
  size: number
  price: number
  txHash: string
  timestamp: number
}

interface CopyTradingConfig {
  enabled: boolean
  wallets: WalletConfig[]
  maxDailyTradesPerWallet: number
  maxWalletExposure: number
  maxTotalExposure: number
}
```

## State Tracking (in-memory)

- `lastSeenTxHash: Map<walletAddress, string>` — tracks last processed tx per wallet to avoid duplicate trades
- `dailyTradeCount: Map<walletAddress, number>` — resets at midnight UTC
- `walletExposure: Map<walletAddress, number>` — running total of USDC deployed per wallet

## The Graph Query

**Endpoint:** `https://api.thegraph.com/subgraphs/name/polymarket/polymarket-orderbook-v2`

```graphql
query GetRecentTrades($wallet: String!, $since: Int!) {
  orderFilledEvents(
    where: { maker: $wallet, timestamp_gt: $since }
    orderBy: timestamp
    orderDirection: desc
    first: 10
  ) {
    id
    market { id }
    outcomeTokens { id }
    side
    size
    price
    timestamp
    transactionHash
  }
}
```

## Dashboard

New page `/copy-trading`:
- **Wallet table:** address (truncated), label, sizeMode, today's trade count, current exposure
- **Recent trades table:** timestamp, source wallet label, market ID, side, size, price, status

Navigation link added to `views.ts` layout.

## Risk Control Logic

Per trade, in order:
1. Check `dailyTradeCount[wallet] < maxDailyTradesPerWallet`
2. Check `walletExposure[wallet] + tradeSize < maxWalletExposure`
3. Check `totalCopyExposure + tradeSize < maxTotalExposure`
4. Pass to existing `RiskManager.check()` (position pct, daily loss, circuit breaker)

If any check fails, the trade is rejected and logged with reason.

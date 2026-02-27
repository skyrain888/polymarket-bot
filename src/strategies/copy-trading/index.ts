import type { Strategy, TradeIntent } from '../base.strategy.ts'
import type { Market } from '../../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../signals/aggregator.ts'
import type { CopyTradingConfig } from '../../config/types.ts'
import type { CopiedTrade } from './types.ts'
import { GraphClient } from './graph-client.ts'
import type { RawTrade, MarketStatus } from './graph-client.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

const COPIES_PATH = './data/copy-trades.json'

export class CopyTradingStrategy implements Strategy {
  readonly id = 'copy-trading'
  readonly name = 'Copy Trading'

  private graphClient: GraphClient
  private lastSeenTxHash = new Map<string, string>()
  private lastSeenTimestamp = new Map<string, number>()
  private initialised = new Set<string>()
  private copiedWalletMarkets = new Map<string, number>() // "wallet:marketId" → copy count
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
    this.loadCopies()
  }

  get enabled() { return this.config.enabled }
  getWeight() { return 0 }

  getConfig(): CopyTradingConfig { return this.config }

  updateConfig(newConfig: CopyTradingConfig) {
    this.config = newConfig
    this.lastSeenTxHash.clear()
    this.lastSeenTimestamp.clear()
    this.initialised.clear()
    this.copiedWalletMarkets.clear()
    this.dailyTradeCount.clear()
    this.walletExposure.clear()
    this.totalExposure = 0
    this.lastResetDay = new Date().toDateString()
  }

  getRecentCopies(limit = 50): CopiedTrade[] {
    return this.recentCopies.slice(-limit)
  }

  async getRecentCopiesWithPnl(limit = 50): Promise<{ copies: (CopiedTrade & { currentPrice: number; pnl: number; marketStatus?: MarketStatus })[]; totalPnl: number }> {
    const copies = this.getRecentCopies(limit)
    if (copies.length === 0) return { copies: [], totalPnl: 0 }

    const tokenIds = [...new Set(copies.map(c => c.tokenId))]
    const marketIds = [...new Set(copies.map(c => c.marketId))]
    const [priceMap, statusMap] = await Promise.all([
      this.graphClient.getTokenPrices(tokenIds),
      this.graphClient.getMarketStatuses(marketIds),
    ])

    // Override midpoint prices with resolved prices for settled markets
    for (const [, status] of statusMap) {
      if (status.closed && status.resolvedPrices.size > 0) {
        for (const [tokenId, resolvedPrice] of status.resolvedPrices) {
          priceMap.set(tokenId, resolvedPrice)
        }
      }
    }

    let totalPnl = 0
    const enriched = copies.map(cp => {
      const currentPrice = priceMap.get(cp.tokenId) ?? 0
      const pnl = cp.price > 0
        ? cp.side === 'buy'
          ? (currentPrice - cp.price) * cp.copiedSize / cp.price
          : (cp.price - currentPrice) * cp.copiedSize / cp.price
        : 0
      totalPnl += pnl
      return { ...cp, currentPrice, pnl, marketStatus: statusMap.get(cp.marketId) }
    })

    return { copies: enriched, totalPnl }
  }

  private loadCopies() {
    if (!existsSync(COPIES_PATH)) return
    try {
      const raw = readFileSync(COPIES_PATH, 'utf-8')
      const arr = JSON.parse(raw) as CopiedTrade[]
      this.recentCopies = arr.slice(-200)
      console.log(`[CopyTrading] Loaded ${this.recentCopies.length} historical copies from disk`)
    } catch {
      console.error('[CopyTrading] Failed to load copy trades from disk')
    }
  }

  private saveCopies() {
    try {
      const dir = dirname(COPIES_PATH)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(COPIES_PATH, JSON.stringify(this.recentCopies, null, 2), 'utf-8')
    } catch (err) {
      console.error('[CopyTrading] Failed to save copy trades to disk:', err)
    }
  }

  private resetDailyCountersIfNeeded() {
    const today = new Date().toDateString()
    if (today !== this.lastResetDay) {
      this.dailyTradeCount.clear()
      this.walletExposure.clear()
      this.copiedWalletMarkets.clear()
      this.totalExposure = 0
      this.lastResetDay = today
    }
  }

  async evaluate(market: Market, _signals: SignalBundle): Promise<TradeIntent | null> {
    if (!this.config.enabled) {
      console.log('[CopyTrading] Strategy disabled, skipping')
      return null
    }
    if (this.config.wallets.length === 0) {
      console.log('[CopyTrading] No wallets configured, skipping')
      return null
    }

    console.log(`[CopyTrading] Evaluating for market ${market.id?.slice(0, 12) ?? 'unknown'}... (${this.config.wallets.length} wallets)`)
    this.resetDailyCountersIfNeeded()

    for (const wallet of this.config.wallets) {
      const dailyCount = this.dailyTradeCount.get(wallet.address) ?? 0
      if (dailyCount >= this.config.maxDailyTradesPerWallet) {
        console.log(`[CopyTrading] ${wallet.label}: daily limit reached (${dailyCount}/${this.config.maxDailyTradesPerWallet}), skipping`)
        continue
      }

      const walletExp = this.walletExposure.get(wallet.address) ?? 0

      const since = this.lastSeenTimestamp.get(wallet.address) ?? Math.floor(Date.now() / 1000)
      let rawTrades: RawTrade[]
      try {
        rawTrades = await this.graphClient.getRecentTrades(wallet.address, since)
      } catch (err) {
        console.error(`[CopyTrading] API query failed for ${wallet.label}:`, err)
        continue
      }

      // First poll for this wallet: just seed the watermark, don't copy anything
      if (!this.initialised.has(wallet.address)) {
        this.initialised.add(wallet.address)
        if (rawTrades.length > 0) {
          const latest = rawTrades[rawTrades.length - 1]
          this.lastSeenTxHash.set(wallet.address, latest.txHash)
          this.lastSeenTimestamp.set(wallet.address, latest.timestamp)
        } else {
          this.lastSeenTimestamp.set(wallet.address, Math.floor(Date.now() / 1000))
        }
        console.log(`[CopyTrading] ${wallet.label}: initialized watermark, skipping ${rawTrades.length} existing trades`)
        continue
      }

      for (const raw of rawTrades) {
        const seen = this.lastSeenTxHash.get(wallet.address)
        if (seen === raw.txHash) continue
        if (this.recentCopies.some(c => c.txHash === raw.txHash)) {
          continue
        }

        // Same wallet + same market: limit copies per config
        const walletMarketKey = `${wallet.address}:${raw.marketId}`
        const marketCopyCount = this.copiedWalletMarkets.get(walletMarketKey) ?? 0
        const maxPerMarket = wallet.maxCopiesPerMarket ?? 1
        if (marketCopyCount >= maxPerMarket) {
          console.log(`[CopyTrading] ${wallet.label}: market ${raw.marketId.slice(0, 12)}… reached copy limit (${marketCopyCount}/${maxPerMarket}), skipping`)
          continue
        }

        // Calculate copy size
        const copiedSize = wallet.sizeMode === 'fixed'
          ? (wallet.fixedAmount ?? 50)
          : raw.size * (wallet.proportionPct ?? 0.1)

        // Copy-specific risk checks
        if (walletExp + copiedSize > this.config.maxWalletExposureUsdc) {
          console.log(`[CopyTrading] ${wallet.label}: wallet exposure limit reached ($${walletExp.toFixed(2)} + $${copiedSize.toFixed(2)} > $${this.config.maxWalletExposureUsdc}), skipping`)
          continue
        }
        if (this.totalExposure + copiedSize > this.config.maxTotalExposureUsdc) {
          console.log(`[CopyTrading] ${wallet.label}: total exposure limit reached ($${this.totalExposure.toFixed(2)} + $${copiedSize.toFixed(2)} > $${this.config.maxTotalExposureUsdc}), skipping`)
          continue
        }

        // Fetch tracked wallet's positions for enrichment
        let walletPortfolioValue = 0
        let walletPositionSize = 0
        let walletPositionValue = 0
        let tradeToAccountPct = 0
        try {
          const posResult = await this.graphClient.getWalletPositions(wallet.address)
          walletPortfolioValue = posResult.totalPortfolioValue
          const marketPosition = posResult.positions.find(p => p.conditionId === raw.marketId)
          if (marketPosition) {
            walletPositionSize = marketPosition.size
            walletPositionValue = marketPosition.currentValue
          }
          tradeToAccountPct = walletPortfolioValue > 0
            ? (raw.size / walletPortfolioValue) * 100
            : 0
        } catch (err) {
          console.error(`[CopyTrading] Failed to fetch positions for ${wallet.label}:`, err)
        }

        // Update state
        this.lastSeenTxHash.set(wallet.address, raw.txHash)
        this.lastSeenTimestamp.set(wallet.address, raw.timestamp)
        this.copiedWalletMarkets.set(walletMarketKey, marketCopyCount + 1)
        this.dailyTradeCount.set(wallet.address, dailyCount + 1)
        this.walletExposure.set(wallet.address, walletExp + copiedSize)
        this.totalExposure += copiedSize

        const copy: CopiedTrade = {
          walletAddress: wallet.address,
          label: wallet.label,
          marketId: raw.marketId,
          title: raw.title,
          outcome: raw.outcome,
          tokenId: raw.tokenId,
          side: raw.side,
          originalSize: raw.size,
          copiedSize,
          price: raw.price,
          txHash: raw.txHash,
          timestamp: raw.timestamp,
          walletPortfolioValue,
          walletPositionSize,
          walletPositionValue,
          tradeToAccountPct,
        }
        this.recentCopies.push(copy)
        if (this.recentCopies.length > 200) this.recentCopies.shift()
        this.saveCopies()

        console.log(`[CopyTrading] Copied ${wallet.label}: ${raw.side.toUpperCase()} $${copiedSize.toFixed(2)} @ ${raw.price} (tx: ${raw.txHash.slice(0, 10)}...)`)

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

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

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

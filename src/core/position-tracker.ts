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
    for (const [, pos] of this.cache) {
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

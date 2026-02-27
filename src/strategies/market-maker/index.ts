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

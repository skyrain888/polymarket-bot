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

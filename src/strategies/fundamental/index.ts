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

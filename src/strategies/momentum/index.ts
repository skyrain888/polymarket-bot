import type { Strategy, TradeIntent } from '../base.strategy.ts'
import type { Market } from '../../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../signals/aggregator.ts'

interface MomConfig {
  enabled: boolean
  weight: number
  threshold: number
  maxOrderSize: number
}

export class MomentumStrategy implements Strategy {
  id = 'momentum'
  name = 'Momentum'

  constructor(private config: MomConfig, private balance: number) {}

  get enabled() { return this.config.enabled }
  getWeight() { return this.config.weight }

  async evaluate(market: Market, signals: SignalBundle): Promise<TradeIntent | null> {
    const { momentum, liquidityScore } = signals.quant
    if (Math.abs(momentum) < this.config.threshold) return null
    if (liquidityScore < 0.3) return null

    const llmAligned = !signals.llm || (momentum > 0 && signals.llm.sentiment === 'bullish') || (momentum < 0 && signals.llm.sentiment === 'bearish')
    if (!llmAligned) return null

    const side = momentum > 0 ? 'buy' : 'sell'
    const size = Math.min(this.config.maxOrderSize, this.balance * this.config.weight * Math.abs(momentum) * 0.5)

    return {
      strategyId: this.id,
      marketId: market.id,
      tokenId: `${market.conditionId}-YES`,
      side,
      size,
      price: market.yesPrice,
      reasoning: `Momentum: ${(momentum * 100).toFixed(0)}% signal, ${signals.llm?.sentiment ?? 'no'} LLM alignment`,
    }
  }
}

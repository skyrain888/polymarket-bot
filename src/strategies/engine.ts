import type { Strategy, TradeIntent } from './base.strategy.ts'
import type { Market } from '../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../signals/aggregator.ts'

export class StrategyEngine {
  constructor(private strategies: Strategy[]) {}

  async run(market: Market, signals: SignalBundle): Promise<TradeIntent[]> {
    const results: TradeIntent[] = []

    const enabled = this.strategies.filter(s => s.enabled)
    const intents = await Promise.allSettled(enabled.map(s => s.evaluate(market, signals)))

    for (const result of intents) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value)
      } else if (result.status === 'rejected') {
        console.error(`Strategy error:`, result.reason)
      }
    }

    return results
  }

  getStrategies(): Strategy[] {
    return this.strategies
  }
}

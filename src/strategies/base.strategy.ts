import type { Market } from '../infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../signals/aggregator.ts'

export interface TradeIntent {
  strategyId: string
  marketId: string
  tokenId: string
  side: 'buy' | 'sell'
  size: number
  price: number
  reasoning: string
}

export interface Strategy {
  id: string
  name: string
  enabled: boolean
  evaluate(market: Market, signals: SignalBundle): Promise<TradeIntent | null>
  getWeight(): number
}

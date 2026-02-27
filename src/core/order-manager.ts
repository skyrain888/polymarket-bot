import type { PolymarketClient } from '../infrastructure/polymarket/client.ts'
import type { OrderRepository } from '../infrastructure/storage/repositories.ts'
import type { EventBus } from './event-bus.ts'

export interface ExecuteIntent {
  strategyId: string
  marketId: string
  tokenId: string
  side: 'buy' | 'sell'
  size: number
  price: number
}

export class OrderManager {
  constructor(
    private client: PolymarketClient,
    private repo: OrderRepository,
    private bus: EventBus,
  ) {}

  async execute(intent: ExecuteIntent): Promise<void> {
    try {
      const result = await this.client.placeOrder({
        marketId: intent.marketId,
        tokenId: intent.tokenId,
        side: intent.side,
        size: intent.size,
        price: intent.price,
      })

      this.repo.insert({
        strategyId: intent.strategyId,
        marketId: intent.marketId,
        side: intent.side,
        size: intent.size,
        price: intent.price,
        status: result.status,
        reason: null,
      })

      this.bus.emit('trade:executed', {
        orderId: result.orderId,
        marketId: intent.marketId,
        side: intent.side,
        size: intent.size,
        price: intent.price,
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      this.repo.insert({
        strategyId: intent.strategyId,
        marketId: intent.marketId,
        side: intent.side,
        size: intent.size,
        price: intent.price,
        status: 'error',
        reason,
      })
      this.bus.emit('trade:rejected', { reason, strategyId: intent.strategyId, marketId: intent.marketId })
    }
  }

  reject(intent: Omit<ExecuteIntent, 'tokenId'>, reason: string): void {
    this.repo.insert({
      strategyId: intent.strategyId,
      marketId: intent.marketId,
      side: intent.side,
      size: intent.size,
      price: intent.price,
      status: 'rejected',
      reason,
    })
    this.bus.emit('trade:rejected', { reason, strategyId: intent.strategyId, marketId: intent.marketId })
  }
}

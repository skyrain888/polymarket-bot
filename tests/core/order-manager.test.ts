import { describe, test, expect, mock } from 'bun:test'
import { OrderManager } from '../../src/core/order-manager.ts'
import { EventBus } from '../../src/core/event-bus.ts'
import { createDb } from '../../src/infrastructure/storage/db.ts'
import { OrderRepository } from '../../src/infrastructure/storage/repositories.ts'

describe('OrderManager', () => {
  function makeManager() {
    const db = createDb(':memory:')
    const repo = new OrderRepository(db)
    const bus = new EventBus()
    const mockClient = { placeOrder: mock(async () => ({ orderId: 'ord-1', status: 'simulated', marketId: 'm1', side: 'buy', size: 10, price: 0.5 })) }
    return { manager: new OrderManager(mockClient as any, repo, bus), bus, mockClient }
  }

  test('executes order and emits trade:executed', async () => {
    const { manager, bus } = makeManager()
    const executed = mock(() => {})
    bus.on('trade:executed', executed)

    await manager.execute({ strategyId: 's1', marketId: 'm1', tokenId: 't1', side: 'buy', size: 10, price: 0.5 })
    expect(executed).toHaveBeenCalled()
  })

  test('persists order to repository', async () => {
    const db = createDb(':memory:')
    const repo = new OrderRepository(db)
    const bus = new EventBus()
    const mockClient = { placeOrder: mock(async () => ({ orderId: 'ord-1', status: 'filled', marketId: 'm1', side: 'buy', size: 10, price: 0.5 })) }
    const manager = new OrderManager(mockClient as any, repo, bus)

    await manager.execute({ strategyId: 's1', marketId: 'm1', tokenId: 't1', side: 'buy', size: 10, price: 0.5 })
    const orders = repo.findByStrategy('s1')
    expect(orders).toHaveLength(1)
    expect(orders[0].status).toBe('filled')
  })
})

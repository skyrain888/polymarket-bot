import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { createDb } from '../../src/infrastructure/storage/db.ts'
import { OrderRepository } from '../../src/infrastructure/storage/repositories.ts'

describe('OrderRepository', () => {
  let db: ReturnType<typeof createDb>
  let repo: OrderRepository

  beforeEach(() => {
    db = createDb(':memory:')
    repo = new OrderRepository(db)
  })

  test('inserts and retrieves orders', () => {
    const id = repo.insert({
      strategyId: 'momentum',
      marketId: 'market-1',
      side: 'buy',
      size: 10,
      price: 0.55,
      status: 'filled',
      reason: null,
    })
    const order = repo.findById(id)
    expect(order?.marketId).toBe('market-1')
    expect(order?.price).toBe(0.55)
  })

  test('lists orders by strategy', () => {
    repo.insert({ strategyId: 'arb', marketId: 'm1', side: 'buy', size: 5, price: 0.4, status: 'filled', reason: null })
    repo.insert({ strategyId: 'arb', marketId: 'm2', side: 'sell', size: 5, price: 0.6, status: 'filled', reason: null })
    repo.insert({ strategyId: 'mm', marketId: 'm3', side: 'buy', size: 5, price: 0.5, status: 'filled', reason: null })
    const arbOrders = repo.findByStrategy('arb')
    expect(arbOrders).toHaveLength(2)
  })
})

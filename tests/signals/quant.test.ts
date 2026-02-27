import { describe, test, expect } from 'bun:test'
import { QuantEngine } from '../../src/signals/quant/engine.ts'
import type { OrderBook } from '../../src/infrastructure/polymarket/types.ts'

describe('QuantEngine', () => {
  const engine = new QuantEngine()

  test('computes momentum from price history', () => {
    const prices = [0.40, 0.42, 0.45, 0.47, 0.50]
    const momentum = engine.computeMomentum(prices)
    expect(momentum).toBeGreaterThan(0)
  })

  test('momentum is negative when prices falling', () => {
    const prices = [0.60, 0.55, 0.50, 0.45, 0.40]
    const momentum = engine.computeMomentum(prices)
    expect(momentum).toBeLessThan(0)
  })

  test('computes spread from order book', () => {
    const book: OrderBook = {
      bids: [{ price: 0.48, size: 100 }],
      asks: [{ price: 0.52, size: 100 }],
    }
    const spread = engine.computeSpread(book)
    expect(spread).toBeCloseTo(0.04)
  })

  test('computes liquidity score', () => {
    const book: OrderBook = {
      bids: [{ price: 0.49, size: 500 }, { price: 0.48, size: 300 }],
      asks: [{ price: 0.51, size: 500 }, { price: 0.52, size: 300 }],
    }
    const score = engine.computeLiquidityScore(book)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })
})

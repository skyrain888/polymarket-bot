import { describe, test, expect } from 'bun:test'
import { PositionTracker } from '../../src/core/position-tracker.ts'
import { createDb } from '../../src/infrastructure/storage/db.ts'
import { PositionRepository } from '../../src/infrastructure/storage/repositories.ts'

describe('PositionTracker', () => {
  function makeTracker() {
    const db = createDb(':memory:')
    const repo = new PositionRepository(db)
    return new PositionTracker(repo)
  }

  test('records buy and tracks position', () => {
    const tracker = makeTracker()
    tracker.recordFill({ strategyId: 's1', marketId: 'm1', side: 'buy', size: 100, price: 0.50 })
    const pos = tracker.getPosition('m1', 's1')
    expect(pos?.size).toBe(100)
    expect(pos?.avgPrice).toBeCloseTo(0.50)
  })

  test('averages down on second buy', () => {
    const tracker = makeTracker()
    tracker.recordFill({ strategyId: 's1', marketId: 'm1', side: 'buy', size: 100, price: 0.40 })
    tracker.recordFill({ strategyId: 's1', marketId: 'm1', side: 'buy', size: 100, price: 0.60 })
    const pos = tracker.getPosition('m1', 's1')
    expect(pos?.avgPrice).toBeCloseTo(0.50)
    expect(pos?.size).toBe(200)
  })

  test('getTotalExposure returns total position value', () => {
    const tracker = makeTracker()
    tracker.recordFill({ strategyId: 's1', marketId: 'm1', side: 'buy', size: 100, price: 0.50 })
    tracker.recordFill({ strategyId: 's2', marketId: 'm2', side: 'buy', size: 200, price: 0.30 })
    expect(tracker.getTotalExposure()).toBeCloseTo(50 + 60)
  })
})

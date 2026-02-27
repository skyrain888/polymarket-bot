import { describe, test, expect } from 'bun:test'
import { BacktestEngine } from '../../src/backtest/engine.ts'
import { MomentumStrategy } from '../../src/strategies/momentum/index.ts'

describe('BacktestEngine', () => {
  test('runs through historical ticks', async () => {
    const strategy = new MomentumStrategy({ enabled: true, weight: 1, threshold: 0.3, maxOrderSize: 50 }, 1000)
    const engine = new BacktestEngine([strategy], { initialBalance: 1000 })

    const ticks = [
      { marketId: 'm1', yesPrice: 0.40, volume24h: 50000, timestamp: new Date('2026-01-01') },
      { marketId: 'm1', yesPrice: 0.45, volume24h: 55000, timestamp: new Date('2026-01-02') },
      { marketId: 'm1', yesPrice: 0.52, volume24h: 60000, timestamp: new Date('2026-01-03') },
      { marketId: 'm1', yesPrice: 0.58, volume24h: 65000, timestamp: new Date('2026-01-04') },
    ]

    const report = await engine.run(ticks)
    expect(report.totalTrades).toBeGreaterThanOrEqual(0)
    expect(report.finalBalance).toBeGreaterThan(0)
    expect(report.sharpeRatio).toBeDefined()
  })
})

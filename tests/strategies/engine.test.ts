import { describe, test, expect, mock } from 'bun:test'
import { StrategyEngine } from '../../src/strategies/engine.ts'
import type { Strategy } from '../../src/strategies/base.strategy.ts'
import type { Market } from '../../src/infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../src/signals/aggregator.ts'

describe('StrategyEngine', () => {
  const market: Market = { id: 'm1', conditionId: 'c1', question: 'Q?', category: 'politics', endDate: '2026-12-31', yesPrice: 0.55, noPrice: 0.45, volume24h: 50000, liquidity: 10000, active: true }
  const signals: SignalBundle = { marketId: 'm1', timestamp: new Date(), quant: { momentum: 0.5, priceDeviation: 0.1, liquidityScore: 0.8, spread: 0.04, volumeScore: 0.5 }, llm: null }

  test('runs enabled strategies', async () => {
    const mockStrategy: Strategy = {
      id: 'test', name: 'Test', enabled: true,
      evaluate: mock(async () => null),
      getWeight: () => 1.0,
    }
    const engine = new StrategyEngine([mockStrategy])
    await engine.run(market, signals)
    expect(mockStrategy.evaluate).toHaveBeenCalled()
  })

  test('skips disabled strategies', async () => {
    const mockStrategy: Strategy = {
      id: 'test', name: 'Test', enabled: false,
      evaluate: mock(async () => null),
      getWeight: () => 1.0,
    }
    const engine = new StrategyEngine([mockStrategy])
    await engine.run(market, signals)
    expect(mockStrategy.evaluate).not.toHaveBeenCalled()
  })
})

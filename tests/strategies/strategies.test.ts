import { describe, test, expect } from 'bun:test'
import { MarketMakerStrategy } from '../../src/strategies/market-maker/index.ts'
import { MomentumStrategy } from '../../src/strategies/momentum/index.ts'
import { FundamentalStrategy } from '../../src/strategies/fundamental/index.ts'
import type { Market } from '../../src/infrastructure/polymarket/types.ts'
import type { SignalBundle } from '../../src/signals/aggregator.ts'

const baseMarket: Market = { id: 'm1', conditionId: 'c1', question: 'Q?', category: 'politics', endDate: '2026-12-31', yesPrice: 0.55, noPrice: 0.45, volume24h: 50000, liquidity: 10000, active: true }
const baseSignals: SignalBundle = { marketId: 'm1', timestamp: new Date(), quant: { momentum: 0, priceDeviation: 0.1, liquidityScore: 0.8, spread: 0.04, volumeScore: 0.5 }, llm: null }

describe('MarketMakerStrategy', () => {
  test('returns null when spread too tight', async () => {
    const s = new MarketMakerStrategy({ enabled: true, weight: 1, maxOrderSize: 100, minSpread: 0.05 }, 1000)
    // spread = 0.04 < minSpread 0.05
    const intent = await s.evaluate(baseMarket, baseSignals)
    expect(intent).toBeNull()
  })

  test('returns intent when spread is wide enough', async () => {
    const signals = { ...baseSignals, quant: { ...baseSignals.quant, spread: 0.10 } }
    const s = new MarketMakerStrategy({ enabled: true, weight: 1, maxOrderSize: 100, minSpread: 0.05 }, 1000)
    const intent = await s.evaluate(baseMarket, signals)
    expect(intent).not.toBeNull()
    expect(intent?.side).toBe('buy') // Buy at bid
  })
})

describe('MomentumStrategy', () => {
  test('returns null on flat momentum', async () => {
    const s = new MomentumStrategy({ enabled: true, weight: 1, threshold: 0.3, maxOrderSize: 100 }, 1000)
    const intent = await s.evaluate(baseMarket, baseSignals)
    expect(intent).toBeNull()
  })

  test('returns buy on strong bullish momentum', async () => {
    const signals = { ...baseSignals, quant: { ...baseSignals.quant, momentum: 0.8 }, llm: { sentiment: 'bullish' as const, confidence: 0.7, estimatedProbability: 0.65, summary: '', reasoning: '' } }
    const s = new MomentumStrategy({ enabled: true, weight: 1, threshold: 0.3, maxOrderSize: 100 }, 1000)
    const intent = await s.evaluate(baseMarket, signals)
    expect(intent?.side).toBe('buy')
  })
})

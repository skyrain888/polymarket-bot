import { describe, test, expect } from 'bun:test'
import { RiskManager } from '../../src/core/risk-manager.ts'

const defaultRisk = {
  maxPositionPct: 0.20,
  maxTotalExposurePct: 0.60,
  maxDailyLossPct: 0.05,
  maxConsecutiveLosses: 3,
  cooldownMinutes: 60,
  maxVolumeImpactPct: 0.05,
  maxSlippagePct: 0.02,
}

describe('RiskManager', () => {
  test('allows trade within limits', () => {
    const rm = new RiskManager(defaultRisk, 10000)
    const result = rm.check({ strategyId: 's1', size: 100, price: 0.5, volume24h: 10000, currentExposure: 0, strategyExposure: 0 })
    expect(result.allowed).toBe(true)
  })

  test('blocks trade exceeding total exposure', () => {
    const rm = new RiskManager(defaultRisk, 10000)
    const result = rm.check({ strategyId: 's1', size: 1000, price: 0.8, volume24h: 100000, currentExposure: 5300, strategyExposure: 0 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/exposure/i)
  })

  test('blocks trade from tripped circuit breaker', () => {
    const rm = new RiskManager(defaultRisk, 10000)
    rm.recordLoss('s1')
    rm.recordLoss('s1')
    rm.recordLoss('s1') // 3 losses = trip
    const result = rm.check({ strategyId: 's1', size: 10, price: 0.5, volume24h: 100000, currentExposure: 0, strategyExposure: 0 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/circuit/i)
  })

  test('blocks high volume impact', () => {
    const rm = new RiskManager(defaultRisk, 10000)
    // 200 * 0.5 = $100 in a $500 24h volume market = 20% impact
    const result = rm.check({ strategyId: 's1', size: 200, price: 0.5, volume24h: 500, currentExposure: 0, strategyExposure: 0 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/liquidity/i)
  })
})

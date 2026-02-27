import type { RiskConfig } from '../config/types.ts'

interface CheckInput {
  strategyId: string
  size: number
  price: number
  volume24h: number
  currentExposure: number    // total portfolio exposure in $
  strategyExposure: number   // this strategy's exposure in $
}

interface CheckResult {
  allowed: boolean
  reason?: string
  maxSize?: number
}

interface CircuitState {
  consecutiveLosses: number
  trippedAt: Date | null
  dailyLoss: number
}

export class RiskManager {
  private circuits = new Map<string, CircuitState>()

  constructor(private config: RiskConfig, private balance: number) {}

  updateBalance(balance: number): void {
    this.balance = balance
  }

  private getCircuit(strategyId: string): CircuitState {
    if (!this.circuits.has(strategyId)) {
      this.circuits.set(strategyId, { consecutiveLosses: 0, trippedAt: null, dailyLoss: 0 })
    }
    return this.circuits.get(strategyId)!
  }

  recordLoss(strategyId: string, amount = 0): void {
    const c = this.getCircuit(strategyId)
    c.consecutiveLosses++
    c.dailyLoss += amount
    if (c.consecutiveLosses >= this.config.maxConsecutiveLosses || c.dailyLoss >= this.balance * this.config.maxDailyLossPct) {
      c.trippedAt = new Date()
    }
  }

  recordWin(strategyId: string): void {
    const c = this.getCircuit(strategyId)
    c.consecutiveLosses = 0
  }

  isCircuitTripped(strategyId: string): boolean {
    const c = this.getCircuit(strategyId)
    if (!c.trippedAt) return false
    const cooldownMs = this.config.cooldownMinutes * 60 * 1000
    if (Date.now() - c.trippedAt.getTime() > cooldownMs) {
      c.trippedAt = null
      c.consecutiveLosses = 0
      c.dailyLoss = 0
      return false
    }
    return true
  }

  check(input: CheckInput): CheckResult {
    // Layer 1: Circuit breaker
    if (this.isCircuitTripped(input.strategyId)) {
      return { allowed: false, reason: `Circuit breaker active for strategy ${input.strategyId}` }
    }

    // Layer 2: Position limits
    const tradeValue = input.size * input.price
    const newTotalExposure = input.currentExposure + tradeValue
    if (newTotalExposure > this.balance * this.config.maxTotalExposurePct) {
      return { allowed: false, reason: `Total exposure limit reached (${(this.config.maxTotalExposurePct * 100).toFixed(0)}% of balance)` }
    }

    const newStrategyExposure = input.strategyExposure + tradeValue
    if (newStrategyExposure > this.balance * this.config.maxPositionPct) {
      return { allowed: false, reason: `Strategy exposure limit reached (${(this.config.maxPositionPct * 100).toFixed(0)}% of balance)` }
    }

    // Layer 3: Liquidity / volume impact
    if (input.volume24h > 0) {
      const impact = tradeValue / input.volume24h
      if (impact > this.config.maxVolumeImpactPct) {
        return { allowed: false, reason: `Liquidity impact too high: ${(impact * 100).toFixed(1)}% of 24h volume` }
      }
    }

    return { allowed: true }
  }

  computeMaxSize(price: number, strategyId: string, currentExposure: number, strategyExposure: number): number {
    const byTotal = Math.max(0, this.balance * this.config.maxTotalExposurePct - currentExposure) / price
    const byStrategy = Math.max(0, this.balance * this.config.maxPositionPct - strategyExposure) / price
    return Math.min(byTotal, byStrategy)
  }
}

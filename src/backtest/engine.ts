import type { Strategy } from '../strategies/base.strategy.ts'
import type { Market } from '../infrastructure/polymarket/types.ts'
import { QuantEngine } from '../signals/quant/engine.ts'
import { SignalAggregator } from '../signals/aggregator.ts'
import { StrategyEngine } from '../strategies/engine.ts'

export interface HistoricalTick {
  marketId: string
  yesPrice: number
  volume24h: number
  timestamp: Date
}

export interface BacktestReport {
  totalTrades: number
  winRate: number
  finalBalance: number
  totalReturn: number
  maxDrawdown: number
  sharpeRatio: number
  tradeLog: { timestamp: Date; strategyId: string; side: string; size: number; price: number; pnl: number }[]
}

export class BacktestEngine {
  private quant = new QuantEngine()
  private aggregator = new SignalAggregator()
  private strategyEngine: StrategyEngine

  constructor(strategies: Strategy[], private config: { initialBalance: number }) {
    this.strategyEngine = new StrategyEngine(strategies)
  }

  async run(ticks: HistoricalTick[]): Promise<BacktestReport> {
    let balance = this.config.initialBalance
    const priceHistory = new Map<string, number[]>()
    const tradeLog: BacktestReport['tradeLog'] = []
    const balanceHistory: number[] = [balance]
    let wins = 0

    for (const tick of ticks) {
      const history = priceHistory.get(tick.marketId) ?? []
      history.push(tick.yesPrice)
      if (history.length > 20) history.shift()
      priceHistory.set(tick.marketId, history)

      const book = { bids: [{ price: tick.yesPrice - 0.02, size: 1000 }], asks: [{ price: tick.yesPrice + 0.02, size: 1000 }] }
      const quantSignal = this.quant.compute(history, book, tick.volume24h)
      const bundle = this.aggregator.update(tick.marketId, quantSignal, null)

      const market: Market = { id: tick.marketId, conditionId: tick.marketId, question: '', category: '', endDate: '', yesPrice: tick.yesPrice, noPrice: 1 - tick.yesPrice, volume24h: tick.volume24h, liquidity: 10000, active: true }
      const intents = await this.strategyEngine.run(market, bundle)

      for (const intent of intents) {
        const cost = intent.size * intent.price
        if (cost > balance) continue
        balance -= cost
        // Simulate: resolve at next tick's price
        const nextPrice = ticks.find(t => t.marketId === intent.marketId && t.timestamp > tick.timestamp)?.yesPrice ?? intent.price
        const pnl = intent.side === 'buy' ? (nextPrice - intent.price) * intent.size : (intent.price - nextPrice) * intent.size
        balance += cost + pnl
        if (pnl > 0) wins++
        tradeLog.push({ timestamp: tick.timestamp, strategyId: intent.strategyId, side: intent.side, size: intent.size, price: intent.price, pnl })
        balanceHistory.push(balance)
      }
    }

    const totalTrades = tradeLog.length
    const winRate = totalTrades > 0 ? wins / totalTrades : 0
    const totalReturn = (balance - this.config.initialBalance) / this.config.initialBalance
    const maxDrawdown = this.computeMaxDrawdown(balanceHistory)
    const sharpeRatio = this.computeSharpe(balanceHistory)

    return { totalTrades, winRate, finalBalance: balance, totalReturn, maxDrawdown, sharpeRatio, tradeLog }
  }

  private computeMaxDrawdown(balances: number[]): number {
    let peak = balances[0] ?? 0
    let maxDD = 0
    for (const b of balances) {
      if (b > peak) peak = b
      const dd = peak > 0 ? (peak - b) / peak : 0
      if (dd > maxDD) maxDD = dd
    }
    return maxDD
  }

  private computeSharpe(balances: number[]): number {
    if (balances.length < 2) return 0
    const returns = balances.slice(1).map((b, i) => (b - (balances[i] ?? 0)) / (balances[i] ?? 1))
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
    const stddev = Math.sqrt(variance)
    return stddev === 0 ? 0 : mean / stddev * Math.sqrt(252)
  }
}

import type {
  TraderProfile,
  TraderTrade,
  DimensionScores,
  ScoredTrader,
} from './types'

const WEIGHTS = {
  returns: 0.35,
  activity: 0.25,
  portfolioSize: 0.20,
  diversification: 0.20,
} as const

const SECONDS_PER_DAY = 86_400

export class ScoringEngine {
  score(profiles: TraderProfile[]): ScoredTrader[] {
    return profiles
      .map((profile) => this.scoreTrader(profile))
      .sort((a, b) => b.totalScore - a.totalScore)
  }

  private scoreTrader(profile: TraderProfile): ScoredTrader {
    const scores: DimensionScores = {
      returns: this.scoreReturns(profile),
      activity: this.scoreActivity(profile.recentTrades),
      portfolioSize: this.scorePortfolioSize(profile),
      diversification: this.scoreDiversification(profile),
    }

    const totalScore =
      scores.returns * WEIGHTS.returns +
      scores.activity * WEIGHTS.activity +
      scores.portfolioSize * WEIGHTS.portfolioSize +
      scores.diversification * WEIGHTS.diversification

    return { profile, scores, totalScore: Math.round(totalScore * 100) / 100 }
  }

  // ---------- Returns (0-100) ----------

  private scoreReturns(profile: TraderProfile): number {
    const pnl = profile.entry.pnl
    const pnlScore = pnl > 0 ? Math.min(50, Math.log10(pnl + 1) * 12) : 0

    const winRateScore = this.computeWinRateScore(profile.recentTrades)

    return Math.min(100, pnlScore + winRateScore)
  }

  private computeWinRateScore(trades: TraderTrade[]): number {
    const buys = trades.filter((t) => t.side === 'buy')
    if (buys.length < 5) return 25

    const goodBuys = buys.filter((t) => t.price < 0.65).length
    const winRate = goodBuys / buys.length
    return winRate * 50
  }

  // ---------- Activity (0-100) ----------

  private scoreActivity(trades: TraderTrade[]): number {
    const tradeCountScore = Math.min(50, trades.length * 2)
    const recencyScore = this.computeRecencyScore(trades)

    return Math.min(100, tradeCountScore + recencyScore)
  }

  private computeRecencyScore(trades: TraderTrade[]): number {
    if (trades.length === 0) return 0

    const nowSeconds = Math.floor(Date.now() / 1000)
    const mostRecent = trades.reduce((max, t) => t.timestamp > max ? t.timestamp : max, 0)
    const daysSince = (nowSeconds - mostRecent) / SECONDS_PER_DAY

    if (daysSince < 1) return 50
    if (daysSince < 3) return 40
    if (daysSince < 7) return 25
    if (daysSince < 14) return 10
    return 0
  }

  // ---------- Portfolio Size (0-100) ----------

  private scorePortfolioSize(profile: TraderProfile): number {
    const value = profile.totalPortfolioValue
    const valueScore = Math.min(60, Math.log10(value + 1) * 15)

    const avgTradeSize = this.computeAvgTradeSize(profile.recentTrades)
    let tradeSizeScore: number
    if (avgTradeSize >= 10 && avgTradeSize <= 5000) {
      tradeSizeScore = 40
    } else if (avgTradeSize > 5000) {
      tradeSizeScore = 25
    } else {
      tradeSizeScore = 15
    }

    return Math.min(100, valueScore + tradeSizeScore)
  }

  private computeAvgTradeSize(trades: TraderTrade[]): number {
    if (trades.length === 0) return 0
    const totalSize = trades.reduce((sum, t) => sum + t.size, 0)
    return totalSize / trades.length
  }

  // ---------- Diversification (0-100) ----------

  private scoreDiversification(profile: TraderProfile): number {
    const positions = profile.positions
    if (positions.length === 0) return 0

    // Market count score: unique markets by conditionId
    const uniqueMarkets = new Set(positions.map((p) => p.conditionId)).size
    const marketCountScore = Math.min(50, uniqueMarkets * 8)

    // Concentration score
    const totalValue = profile.totalPortfolioValue
    if (totalValue <= 0) return marketCountScore

    // Aggregate value per market
    const marketValues = new Map<string, number>()
    for (const pos of positions) {
      const current = marketValues.get(pos.conditionId) ?? 0
      marketValues.set(pos.conditionId, current + pos.currentValue)
    }

    let maxMarketValue = 0
    for (const v of marketValues.values()) {
      if (v > maxMarketValue) maxMarketValue = v
    }
    const maxMarketPct = maxMarketValue / totalValue
    const concentrationScore = (1 - maxMarketPct) * 50

    return Math.min(100, marketCountScore + concentrationScore)
  }
}

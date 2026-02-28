import type {
  TraderProfile,
  TraderTrade,
  DimensionScores,
  ScoredTrader,
} from './types'
import { logger } from '../../../infrastructure/logger'

const WEIGHTS = {
  returns: 0.35,
  activity: 0.25,
  portfolioSize: 0.20,
  diversification: 0.20,
} as const

const SECONDS_PER_DAY = 86_400
const TAG = 'ScoringEngine'

export class ScoringEngine {
  score(profiles: TraderProfile[]): ScoredTrader[] {
    logger.info(TAG, `Scoring ${profiles.length} trader profiles`)
    const scored = profiles
      .map((profile) => this.scoreTrader(profile))
      .sort((a, b) => b.totalScore - a.totalScore)

    logger.debug(TAG, `Top 5 scores: ${scored.slice(0, 5).map(s => `${s.profile.entry.username || s.profile.entry.address.slice(0, 8)}=${s.totalScore}`).join(', ')}`)
    return scored
  }

  private scoreTrader(profile: TraderProfile): ScoredTrader {
    const scores: DimensionScores = {
      returns: this.scoreReturns(profile),
      activity: this.scoreActivity(profile),
      portfolioSize: this.scorePortfolioSize(profile),
      diversification: this.scoreDiversification(profile),
    }

    let totalScore =
      scores.returns * WEIGHTS.returns +
      scores.activity * WEIGHTS.activity +
      scores.portfolioSize * WEIGHTS.portfolioSize +
      scores.diversification * WEIGHTS.diversification

    // Penalty: no closed positions = no proven track record
    const closed = profile.closedPositions ?? []
    if (closed.length === 0) {
      totalScore *= 0.6
      logger.debug(TAG, `${profile.entry.username || profile.entry.address.slice(0, 10)}: no closed positions → 40% penalty applied`)
    }

    const rounded = Math.round(totalScore * 100) / 100

    logger.debug(TAG, `${profile.entry.username || profile.entry.address.slice(0, 10)}: returns=${scores.returns.toFixed(1)} activity=${scores.activity.toFixed(1)} portfolioSize=${scores.portfolioSize.toFixed(1)} diversification=${scores.diversification.toFixed(1)} → total=${rounded}${closed.length === 0 ? ' (penalized)' : ''}`)

    return { profile, scores, totalScore: rounded }
  }

  // ---------- Returns (0-100) ----------

  private scoreReturns(profile: TraderProfile): number {
    const pnl = profile.entry.pnl
    const pnlScore = pnl > 0 ? Math.min(50, Math.log10(pnl + 1) * 12) : 0

    const winRateScore = this.computeWinRateScore(profile)

    return Math.min(100, pnlScore + winRateScore)
  }

  private computeWinRateScore(profile: TraderProfile): number {
    const closed = profile.closedPositions ?? []
    // Use closed positions win rate if we have enough data
    if (closed.length >= 5) {
      const wins = closed.filter((p) => p.realizedPnl > 0).length
      const winRate = wins / closed.length
      return winRate * 50
    }
    // Fallback to buy price heuristic if insufficient closed positions
    const buys = profile.recentTrades.filter((t) => t.side === 'buy')
    if (buys.length < 5) return 25
    const goodBuys = buys.filter((t) => t.price < 0.65).length
    const winRate = goodBuys / buys.length
    return winRate * 50
  }

  // ---------- Activity (0-100) ----------

  private scoreActivity(profile: TraderProfile): number {
    const trades = profile.recentTrades
    const tradeCountScore = Math.min(50, trades.length * 2)
    const recencyScore = this.computeRecencyScore(trades)

    let score = Math.min(100, tradeCountScore + recencyScore)

    // Discount if all trades are buys (no exits = no proven cycle)
    const sells = trades.filter((t) => t.side === 'sell').length
    if (trades.length > 0 && sells === 0) {
      score *= 0.6
    }

    return score
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

    const uniqueMarkets = new Set(positions.map((p) => p.conditionId)).size
    const marketCountScore = Math.min(50, uniqueMarkets * 8)

    const totalValue = profile.totalPortfolioValue
    if (totalValue <= 0) return marketCountScore

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

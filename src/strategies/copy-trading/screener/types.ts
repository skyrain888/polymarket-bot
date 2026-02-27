export interface LeaderboardEntry {
  rank: number
  address: string
  username: string
  profileImage: string
  pnl: number
  volume: number
}

export interface TraderProfile {
  entry: LeaderboardEntry
  positions: TraderPosition[]
  recentTrades: TraderTrade[]
  totalPortfolioValue: number
}

export interface TraderPosition {
  conditionId: string
  title: string
  outcome: string
  size: number
  currentValue: number
}

export interface TraderTrade {
  marketId: string
  title: string
  outcome: string
  side: 'buy' | 'sell'
  size: number
  price: number
  timestamp: number
}

export interface DimensionScores {
  returns: number        // 0-100, weight 35%
  activity: number       // 0-100, weight 25%
  portfolioSize: number  // 0-100, weight 20%
  diversification: number // 0-100, weight 20%
}

export interface ScoredTrader {
  profile: TraderProfile
  scores: DimensionScores
  totalScore: number
}

export interface LLMRecommendation {
  level: 'recommended' | 'cautious' | 'not_recommended'
  reasoning: string
  suggestedSizeMode: 'fixed' | 'proportional'
  suggestedAmount: number       // USDC if fixed, pct 0-1 if proportional
  suggestedMaxCopiesPerMarket: number
  riskWarning: string
}

export interface ScreenerResult {
  address: string
  username: string
  profileImage: string
  rank: number
  pnl: number
  volume: number
  totalPortfolioValue: number
  scores: DimensionScores
  totalScore: number
  recommendation: LLMRecommendation
  screenedAt: number  // unix timestamp seconds
}

export interface ScreenerConfig {
  enabled: boolean
  scheduleCron: 'daily' | 'disabled'
  lastRunAt: number | null
}

export type ScreenerStatus = 'idle' | 'running' | 'done' | 'error'

export interface ScreenerState {
  status: ScreenerStatus
  progress: number       // 0-100
  progressLabel: string
  results: ScreenerResult[]
  lastError: string | null
}

export interface LeaderboardEntry {
  rank: number
  address: string
  username: string
  profileImage: string
  pnl: number
  volume: number
}

export interface ClosedPosition {
  conditionId: string
  title: string
  outcome: string
  avgPrice: number       // average buy price
  totalBought: number    // total USDC invested
  realizedPnl: number    // realized profit/loss in USDC
  curPrice: number       // settlement price (1 = win, 0 = loss)
  timestamp: number      // unix timestamp when position was closed
}

export interface TraderProfile {
  entry: LeaderboardEntry
  positions: TraderPosition[]
  recentTrades: TraderTrade[]
  closedPositions: ClosedPosition[]
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

export interface PeriodStats {
  tradeCount: number  // total trades in period
  buyCount: number
  sellCount: number
  volume: number      // total USDC (buys + sells)
  netFlow: number     // sellVolume - buyVolume; positive = more selling/profit-taking
  // Win/loss from closed positions (settled markets) in this period
  winCount: number    // closed positions with realizedPnl > 0
  winPnl: number      // total positive realizedPnl
  lossCount: number   // closed positions with realizedPnl <= 0
  lossPnl: number     // total negative realizedPnl (absolute value)
}

export interface TimePeriodStats {
  day: PeriodStats    // last 24 hours
  week: PeriodStats   // last 7 days
  month: PeriodStats  // last 30 days
}

export interface ClosedPositionSummary {
  total: number        // total closed positions
  wins: number         // positions with realizedPnl > 0
  losses: number       // positions with realizedPnl <= 0
  totalPnl: number     // sum of all realizedPnl
  winRate: number       // wins / total (0-1)
  avgPnlPerTrade: number // totalPnl / total
}

export interface TraderMetrics {
  tradeCount: number         // number of recent trades analyzed
  uniqueMarkets: number      // unique markets in current positions
  avgTradeSize: number       // average trade size in USDC
  daysSinceLastTrade: number // days since most recent trade
  periods: TimePeriodStats
  closedPositionSummary: ClosedPositionSummary
}

export interface ScreenerResultDetail {
  positions: TraderPosition[]   // open positions at time of screening
  trades: TraderTrade[]         // all trades within the 30-day window
  llmInput: string              // formatted data sent to LLM
  llmRaw: string                // raw LLM response/recommendation for this trader (JSON string)
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
  metrics?: TraderMetrics
  recommendation: LLMRecommendation
  detail?: ScreenerResultDetail
  screenedAt: number  // unix timestamp seconds
}

export interface ScreenerConfig {
  enabled: boolean
  scheduleCron: 'daily' | 'disabled'
  lastRunAt: number | null
  closedPositionsLimit: number  // max closed positions to fetch per wallet, default 200
}

export type ScreenerStatus = 'idle' | 'running' | 'done' | 'error'

export interface ScreenerState {
  status: ScreenerStatus
  progress: number       // 0-100
  progressLabel: string
  results: ScreenerResult[]
  lastError: string | null
}

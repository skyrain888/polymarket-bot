// ===== DataCollector 输出 =====

export interface CopyTradeSummary {
  walletAddress: string
  label: string
  totalTrades: number
  totalCopiedSize: number
  totalPnl: number
  winCount: number
  lossCount: number
  winRate: number
  trades: CopyTradeRecord[]
}

export interface CopyTradeRecord {
  marketId: string
  title: string
  outcome: string
  side: string
  copiedSize: number
  price: number
  currentPrice?: number
  pnl?: number
  settled?: boolean
  timestamp: number
}

export interface OrderSummary {
  strategyId: string
  totalOrders: number
  executedCount: number
  rejectedCount: number
  orders: OrderRecord[]
}

export interface OrderRecord {
  marketId: string
  side: string
  size: number
  price: number
  status: string
  reason?: string
  createdAt: string
}

export interface SignalSummary {
  totalSignals: number
  byProvider: Record<string, { count: number; avgConfidence: number }>
  signals: SignalRecord[]
}

export interface SignalRecord {
  marketId: string
  provider: string
  sentiment: string
  confidence: number
  summary: string
  createdAt: string
}

export interface AccountSnapshot {
  balance: number
  totalPnl: number
  snapshotDate: string
}

export interface ReviewDataSummary {
  periodStart: string
  periodEnd: string
  copyTrades: CopyTradeSummary[]
  orders: OrderSummary[]
  signals: SignalSummary
  accountSnapshots: AccountSnapshot[]
  overview: {
    totalPnl: number
    totalTrades: number
    winRate: number
    bestWallet: { label: string; pnl: number } | null
    worstWallet: { label: string; pnl: number } | null
  }
}

// ===== PnLAnalyzer 输出 =====

export interface PnLReport {
  overallScore: number
  totalPnl: number
  winRate: number
  maxDrawdown: number
  sharpeEstimate: number
  profitAttribution: string
  riskExposure: string
  drawdownAnalysis: string
  stabilityAnalysis: string
  summary: string
}

// ===== StrategyAnalyzer 输出 =====

export interface WalletScore {
  address: string
  label: string
  score: number
  pnl: number
  winRate: number
  assessment: string
}

export interface StrategyReport {
  overallScore: number
  walletScores: WalletScore[]
  walletComparison: string
  signalAccuracy: string
  marketPreference: string
  timingAnalysis: string
  parameterAssessment: string
  summary: string
}

// ===== Coordinator 输出 =====

export type SuggestionType =
  | 'adjust_ratio'
  | 'pause_wallet'
  | 'resume_wallet'
  | 'adjust_risk_limit'
  | 'adjust_poll_interval'
  | 'system_improvement'

export interface Suggestion {
  type: SuggestionType
  description: string
  target?: string
  currentValue?: string | number
  suggestedValue?: string | number
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
}

export interface ReviewReport {
  overallScore: number
  keyFindings: string[]
  comprehensiveAssessment: string
  suggestions: Suggestion[]
}

// ===== ReviewService 状态 =====

export type ReviewStatus = 'idle' | 'collecting' | 'analyzing_pnl' | 'analyzing_strategy' | 'coordinating' | 'completed' | 'failed'

export interface ReviewProgress {
  status: ReviewStatus
  currentReportId?: number
  error?: string
}

export interface ReviewConfig {
  enabled: boolean
  autoReviewTime: string
  timezone: string
}

// ===== DB Row =====

export interface ReviewReportRow {
  id: number
  period_start: string
  period_end: string
  trigger_type: string
  status: string
  data_summary: string | null
  pnl_analysis: string | null
  strategy_analysis: string | null
  report: string | null
  suggestions: string | null
  error: string | null
  created_at: string
}

export interface MarketContext {
  marketId: string
  question: string
  category: string
  yesPrice: number
  noPrice: number
  volume24h: number
  endDate: string
  recentNews?: string[]
}

export interface AnalysisResult {
  sentiment: 'bullish' | 'bearish' | 'neutral'
  confidence: number      // 0-1
  estimatedProbability: number  // 0-1, bot's estimate of YES outcome
  summary: string
  reasoning: string
  rawResponse?: string
}

export interface LLMProvider {
  name: string
  analyze(context: MarketContext): Promise<AnalysisResult>
}

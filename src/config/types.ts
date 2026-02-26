export type BotMode = 'backtest' | 'paper' | 'live'
export type LLMProviderName = 'claude' | 'openai' | 'gemini' | 'ollama'

export interface RiskConfig {
  maxPositionPct: number
  maxTotalExposurePct: number
  maxDailyLossPct: number
  maxConsecutiveLosses: number
  cooldownMinutes: number
  maxVolumeImpactPct: number
  maxSlippagePct: number
}

export interface StrategyConfig {
  enabled: boolean
  weight: number
}

export interface BotConfig {
  mode: BotMode
  polymarket: {
    apiKey: string
    apiSecret: string
    apiPassphrase: string
    privateKey: string
    host: string
  }
  llm: {
    provider: LLMProviderName
    apiKey: string
    model: string
    ollamaHost?: string
  }
  risk: RiskConfig
  strategies: {
    marketMaker: StrategyConfig
    arbitrage: StrategyConfig
    momentum: StrategyConfig
    fundamental: StrategyConfig
  }
  notify: {
    telegram: { token: string; chatId: string } | null
    discord: { webhookUrl: string } | null
  }
  dashboard: { port: number }
  dbPath: string
}

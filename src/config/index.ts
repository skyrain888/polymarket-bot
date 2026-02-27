import type { BotConfig } from './types.ts'
import type { WalletConfig } from '../strategies/copy-trading/types.ts'

export function loadConfig(): BotConfig {
  const mode = (process.env.BOT_MODE ?? 'paper') as BotConfig['mode']

  if (mode === 'live' && !process.env.POLY_PRIVATE_KEY) {
    throw new Error('POLY_PRIVATE_KEY required in live mode')
  }

  return {
    mode,
    polymarket: {
      apiKey: process.env.POLY_API_KEY ?? '',
      apiSecret: process.env.POLY_API_SECRET ?? '',
      apiPassphrase: process.env.POLY_API_PASSPHRASE ?? '',
      privateKey: process.env.POLY_PRIVATE_KEY ?? '',
      host: 'https://clob.polymarket.com',
    },
    llm: {
      provider: (process.env.LLM_PROVIDER ?? 'claude') as BotConfig['llm']['provider'],
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? 'claude-opus-4-6',
      ollamaHost: process.env.OLLAMA_HOST,
    },
    risk: {
      maxPositionPct: Number(process.env.RISK_MAX_POSITION_PCT ?? 0.20),
      maxTotalExposurePct: Number(process.env.RISK_MAX_EXPOSURE_PCT ?? 0.60),
      maxDailyLossPct: Number(process.env.RISK_MAX_DAILY_LOSS_PCT ?? 0.05),
      maxConsecutiveLosses: Number(process.env.RISK_MAX_CONSECUTIVE_LOSSES ?? 5),
      cooldownMinutes: Number(process.env.RISK_COOLDOWN_MINUTES ?? 60),
      maxVolumeImpactPct: Number(process.env.RISK_MAX_VOLUME_IMPACT_PCT ?? 0.05),
      maxSlippagePct: Number(process.env.RISK_MAX_SLIPPAGE_PCT ?? 0.02),
    },
    strategies: {
      marketMaker: { enabled: process.env.STRAT_MM_ENABLED !== 'false', weight: Number(process.env.STRAT_MM_WEIGHT ?? 0.25) },
      arbitrage:   { enabled: process.env.STRAT_ARB_ENABLED !== 'false', weight: Number(process.env.STRAT_ARB_WEIGHT ?? 0.25) },
      momentum:    { enabled: process.env.STRAT_MOM_ENABLED !== 'false', weight: Number(process.env.STRAT_MOM_WEIGHT ?? 0.25) },
      fundamental: { enabled: process.env.STRAT_FUND_ENABLED !== 'false', weight: Number(process.env.STRAT_FUND_WEIGHT ?? 0.25) },
    },
    notify: {
      telegram: process.env.TELEGRAM_TOKEN
        ? { token: process.env.TELEGRAM_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID ?? '' }
        : null,
      discord: process.env.DISCORD_WEBHOOK_URL
        ? { webhookUrl: process.env.DISCORD_WEBHOOK_URL }
        : null,
    },
    dashboard: { port: Number(process.env.DASHBOARD_PORT ?? 3000) },
    copyTrading: {
      enabled: process.env.COPY_TRADING_ENABLED === 'true',
      wallets: process.env.COPY_WALLETS
        ? JSON.parse(process.env.COPY_WALLETS) as WalletConfig[]
        : [],
      maxDailyTradesPerWallet: Number(process.env.COPY_MAX_DAILY_TRADES ?? 10),
      maxWalletExposureUsdc: Number(process.env.COPY_MAX_WALLET_EXPOSURE ?? 500),
      maxTotalExposureUsdc: Number(process.env.COPY_MAX_TOTAL_EXPOSURE ?? 2000),
    },
    dbPath: process.env.DB_PATH ?? './data/transBoot.db',
  }
}

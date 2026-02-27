export type SizeMode = 'fixed' | 'proportional'

export interface WalletConfig {
  address: string
  label: string
  sizeMode: SizeMode
  fixedAmount?: number      // USDC, used when sizeMode === 'fixed'
  proportionPct?: number    // 0-1, fraction of copied trade size, used when sizeMode === 'proportional'
  maxCopiesPerMarket: number // max times to copy same market for this wallet (default 1)
}

export interface CopiedTrade {
  walletAddress: string
  label: string
  marketId: string
  title: string
  outcome: string
  tokenId: string
  side: 'buy' | 'sell'
  originalSize: number
  copiedSize: number
  price: number
  txHash: string
  timestamp: number
  walletPortfolioValue: number   // sum of currentValue from all positions
  walletPositionSize: number     // tracked wallet's position size in this market
  walletPositionValue: number    // tracked wallet's position value in this market
  tradeToAccountPct: number      // originalSize / walletPortfolioValue * 100
}

export interface CopyTradingConfig {
  enabled: boolean
  wallets: WalletConfig[]
  maxDailyTradesPerWallet: number
  maxWalletExposureUsdc: number
  maxTotalExposureUsdc: number
  pollIntervalSeconds: number  // how often to poll for new trades (default 30)
}

export type SizeMode = 'fixed' | 'proportional'

export interface WalletConfig {
  address: string
  label: string
  sizeMode: SizeMode
  fixedAmount?: number      // USDC, used when sizeMode === 'fixed'
  proportionPct?: number    // 0-1, fraction of copied trade size, used when sizeMode === 'proportional'
}

export interface CopiedTrade {
  walletAddress: string
  label: string
  marketId: string
  tokenId: string
  side: 'buy' | 'sell'
  originalSize: number
  copiedSize: number
  price: number
  txHash: string
  timestamp: number
}

export interface CopyTradingConfig {
  enabled: boolean
  wallets: WalletConfig[]
  maxDailyTradesPerWallet: number
  maxWalletExposureUsdc: number
  maxTotalExposureUsdc: number
}

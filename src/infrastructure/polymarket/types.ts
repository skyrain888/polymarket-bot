export interface Market {
  id: string
  conditionId: string
  question: string
  category: string
  endDate: string
  yesPrice: number
  noPrice: number
  volume24h: number
  liquidity: number
  active: boolean
}

export interface OrderIntent {
  marketId: string
  tokenId: string
  side: 'buy' | 'sell'
  size: number
  price: number
}

export interface OrderResult {
  orderId: string
  status: 'open' | 'filled' | 'cancelled' | 'simulated'
  marketId: string
  side: string
  size: number
  price: number
}

export interface OrderBook {
  bids: { price: number; size: number }[]
  asks: { price: number; size: number }[]
}

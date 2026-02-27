const DATA_API_URL = 'https://data-api.polymarket.com/activity'
const POSITIONS_API_URL = 'https://data-api.polymarket.com/positions'
const CLOB_MIDPOINT_URL = 'https://clob.polymarket.com/midpoint'
const CLOB_MARKET_URL = 'https://clob.polymarket.com/markets'

export interface MarketStatus {
  active: boolean
  closed: boolean
  acceptingOrders: boolean
  endDate: string
  resolvedPrices: Map<string, number>  // tokenId → final price (1=win, 0=lose)
}

export interface WalletPosition {
  conditionId: string
  size: number
  avgPrice: number
  currentValue: number
  title: string
  outcome: string
}

export interface WalletPositionsResult {
  positions: WalletPosition[]
  totalPortfolioValue: number
}

export interface RawTrade {
  marketId: string
  tokenId: string
  title: string
  outcome: string
  side: 'buy' | 'sell'
  size: number
  price: number
  txHash: string
  timestamp: number
}

export class GraphClient {
  private marketStatusCache = new Map<string, MarketStatus>()

  constructor(private url = DATA_API_URL) {}

  async getWalletPositions(walletAddress: string): Promise<WalletPositionsResult> {
    const params = new URLSearchParams({
      user: walletAddress.toLowerCase(),
    })

    const res = await fetch(`${POSITIONS_API_URL}?${params}`, {
      tls: { rejectUnauthorized: false },
    } as any)
    if (!res.ok) {
      console.error(`[CopyTrading] Positions API failed: ${res.status}`)
      return { positions: [], totalPortfolioValue: 0 }
    }

    const raw = (await res.json()) as any[]
    const positions: WalletPosition[] = raw.map((p: any) => ({
      conditionId: p.conditionId ?? p.asset ?? '',
      size: Number(p.size ?? 0),
      avgPrice: Number(p.avgPrice ?? 0),
      currentValue: Number(p.currentValue ?? 0),
      title: p.title ?? '',
      outcome: p.outcome ?? '',
    }))

    const totalPortfolioValue = positions.reduce((sum, p) => sum + p.currentValue, 0)

    return { positions, totalPortfolioValue }
  }

  async getRecentTrades(walletAddress: string, since: number): Promise<RawTrade[]> {
    const params = new URLSearchParams({
      user: walletAddress.toLowerCase(),
      limit: '10',
    })

    console.log(`[CopyTrading] Fetching activity for ${walletAddress.slice(0, 10)}... (since=${since})`)
    const res = await fetch(`${this.url}?${params}`, {
      tls: { rejectUnauthorized: false },
    } as any)
    if (!res.ok) throw new Error(`Polymarket API failed: ${res.status}`)

    const events = (await res.json()) as any[]
    const trades = events.filter((e: any) => e.type === 'TRADE' && e.timestamp > since && e.side)
    console.log(`[CopyTrading] Got ${events.length} events, ${trades.length} trades for ${walletAddress.slice(0, 10)}...`)

    return trades
      .map((e: any) => ({
        marketId: e.conditionId,
        tokenId: e.asset,
        title: e.title ?? '',
        outcome: e.outcome ?? '',
        side: (e.side as string).toLowerCase() as 'buy' | 'sell',
        size: Number(e.usdcSize ?? e.size),
        price: Number(e.price),
        txHash: e.transactionHash,
        timestamp: Number(e.timestamp),
      }))
  }

  async getTokenPrices(tokenIds: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(tokenIds)]
    const results = await Promise.allSettled(
      unique.map(async (tokenId) => {
        const res = await fetch(`${CLOB_MIDPOINT_URL}?token_id=${tokenId}`, {
          tls: { rejectUnauthorized: false },
        } as any)
        if (!res.ok) return { tokenId, price: 0 }
        const data = await res.json() as any
        return { tokenId, price: Number(data.mid ?? data.price ?? 0) }
      })
    )

    const priceMap = new Map<string, number>()
    for (const result of results) {
      if (result.status === 'fulfilled') {
        priceMap.set(result.value.tokenId, result.value.price)
      }
    }
    return priceMap
  }

  async getMarketStatuses(conditionIds: string[]): Promise<Map<string, MarketStatus>> {
    const unique = [...new Set(conditionIds)]
    // Only fetch markets not in terminal state (closed=true)
    const toFetch = unique.filter(id => {
      const cached = this.marketStatusCache.get(id)
      return !cached || !cached.closed
    })

    if (toFetch.length > 0) {
      const results = await Promise.allSettled(
        toFetch.map(async (id) => {
          const res = await fetch(`${CLOB_MARKET_URL}/${id}`, {
            tls: { rejectUnauthorized: false },
          } as any)
          if (!res.ok) return { id, status: null }
          const data = await res.json() as any
          const resolvedPrices = new Map<string, number>()
          if (data.closed && Array.isArray(data.tokens)) {
            for (const t of data.tokens) {
              if (t.token_id) {
                resolvedPrices.set(t.token_id, t.winner ? 1 : 0)
              }
            }
          }
          return {
            id,
            status: {
              active: Boolean(data.active),
              closed: Boolean(data.closed),
              acceptingOrders: Boolean(data.accepting_orders),
              endDate: data.end_date_iso ?? '',
              resolvedPrices,
            } as MarketStatus,
          }
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.status) {
          this.marketStatusCache.set(result.value.id, result.value.status)
        }
        // API failed → keep existing cache, don't overwrite
      }
    }

    // Return from cache for all requested IDs
    const statusMap = new Map<string, MarketStatus>()
    for (const id of unique) {
      const cached = this.marketStatusCache.get(id)
      if (cached) statusMap.set(id, cached)
    }
    return statusMap
  }
}

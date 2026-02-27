import type {
  LeaderboardEntry,
  TraderProfile,
  TraderPosition,
  TraderTrade,
} from './types'

const LEADERBOARD_URL = 'https://data-api.polymarket.com/v1/leaderboard'
const ACTIVITY_URL = 'https://data-api.polymarket.com/activity'
const POSITIONS_URL = 'https://data-api.polymarket.com/positions'

const FETCH_OPTS = { tls: { rejectUnauthorized: false } } as any

const DEFAULT_CONCURRENCY = 5
const LEADERBOARD_LIMIT = 100
const ACTIVITY_LIMIT = 50

export class DataFetcher {
  /**
   * Fetch the top 100 traders from the Polymarket leaderboard.
   */
  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const params = new URLSearchParams({
      limit: String(LEADERBOARD_LIMIT),
    })

    const res = await fetch(`${LEADERBOARD_URL}?${params}`, FETCH_OPTS)
    if (!res.ok) {
      console.error(`[Screener] Leaderboard API failed: ${res.status}`)
      return []
    }

    const raw = (await res.json()) as any[]
    return raw.map((e: any) => ({
      rank: Number(e.rank ?? 0),
      address: String(e.proxyWallet ?? ''),
      username: String(e.userName ?? ''),
      profileImage: String(e.profileImage ?? ''),
      pnl: Number(e.pnl ?? 0),
      volume: Number(e.vol ?? 0),
    }))
  }

  /**
   * Fetch recent trades (activity) for a single wallet address.
   */
  async getRecentTrades(address: string): Promise<TraderTrade[]> {
    const params = new URLSearchParams({
      user: address.toLowerCase(),
      limit: String(ACTIVITY_LIMIT),
    })

    const res = await fetch(`${ACTIVITY_URL}?${params}`, FETCH_OPTS)
    if (!res.ok) {
      console.error(`[Screener] Activity API failed for ${address.slice(0, 10)}...: ${res.status}`)
      return []
    }

    const events = (await res.json()) as any[]
    return events
      .filter((e: any) => e.type === 'TRADE' && e.side)
      .map((e: any) => ({
        marketId: String(e.conditionId ?? ''),
        title: String(e.title ?? ''),
        outcome: String(e.outcome ?? ''),
        side: (String(e.side).toLowerCase() as 'buy' | 'sell'),
        size: Number(e.usdcSize ?? e.size ?? 0),
        price: Number(e.price ?? 0),
        timestamp: Number(e.timestamp ?? 0),
      }))
  }

  /**
   * Fetch current positions for a single wallet address.
   */
  async getPositions(address: string): Promise<TraderPosition[]> {
    const params = new URLSearchParams({
      user: address.toLowerCase(),
    })

    const res = await fetch(`${POSITIONS_URL}?${params}`, FETCH_OPTS)
    if (!res.ok) {
      console.error(`[Screener] Positions API failed for ${address.slice(0, 10)}...: ${res.status}`)
      return []
    }

    const raw = (await res.json()) as any[]
    return raw.map((p: any) => ({
      conditionId: String(p.conditionId ?? p.asset ?? ''),
      title: String(p.title ?? ''),
      outcome: String(p.outcome ?? ''),
      size: Number(p.size ?? 0),
      currentValue: Number(p.currentValue ?? 0),
    }))
  }

  /**
   * Build a full TraderProfile for a single leaderboard entry by fetching
   * positions and recent trades in parallel.
   */
  async buildProfile(entry: LeaderboardEntry): Promise<TraderProfile> {
    const [positionsResult, tradesResult] = await Promise.allSettled([
      this.getPositions(entry.address),
      this.getRecentTrades(entry.address),
    ])

    const positions = positionsResult.status === 'fulfilled' ? positionsResult.value : []
    const recentTrades = tradesResult.status === 'fulfilled' ? tradesResult.value : []
    const totalPortfolioValue = positions.reduce((sum, p) => sum + p.currentValue, 0)

    return { entry, positions, recentTrades, totalPortfolioValue }
  }

  /**
   * Build profiles for multiple leaderboard entries, processing in batches
   * to limit concurrency and avoid overwhelming the API.
   */
  async buildProfiles(
    entries: LeaderboardEntry[],
    concurrency: number = DEFAULT_CONCURRENCY,
  ): Promise<TraderProfile[]> {
    const profiles: TraderProfile[] = []

    for (let i = 0; i < entries.length; i += concurrency) {
      const batch = entries.slice(i, i + concurrency)
      const results = await Promise.allSettled(
        batch.map((entry) => this.buildProfile(entry)),
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          profiles.push(result.value)
        } else {
          console.error(`[Screener] Failed to build profile:`, result.reason)
        }
      }
    }

    return profiles
  }
}

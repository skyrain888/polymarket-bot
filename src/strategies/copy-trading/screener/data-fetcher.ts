import type {
  LeaderboardEntry,
  TraderProfile,
  TraderPosition,
  TraderTrade,
  ClosedPosition,
} from './types'
import { logger } from '../../../infrastructure/logger'

const LEADERBOARD_URL = 'https://data-api.polymarket.com/v1/leaderboard'
const ACTIVITY_URL = 'https://data-api.polymarket.com/activity'
const POSITIONS_URL = 'https://data-api.polymarket.com/positions'
const CLOSED_POSITIONS_URL = 'https://data-api.polymarket.com/closed-positions'

const FETCH_OPTS = { tls: { rejectUnauthorized: false } } as any

const DEFAULT_CONCURRENCY = 5
const LEADERBOARD_LIMIT = 100
const ACTIVITY_PAGE_SIZE = 1000  // API hard max per request
const ACTIVITY_TARGET_DAYS = 30  // paginate until oldest trade exceeds this many days
const ACTIVITY_SAFETY_CAP = 10   // failsafe: never exceed 10 pages (10k events) per wallet
const CLOSED_POSITIONS_PAGE_SIZE = 50  // API max per request for closed-positions endpoint
const DEFAULT_CLOSED_POSITIONS_LIMIT = 200  // max closed positions to fetch per wallet

const TAG = 'DataFetcher'

export class DataFetcher {
  private closedPositionsLimit: number

  constructor(closedPositionsLimit = DEFAULT_CLOSED_POSITIONS_LIMIT) {
    this.closedPositionsLimit = closedPositionsLimit
  }
  /**
   * Fetch the top 100 traders from the Polymarket leaderboard.
   */
  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const params = new URLSearchParams({ limit: String(LEADERBOARD_LIMIT) })
    const url = `${LEADERBOARD_URL}?${params}`
    logger.debug(TAG, `GET ${url}`)

    const res = await fetch(url, FETCH_OPTS)
    logger.debug(TAG, `Leaderboard response status: ${res.status}`)
    if (!res.ok) {
      logger.error(TAG, `Leaderboard API failed: ${res.status}`)
      return []
    }

    const raw = (await res.json()) as any[]
    logger.info(TAG, `Leaderboard fetched: ${raw.length} entries`)

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
   * Fetch ALL trades for a wallet covering at least ACTIVITY_TARGET_DAYS days.
   * Paginates automatically (limit=1000, offset-based) until:
   *   - the oldest trade in the latest batch predates the target window, OR
   *   - the API returns a partial page (end of history), OR
   *   - ACTIVITY_SAFETY_CAP pages reached (failsafe only, logs a warning)
   */
  async getRecentTrades(address: string): Promise<TraderTrade[]> {
    const cutoff = Math.floor(Date.now() / 1000) - ACTIVITY_TARGET_DAYS * 86_400
    const short = address.slice(0, 10)
    const allTrades: TraderTrade[] = []
    let page = 0
    let hitSafetyCap = false

    while (true) {
      if (page >= ACTIVITY_SAFETY_CAP) {
        hitSafetyCap = true
        logger.warn(TAG, `Safety cap (${ACTIVITY_SAFETY_CAP} pages) reached for ${short}..., stopping early`)
        break
      }

      const offset = page * ACTIVITY_PAGE_SIZE
      const params = new URLSearchParams({
        user: address.toLowerCase(),
        limit: String(ACTIVITY_PAGE_SIZE),
        ...(offset > 0 ? { offset: String(offset) } : {}),
      })
      logger.debug(TAG, `GET activity ${short}... page=${page + 1} offset=${offset}`)

      const res = await fetch(`${ACTIVITY_URL}?${params}`, FETCH_OPTS)
      if (!res.ok) {
        logger.error(TAG, `Activity API failed for ${short}... page=${page + 1}: HTTP ${res.status}`)
        break
      }

      const events = (await res.json()) as any[]
      const trades = events
        .filter((e: any) => e.type === 'TRADE' && e.side)
        .map((e: any) => ({
          marketId: String(e.conditionId ?? ''),
          title: String(e.title ?? ''),
          outcome: String(e.outcome ?? ''),
          side: String(e.side).toLowerCase() as 'buy' | 'sell',
          size: Number(e.usdcSize ?? e.size ?? 0),
          price: Number(e.price ?? 0),
          timestamp: Number(e.timestamp ?? 0),
        }))

      logger.debug(TAG, `Activity ${short}... page=${page + 1}: ${events.length} events → ${trades.length} trades`)
      allTrades.push(...trades)
      page++

      // Termination conditions (checked after push so allTrades is always complete for this page)
      if (events.length < ACTIVITY_PAGE_SIZE) {
        // Partial page = end of this wallet's full history
        logger.debug(TAG, `End of history for ${short}... (partial page ${page})`)
        break
      }
      const pageOldest = trades.length > 0 ? Math.min(...trades.map(t => t.timestamp)) : Infinity
      if (pageOldest <= cutoff) {
        // Oldest trade in this batch already past the 30-day window — coverage complete
        logger.debug(TAG, `30-day coverage achieved for ${short}... at page ${page} (oldest=${new Date(pageOldest * 1000).toISOString().slice(0, 10)})`)
        break
      }
    }

    // Compute coverage stats before filtering
    const rawCount = allTrades.length
    const oldest = rawCount > 0 ? Math.min(...allTrades.map(t => t.timestamp)) : 0
    const newest = rawCount > 0 ? Math.max(...allTrades.map(t => t.timestamp)) : 0
    const spanDays = oldest > 0 ? ((newest - oldest) / 86_400).toFixed(1) : '0'

    const filtered = allTrades.filter(t => t.timestamp >= cutoff)
    const covered = oldest > 0 && oldest <= cutoff

    logger.info(TAG, `Activity ${short}...: ${rawCount} raw trades over ${spanDays}d (${page} page${page !== 1 ? 's' : ''}) → ${filtered.length} within ${ACTIVITY_TARGET_DAYS}d${hitSafetyCap ? ' ⚠️ safety cap hit' : covered ? '' : ' ⚠️ history may be incomplete'}`)
    return filtered
  }

  /**
   * Fetch current positions for a single wallet address.
   */
  async getPositions(address: string): Promise<TraderPosition[]> {
    const params = new URLSearchParams({ user: address.toLowerCase() })
    const url = `${POSITIONS_URL}?${params}`
    logger.debug(TAG, `GET positions for ${address.slice(0, 10)}...`)

    const res = await fetch(url, FETCH_OPTS)
    logger.debug(TAG, `Positions response for ${address.slice(0, 10)}...: status=${res.status}`)
    if (!res.ok) {
      logger.error(TAG, `Positions API failed for ${address.slice(0, 10)}...: ${res.status}`)
      return []
    }

    const raw = (await res.json()) as any[]
    logger.debug(TAG, `Positions for ${address.slice(0, 10)}...: ${raw.length} positions`)

    return raw.map((p: any) => ({
      conditionId: String(p.conditionId ?? p.asset ?? ''),
      title: String(p.title ?? ''),
      outcome: String(p.outcome ?? ''),
      size: Number(p.size ?? 0),
      currentValue: Number(p.currentValue ?? 0),
    }))
  }

  /**
   * Fetch closed (settled) positions for a wallet, up to closedPositionsLimit.
   * Uses sortBy=timestamp to ensure complete data (default sort is by PnL which
   * causes pagination to miss losses). Paginates with offset until limit reached.
   */
  async getClosedPositions(address: string): Promise<ClosedPosition[]> {
    const short = address.slice(0, 10)
    const allClosed: ClosedPosition[] = []
    let page = 0
    const pageSize = CLOSED_POSITIONS_PAGE_SIZE

    while (true) {
      if (allClosed.length >= this.closedPositionsLimit) {
        logger.debug(TAG, `Closed-positions limit (${this.closedPositionsLimit}) reached for ${short}...`)
        break
      }
      if (page >= ACTIVITY_SAFETY_CAP) {
        logger.warn(TAG, `Closed-positions safety cap (${ACTIVITY_SAFETY_CAP} pages) reached for ${short}...`)
        break
      }

      const remaining = this.closedPositionsLimit - allClosed.length
      const limit = Math.min(pageSize, remaining)
      const offset = page * pageSize
      const params = new URLSearchParams({
        user: address.toLowerCase(),
        limit: String(limit),
        sortBy: 'timestamp',
        ...(offset > 0 ? { offset: String(offset) } : {}),
      })
      logger.debug(TAG, `GET closed-positions ${short}... page=${page + 1} offset=${offset} limit=${limit}`)

      const res = await fetch(`${CLOSED_POSITIONS_URL}?${params}`, FETCH_OPTS)
      if (!res.ok) {
        logger.error(TAG, `Closed-positions API failed for ${short}... page=${page + 1}: HTTP ${res.status}`)
        break
      }

      const raw = (await res.json()) as any[]
      const items = raw.map((p: any) => ({
        conditionId: String(p.conditionId ?? ''),
        title: String(p.title ?? ''),
        outcome: String(p.outcome ?? ''),
        avgPrice: Number(p.avgPrice ?? 0),
        totalBought: Number(p.totalBought ?? 0),
        realizedPnl: Number(p.realizedPnl ?? 0),
        curPrice: Number(p.curPrice ?? 0),
        timestamp: Number(p.timestamp ?? 0),
      }))

      allClosed.push(...items)
      page++

      if (raw.length < limit) {
        logger.debug(TAG, `End of closed-positions for ${short}... (partial page ${page})`)
        break
      }
    }

    const wins = allClosed.filter(p => p.realizedPnl > 0).length
    const losses = allClosed.length - wins
    logger.info(TAG, `Closed positions ${short}...: ${allClosed.length} total (${wins}W/${losses}L) in ${page} page${page !== 1 ? 's' : ''}`)
    return allClosed
  }

  /**
   * Build a full TraderProfile for a single leaderboard entry by fetching
   * positions, recent trades, and closed positions in parallel.
   */
  async buildProfile(entry: LeaderboardEntry): Promise<TraderProfile> {
    logger.debug(TAG, `Building profile for ${entry.username || entry.address.slice(0, 10)} (rank #${entry.rank})`)
    const [positionsResult, tradesResult, closedResult] = await Promise.allSettled([
      this.getPositions(entry.address),
      this.getRecentTrades(entry.address),
      this.getClosedPositions(entry.address),
    ])

    const positions = positionsResult.status === 'fulfilled' ? positionsResult.value : []
    const recentTrades = tradesResult.status === 'fulfilled' ? tradesResult.value : []
    const closedPositions = closedResult.status === 'fulfilled' ? closedResult.value : []
    const totalPortfolioValue = positions.reduce((sum, p) => sum + p.currentValue, 0)

    logger.debug(TAG, `Profile built for ${entry.username || entry.address.slice(0, 10)}: ${positions.length} positions, ${recentTrades.length} trades, ${closedPositions.length} closed, portfolio=$${totalPortfolioValue.toFixed(0)}`)
    return { entry, positions, recentTrades, closedPositions, totalPortfolioValue }
  }

  /**
   * Build profiles for multiple leaderboard entries, processing in batches
   * to limit concurrency and avoid overwhelming the API.
   */
  async buildProfiles(
    entries: LeaderboardEntry[],
    concurrency: number = DEFAULT_CONCURRENCY,
  ): Promise<TraderProfile[]> {
    logger.info(TAG, `Building profiles for ${entries.length} traders (concurrency=${concurrency})`)
    const profiles: TraderProfile[] = []

    for (let i = 0; i < entries.length; i += concurrency) {
      const batch = entries.slice(i, i + concurrency)
      const batchNum = Math.floor(i / concurrency) + 1
      const totalBatches = Math.ceil(entries.length / concurrency)
      logger.info(TAG, `Profile batch ${batchNum}/${totalBatches}: fetching ${batch.map(e => e.username || e.address.slice(0, 8)).join(', ')}`)

      const results = await Promise.allSettled(
        batch.map((entry) => this.buildProfile(entry)),
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          profiles.push(result.value)
        } else {
          logger.error(TAG, `Failed to build profile:`, result.reason)
        }
      }

      logger.info(TAG, `Profile batch ${batchNum}/${totalBatches} done. Total so far: ${profiles.length}`)
    }

    return profiles
  }
}

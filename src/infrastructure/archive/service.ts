import type { CopyTradingStrategy } from '../../strategies/copy-trading/index.ts'
import type { ArchiveConfig } from '../../strategies/copy-trading/types.ts'
import type { ArchiveRepository } from './repository.ts'

const DEFAULT_ARCHIVE_DAYS = 30
const MAX_LIVE_COPIES = 200
const ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000

export class ArchiveService {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private repo: ArchiveRepository,
    private strategy: CopyTradingStrategy,
    private getConfig: () => ArchiveConfig | undefined,
  ) {}

  start(): void {
    if (this.timer != null) return   // already running
    this.archiveNow()
    // Run every 24 hours
    this.timer = setInterval(() => this.archiveNow(), ARCHIVE_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  clearData(from: number, to: number, target: 'archive' | 'active' | 'all'): number {
    let count = 0
    try {
      if (target === 'archive' || target === 'all') {
        count += this.repo.deleteByDateRange(from, to)
      }
      if (target === 'active' || target === 'all') {
        count += this.strategy.removeCopiesByDateRange(from, to)
      }
    } catch (err) {
      console.error('[Archive] Clear data failed:', err)
    }
    return count
  }

  /**
   * Archive records older than `overrideDays` days (or config value).
   * When called with overrideDays, bypasses the enabled flag (manual trigger).
   * Returns count archived.
   */
  archiveNow(overrideDays?: number): number {
    const cfg = this.getConfig()
    const days = overrideDays ?? cfg?.autoArchiveDays ?? DEFAULT_ARCHIVE_DAYS

    if (overrideDays == null && !cfg?.enabled) {
      console.log('[Archive] Auto-archive disabled, skipping')
      return 0
    }

    const cutoff = Math.floor(Date.now() / 1000) - days * 86400
    const copies = this.strategy.getRecentCopies(MAX_LIVE_COPIES)
    const toArchive = copies.filter(c => c.timestamp < cutoff)

    if (toArchive.length === 0) {
      console.log(`[Archive] No records older than ${days} days to archive`)
      return 0
    }

    try {
      this.repo.insertMany(toArchive)
      this.strategy.removeCopies(toArchive.map(c => c.txHash))
      console.log(`[Archive] Archived ${toArchive.length} records older than ${days} days`)
      return toArchive.length
    } catch (err) {
      console.error('[Archive] Archive operation failed, live records preserved:', err)
      return 0
    }
  }
}

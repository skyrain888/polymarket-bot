import type { CopyTradingStrategy } from '../../strategies/copy-trading/index.ts'
import type { ArchiveConfig } from '../../strategies/copy-trading/types.ts'
import type { ArchiveRepository } from './repository.ts'

export class ArchiveService {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private repo: ArchiveRepository,
    private strategy: CopyTradingStrategy,
    private getConfig: () => ArchiveConfig | undefined,
  ) {}

  start(): void {
    this.archiveNow()
    // Run every 24 hours
    this.timer = setInterval(() => this.archiveNow(), 24 * 60 * 60 * 1000)
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Archive records older than `overrideDays` days (or config value).
   * When called with overrideDays, bypasses the enabled flag (manual trigger).
   * Returns count archived.
   */
  archiveNow(overrideDays?: number): number {
    const cfg = this.getConfig()
    const days = overrideDays ?? cfg?.autoArchiveDays ?? 30

    if (overrideDays == null && !cfg?.enabled) {
      console.log('[Archive] Auto-archive disabled, skipping')
      return 0
    }

    const cutoff = Math.floor(Date.now() / 1000) - days * 86400
    const copies = this.strategy.getRecentCopies(200)
    const toArchive = copies.filter(c => c.timestamp < cutoff)

    if (toArchive.length === 0) {
      console.log(`[Archive] No records older than ${days} days to archive`)
      return 0
    }

    this.repo.insertMany(toArchive)
    this.strategy.removeCopies(toArchive.map(c => c.txHash))
    console.log(`[Archive] Archived ${toArchive.length} records older than ${days} days`)
    return toArchive.length
  }
}

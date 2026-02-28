import type { Database } from 'bun:sqlite'
import type { ArchiveRepository } from '../../../infrastructure/archive/repository'
import type { OrderRepository } from '../../../infrastructure/storage/repositories'
import type { SignalRepository } from '../../../infrastructure/storage/repositories'
import type { CopyTradingStrategy } from '../../copy-trading/index'
import type {
  ReviewDataSummary,
  CopyTradeSummary,
  CopyTradeRecord,
  OrderSummary,
  OrderRecord,
  SignalSummary,
  SignalRecord,
  AccountSnapshot,
} from '../types'

export class DataCollector {
  constructor(
    private db: Database,
    private archiveRepo: ArchiveRepository,
    private orderRepo: OrderRepository,
    private signalRepo: SignalRepository,
    private getCopyStrategy: () => CopyTradingStrategy,
  ) {}

  async collect(periodStart: string, periodEnd: string): Promise<ReviewDataSummary> {
    const copyTrades = await this.collectCopyTrades(periodStart, periodEnd)
    const orders = this.collectOrders(periodStart, periodEnd)
    const signals = this.collectSignals(periodStart, periodEnd)
    const accountSnapshots = this.collectSnapshots(periodStart, periodEnd)
    const overview = this.computeOverview(copyTrades)

    return { periodStart, periodEnd, copyTrades, orders, signals, accountSnapshots, overview }
  }

  private async collectCopyTrades(periodStart: string, periodEnd: string): Promise<CopyTradeSummary[]> {
    const startTs = Math.floor(new Date(periodStart).getTime() / 1000)
    const endTs = Math.floor(new Date(periodEnd + 'T23:59:59Z').getTime() / 1000)

    // Active copies with PnL
    const strategy = this.getCopyStrategy()
    const { copies: activeCopies } = await strategy.getRecentCopiesWithPnl(200)
    const activeInRange = activeCopies.filter(c => c.timestamp >= startTs && c.timestamp <= endTs)

    // Archived copies
    const archived = this.archiveRepo.findAll({ since: startTs, pageSize: 10000 })
    const archivedInRange = archived.rows.filter(c => c.timestamp <= endTs)

    // Merge and group by wallet
    const walletMap = new Map<string, { label: string; trades: CopyTradeRecord[]; totalPnl: number; totalCopiedSize: number; winCount: number; lossCount: number }>()

    for (const c of activeInRange) {
      const entry = walletMap.get(c.walletAddress) ?? { label: c.label, trades: [], totalPnl: 0, totalCopiedSize: 0, winCount: 0, lossCount: 0 }
      entry.trades.push({
        marketId: c.marketId, title: c.title, outcome: c.outcome, side: c.side,
        copiedSize: c.copiedSize, price: c.price, currentPrice: c.currentPrice, pnl: c.pnl,
        settled: c.marketStatus?.closed ?? false, timestamp: c.timestamp,
      })
      entry.totalPnl += c.pnl ?? 0
      entry.totalCopiedSize += c.copiedSize
      if ((c.pnl ?? 0) > 0) entry.winCount++
      else if ((c.pnl ?? 0) < 0) entry.lossCount++
      walletMap.set(c.walletAddress, entry)
    }

    for (const c of archivedInRange) {
      // Skip if already counted from active
      if (activeInRange.some(a => a.txHash === c.txHash)) continue
      const entry = walletMap.get(c.walletAddress) ?? { label: c.label, trades: [], totalPnl: 0, totalCopiedSize: 0, winCount: 0, lossCount: 0 }
      entry.trades.push({
        marketId: c.marketId, title: c.title, outcome: c.outcome, side: c.side,
        copiedSize: c.copiedSize, price: c.price, timestamp: c.timestamp,
      })
      entry.totalCopiedSize += c.copiedSize
      walletMap.set(c.walletAddress, entry)
    }

    const summaries: CopyTradeSummary[] = []
    for (const [walletAddress, data] of walletMap) {
      const totalTrades = data.trades.length
      summaries.push({
        walletAddress, label: data.label, totalTrades,
        totalCopiedSize: data.totalCopiedSize, totalPnl: data.totalPnl,
        winCount: data.winCount, lossCount: data.lossCount,
        winRate: totalTrades > 0 ? data.winCount / totalTrades : 0,
        trades: data.trades,
      })
    }
    return summaries
  }

  private collectOrders(periodStart: string, periodEnd: string): OrderSummary[] {
    const rows = this.orderRepo.findByDateRange(periodStart, periodEnd + 'T23:59:59')
    const strategyMap = new Map<string, OrderRecord[]>()

    for (const r of rows) {
      const list = strategyMap.get(r.strategyId) ?? []
      list.push({
        marketId: r.marketId, side: r.side, size: r.size, price: r.price,
        status: r.status, reason: r.reason ?? undefined, createdAt: r.createdAt,
      })
      strategyMap.set(r.strategyId, list)
    }

    const summaries: OrderSummary[] = []
    for (const [strategyId, orders] of strategyMap) {
      summaries.push({
        strategyId, totalOrders: orders.length,
        executedCount: orders.filter(o => o.status === 'executed').length,
        rejectedCount: orders.filter(o => o.status === 'rejected').length,
        orders,
      })
    }
    return summaries
  }

  private collectSignals(periodStart: string, periodEnd: string): SignalSummary {
    const rows = this.signalRepo.findByDateRange(periodStart, periodEnd + 'T23:59:59')
    const byProvider: Record<string, { count: number; totalConfidence: number }> = {}
    const signals: SignalRecord[] = []

    for (const r of rows) {
      signals.push({
        marketId: r.marketId, provider: r.provider,
        sentiment: r.sentiment ?? '', confidence: r.confidence ?? 0,
        summary: r.summary ?? '', createdAt: r.createdAt,
      })
      const entry = byProvider[r.provider] ?? { count: 0, totalConfidence: 0 }
      entry.count++
      entry.totalConfidence += r.confidence ?? 0
      byProvider[r.provider] = entry
    }

    const byProviderAvg: Record<string, { count: number; avgConfidence: number }> = {}
    for (const [provider, data] of Object.entries(byProvider)) {
      byProviderAvg[provider] = { count: data.count, avgConfidence: data.count > 0 ? data.totalConfidence / data.count : 0 }
    }

    return { totalSignals: signals.length, byProvider: byProviderAvg, signals }
  }

  private collectSnapshots(periodStart: string, periodEnd: string): AccountSnapshot[] {
    const rows = this.db.query(
      `SELECT balance, total_pnl, snapshot_date FROM account_snapshots WHERE snapshot_date >= ? AND snapshot_date <= ? ORDER BY snapshot_date ASC`
    ).all(periodStart, periodEnd) as { balance: number; total_pnl: number; snapshot_date: string }[]

    return rows.map(r => ({ balance: r.balance, totalPnl: r.total_pnl, snapshotDate: r.snapshot_date }))
  }

  private computeOverview(copyTrades: CopyTradeSummary[]) {
    let totalPnl = 0
    let totalTrades = 0
    let totalWins = 0

    for (const w of copyTrades) {
      totalPnl += w.totalPnl
      totalTrades += w.totalTrades
      totalWins += w.winCount
    }

    const sorted = [...copyTrades].sort((a, b) => b.totalPnl - a.totalPnl)
    const bestWallet = sorted.length > 0 ? { label: sorted[0].label, pnl: sorted[0].totalPnl } : null
    const worstWallet = sorted.length > 0 ? { label: sorted[sorted.length - 1].label, pnl: sorted[sorted.length - 1].totalPnl } : null

    return {
      totalPnl,
      totalTrades,
      winRate: totalTrades > 0 ? totalWins / totalTrades : 0,
      bestWallet,
      worstWallet,
    }
  }
}

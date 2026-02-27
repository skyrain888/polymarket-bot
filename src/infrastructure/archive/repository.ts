import type { Database } from 'bun:sqlite'
import type { CopiedTrade } from '../../strategies/copy-trading/types.ts'

export class ArchiveRepository {
  constructor(private db: Database) {}

  insertMany(trades: CopiedTrade[]): void {
    const insertAll = this.db.transaction((rows: CopiedTrade[]) => {
      const stmt = this.db.prepare(`
        INSERT INTO copy_trades_archive (data, wallet, label, market_id, traded_at)
        VALUES ($data, $wallet, $label, $marketId, $tradedAt)
      `)
      try {
        for (const t of rows) {
          stmt.run({
            $data: JSON.stringify(t),
            $wallet: t.walletAddress,
            $label: t.label,
            $marketId: t.marketId,
            $tradedAt: t.timestamp,
          })
        }
      } finally {
        stmt.finalize()
      }
    })
    insertAll(trades)
  }

  findAll(opts: { label?: string; since?: number; page?: number; pageSize?: number } = {}): { rows: (CopiedTrade & { archivedAt: string })[]; total: number } {
    const { label, since, page = 0, pageSize = 100 } = opts
    const conditions: string[] = []
    const params: Record<string, unknown> = {}

    if (label) { conditions.push('label = $label'); params.$label = label }
    if (since != null) { conditions.push('traded_at >= $since'); params.$since = since }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const countParams = { ...params }
    const total = (this.db.query(`SELECT COUNT(*) as n FROM copy_trades_archive ${where}`).get(countParams as any) as any).n as number

    params.$limit = pageSize
    params.$offset = page * pageSize
    const raw = this.db.query(
      `SELECT data, archived_at FROM copy_trades_archive ${where} ORDER BY traded_at DESC LIMIT $limit OFFSET $offset`
    ).all(params as any) as { data: string; archived_at: string }[]

    const rows = raw.map(r => ({ ...(JSON.parse(r.data) as CopiedTrade), archivedAt: r.archived_at }))
    return { rows, total }
  }

  countAll(): number {
    return ((this.db.query('SELECT COUNT(*) as n FROM copy_trades_archive').get() as any).n) as number
  }
}

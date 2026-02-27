import type { Database } from 'bun:sqlite'
import type { CopiedTrade } from '../../strategies/copy-trading/types.ts'

export class ArchiveRepository {
  constructor(private db: Database) {}

  insertMany(trades: CopiedTrade[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO copy_trades_archive (data, wallet, label, market_id, traded_at)
      VALUES ($data, $wallet, $label, $marketId, $tradedAt)
    `)
    const insertAll = this.db.transaction((rows: CopiedTrade[]) => {
      for (const t of rows) {
        stmt.run({
          $data: JSON.stringify(t),
          $wallet: t.walletAddress,
          $label: t.label,
          $marketId: t.marketId,
          $tradedAt: t.timestamp,
        })
      }
    })
    insertAll(trades)
  }

  findAll(opts: { wallet?: string; since?: number; page?: number; pageSize?: number } = {}): { rows: (CopiedTrade & { archivedAt: string })[]; total: number } {
    const { wallet, since, page = 0, pageSize = 100 } = opts
    const conditions: string[] = []
    const params: Record<string, unknown> = {}

    if (wallet) { conditions.push('label = $wallet'); params.$wallet = wallet }
    if (since != null) { conditions.push('traded_at >= $since'); params.$since = since }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = (this.db.query(`SELECT COUNT(*) as n FROM copy_trades_archive ${where}`).get(params) as any).n as number

    params.$limit = pageSize
    params.$offset = page * pageSize
    const raw = this.db.query(
      `SELECT data, archived_at FROM copy_trades_archive ${where} ORDER BY traded_at DESC LIMIT $limit OFFSET $offset`
    ).all(params) as { data: string; archived_at: string }[]

    const rows = raw.map(r => ({ ...(JSON.parse(r.data) as CopiedTrade), archivedAt: r.archived_at }))
    return { rows, total }
  }

  countAll(): number {
    return ((this.db.query('SELECT COUNT(*) as n FROM copy_trades_archive').get() as any).n) as number
  }
}

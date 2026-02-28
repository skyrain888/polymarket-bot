import type { Database } from 'bun:sqlite'

export interface OrderRow {
  id?: number
  strategyId: string
  marketId: string
  side: string
  size: number
  price: number
  status: string
  reason: string | null
}

export class OrderRepository {
  constructor(private db: Database) {}

  insert(order: Omit<OrderRow, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO orders (strategy_id, market_id, side, size, price, status, reason)
      VALUES ($strategyId, $marketId, $side, $size, $price, $status, $reason)
    `)
    const result = stmt.run({
      $strategyId: order.strategyId,
      $marketId: order.marketId,
      $side: order.side,
      $size: order.size,
      $price: order.price,
      $status: order.status,
      $reason: order.reason,
    })
    return result.lastInsertRowid as number
  }

  findById(id: number): OrderRow | null {
    const row = this.db.query(`SELECT * FROM orders WHERE id = ?`).get(id) as any
    if (!row) return null
    return { id: row.id, strategyId: row.strategy_id, marketId: row.market_id, side: row.side, size: row.size, price: row.price, status: row.status, reason: row.reason }
  }

  findByStrategy(strategyId: string): OrderRow[] {
    const rows = this.db.query(`SELECT * FROM orders WHERE strategy_id = ? ORDER BY created_at DESC`).all(strategyId) as any[]
    return rows.map(r => ({ id: r.id, strategyId: r.strategy_id, marketId: r.market_id, side: r.side, size: r.size, price: r.price, status: r.status, reason: r.reason }))
  }

  findRecent(limit = 50): OrderRow[] {
    const rows = this.db.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`).all(limit) as any[]
    return rows.map(r => ({ id: r.id, strategyId: r.strategy_id, marketId: r.market_id, side: r.side, size: r.size, price: r.price, status: r.status, reason: r.reason }))
  }

  findByDateRange(start: string, end: string): (OrderRow & { createdAt: string })[] {
    const rows = this.db.query(
      `SELECT * FROM orders WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC`
    ).all(start, end) as any[]
    return rows.map(r => ({ id: r.id, strategyId: r.strategy_id, marketId: r.market_id, side: r.side, size: r.size, price: r.price, status: r.status, reason: r.reason, createdAt: r.created_at }))
  }
}

export interface PositionRow {
  id?: number
  marketId: string
  strategyId: string
  size: number
  avgPrice: number
  unrealizedPnl: number
}

export class PositionRepository {
  constructor(private db: Database) {}

  upsert(pos: Omit<PositionRow, 'id'>): void {
    this.db.prepare(`
      INSERT INTO positions (market_id, strategy_id, size, avg_price, unrealized_pnl, updated_at)
      VALUES ($marketId, $strategyId, $size, $avgPrice, $unrealizedPnl, datetime('now'))
      ON CONFLICT(market_id, strategy_id) DO UPDATE SET
        size = $size, avg_price = $avgPrice, unrealized_pnl = $unrealizedPnl, updated_at = datetime('now')
    `).run({ $marketId: pos.marketId, $strategyId: pos.strategyId, $size: pos.size, $avgPrice: pos.avgPrice, $unrealizedPnl: pos.unrealizedPnl })
  }

  findAll(): PositionRow[] {
    const rows = this.db.query(`SELECT * FROM positions WHERE size != 0`).all() as any[]
    return rows.map(r => ({ id: r.id, marketId: r.market_id, strategyId: r.strategy_id, size: r.size, avgPrice: r.avg_price, unrealizedPnl: r.unrealized_pnl }))
  }

  findByMarket(marketId: string): PositionRow[] {
    const rows = this.db.query(`SELECT * FROM positions WHERE market_id = ?`).all(marketId) as any[]
    return rows.map(r => ({ id: r.id, marketId: r.market_id, strategyId: r.strategy_id, size: r.size, avgPrice: r.avg_price, unrealizedPnl: r.unrealized_pnl }))
  }
}

export interface SignalRow {
  id?: number
  marketId: string
  provider: string
  sentiment: string | null
  confidence: number | null
  summary: string | null
  rawResponse: string | null
}

export class SignalRepository {
  constructor(private db: Database) {}

  insert(signal: Omit<SignalRow, 'id'>): void {
    this.db.prepare(`
      INSERT INTO signals (market_id, provider, sentiment, confidence, summary, raw_response)
      VALUES ($marketId, $provider, $sentiment, $confidence, $summary, $rawResponse)
    `).run({ $marketId: signal.marketId, $provider: signal.provider, $sentiment: signal.sentiment, $confidence: signal.confidence, $summary: signal.summary, $rawResponse: signal.rawResponse })
  }

  findRecent(marketId: string, limit = 10): SignalRow[] {
    const rows = this.db.query(`SELECT * FROM signals WHERE market_id = ? ORDER BY created_at DESC LIMIT ?`).all(marketId, limit) as any[]
    return rows.map(r => ({ id: r.id, marketId: r.market_id, provider: r.provider, sentiment: r.sentiment, confidence: r.confidence, summary: r.summary, rawResponse: r.raw_response }))
  }

  findAll(limit = 50): SignalRow[] {
    const rows = this.db.query(`SELECT * FROM signals ORDER BY created_at DESC LIMIT ?`).all(limit) as any[]
    return rows.map(r => ({ id: r.id, marketId: r.market_id, provider: r.provider, sentiment: r.sentiment, confidence: r.confidence, summary: r.summary, rawResponse: r.raw_response }))
  }

  findByDateRange(start: string, end: string): (SignalRow & { createdAt: string })[] {
    const rows = this.db.query(
      `SELECT * FROM signals WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC`
    ).all(start, end) as any[]
    return rows.map(r => ({ id: r.id, marketId: r.market_id, provider: r.provider, sentiment: r.sentiment, confidence: r.confidence, summary: r.summary, rawResponse: r.raw_response, createdAt: r.created_at }))
  }
}

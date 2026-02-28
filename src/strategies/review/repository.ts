import type { Database } from 'bun:sqlite'
import type { ReviewReportRow } from './types'

export class ReviewRepository {
  constructor(private db: Database) {}

  create(periodStart: string, periodEnd: string, triggerType: string): number {
    const stmt = this.db.prepare(
      `INSERT INTO review_reports (period_start, period_end, trigger_type, status)
       VALUES ($periodStart, $periodEnd, $triggerType, 'running')`
    )
    stmt.run({ $periodStart: periodStart, $periodEnd: periodEnd, $triggerType: triggerType })
    const row = this.db.query('SELECT last_insert_rowid() as id').get() as { id: number }
    return row.id
  }

  updateDataSummary(id: number, dataSummary: string): void {
    this.db.prepare('UPDATE review_reports SET data_summary = $data WHERE id = $id')
      .run({ $data: dataSummary, $id: id })
  }

  updatePnlAnalysis(id: number, pnlAnalysis: string): void {
    this.db.prepare('UPDATE review_reports SET pnl_analysis = $data WHERE id = $id')
      .run({ $data: pnlAnalysis, $id: id })
  }

  updateStrategyAnalysis(id: number, strategyAnalysis: string): void {
    this.db.prepare('UPDATE review_reports SET strategy_analysis = $data WHERE id = $id')
      .run({ $data: strategyAnalysis, $id: id })
  }

  updateReport(id: number, report: string, suggestions: string): void {
    this.db.prepare(
      `UPDATE review_reports SET report = $report, suggestions = $suggestions, status = 'completed' WHERE id = $id`
    ).run({ $report: report, $suggestions: suggestions, $id: id })
  }

  updateError(id: number, error: string): void {
    this.db.prepare(`UPDATE review_reports SET status = 'failed', error = $error WHERE id = $id`)
      .run({ $error: error, $id: id })
  }

  findById(id: number): ReviewReportRow | null {
    return this.db.prepare('SELECT * FROM review_reports WHERE id = $id')
      .get({ $id: id }) as ReviewReportRow | null
  }

  findAll(limit = 20, offset = 0): ReviewReportRow[] {
    return this.db.prepare(
      'SELECT * FROM review_reports ORDER BY created_at DESC LIMIT $limit OFFSET $offset'
    ).all({ $limit: limit, $offset: offset }) as ReviewReportRow[]
  }

  countAll(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM review_reports').get() as { count: number }
    return row.count
  }
}

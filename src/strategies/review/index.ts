import type { ReviewRepository } from './repository'
import type { DataCollector } from './agents/data-collector'
import type { PnLAnalyzer } from './agents/pnl-analyzer'
import type { StrategyAnalyzer } from './agents/strategy-analyzer'
import type { Coordinator } from './agents/coordinator'
import type { ReviewConfig, ReviewProgress, ReviewDataSummary, ReviewReport } from './types'
import { logger } from '../../infrastructure/logger'

export class ReviewService {
  private readonly TAG = 'Review'
  private progress: ReviewProgress = { status: 'idle' }
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private repo: ReviewRepository,
    private dataCollector: DataCollector,
    private pnlAnalyzer: PnLAnalyzer,
    private strategyAnalyzer: StrategyAnalyzer,
    private coordinator: Coordinator,
    private notifier: { notify(msg: string): void } | null,
    private getConfig: () => ReviewConfig,
  ) {}

  start(): void {
    const config = this.getConfig()
    if (!config.enabled) return
    this.scheduleNext()
    logger.info(this.TAG, `Auto review scheduled at ${config.autoReviewTime} ${config.timezone}`)
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  getProgress(): ReviewProgress {
    return { ...this.progress }
  }

  getRepo(): ReviewRepository {
    return this.repo
  }

  async runManual(periodStart: string, periodEnd: string): Promise<number> {
    return this.run(periodStart, periodEnd, 'manual')
  }

  private async runAutoReview(): Promise<void> {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().split('T')[0]
    try {
      await this.run(dateStr, dateStr, 'auto')
    } catch (err) {
      logger.error(this.TAG, 'Auto review failed:', err instanceof Error ? err.message : String(err))
    }
    this.scheduleNext()
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer)
    const config = this.getConfig()
    if (!config.enabled) return

    const [hours, minutes] = config.autoReviewTime.split(':').map(Number)
    const now = new Date()
    const next = new Date(now)
    next.setUTCHours(hours, minutes, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)

    const delay = next.getTime() - now.getTime()
    logger.info(this.TAG, `Next auto review in ${(delay / 1000 / 60 / 60).toFixed(1)}h at ${next.toISOString()}`)
    this.timer = setTimeout(() => this.runAutoReview(), delay)
  }

  private async run(periodStart: string, periodEnd: string, triggerType: string): Promise<number> {
    if (this.progress.status !== 'idle' && this.progress.status !== 'completed' && this.progress.status !== 'failed') {
      logger.warn(this.TAG, 'Already running, ignoring duplicate run request')
      return this.progress.currentReportId ?? 0
    }

    const reportId = this.repo.create(periodStart, periodEnd, triggerType)
    this.progress = { status: 'collecting', currentReportId: reportId }
    logger.info(this.TAG, `══════ Review started (${triggerType}) ${periodStart} ~ ${periodEnd} ══════`)
    const t0 = Date.now()

    try {
      // 1. DataCollector
      logger.info(this.TAG, '[1/3] Collecting data...')
      const data = await this.dataCollector.collect(periodStart, periodEnd)
      this.repo.updateDataSummary(reportId, JSON.stringify(data))
      logger.info(this.TAG, `[1/3] Data collected: ${data.overview.totalTrades} trades, PnL $${data.overview.totalPnl.toFixed(2)}`)

      // 2. PnLAnalyzer + StrategyAnalyzer 并行
      this.progress = { status: 'analyzing_pnl', currentReportId: reportId }
      logger.info(this.TAG, '[2/3] Running PnL + Strategy analysis in parallel...')
      const [pnlReport, strategyReport] = await Promise.all([
        this.pnlAnalyzer.analyze(data),
        this.strategyAnalyzer.analyze(data),
      ])
      this.repo.updatePnlAnalysis(reportId, JSON.stringify(pnlReport))
      this.repo.updateStrategyAnalysis(reportId, JSON.stringify(strategyReport))
      logger.info(this.TAG, `[2/3] Analysis done: PnL score=${pnlReport.overallScore}, Strategy score=${strategyReport.overallScore}`)

      // 3. Coordinator
      this.progress = { status: 'coordinating', currentReportId: reportId }
      logger.info(this.TAG, '[3/3] Coordinating final report...')
      const report = await this.coordinator.coordinate(data, pnlReport, strategyReport)
      this.repo.updateReport(reportId, JSON.stringify(report), JSON.stringify(report.suggestions))

      this.progress = { status: 'completed', currentReportId: reportId }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      logger.info(this.TAG, `══════ Review complete in ${elapsed}s — score=${report.overallScore}, ${report.suggestions.length} suggestions ══════`)

      this.sendNotification(data, report)
      return reportId
    } catch (err: any) {
      this.repo.updateError(reportId, err.message)
      this.progress = { status: 'failed', currentReportId: reportId, error: err.message }
      logger.error(this.TAG, 'Review failed:', err.message)
      throw err
    }
  }

  private sendNotification(data: ReviewDataSummary, report: ReviewReport): void {
    if (!this.notifier) return
    const { overview } = data
    const top3 = report.suggestions.slice(0, 3)
    const msg = [
      `📊 复盘报告 (${data.periodStart} ~ ${data.periodEnd})`,
      `评分: ${report.overallScore}/100 | PnL: $${overview.totalPnl.toFixed(2)} | 胜率: ${(overview.winRate * 100).toFixed(1)}%`,
      overview.bestWallet ? `最佳钱包: ${overview.bestWallet.label} ($${overview.bestWallet.pnl.toFixed(2)})` : '',
      overview.worstWallet ? `最差钱包: ${overview.worstWallet.label} ($${overview.worstWallet.pnl.toFixed(2)})` : '',
      top3.length > 0 ? `\n改进建议:` : '',
      ...top3.map((s, i) => `${i + 1}. ${s.description}`),
      `\n详情: http://localhost:3000/review`,
    ].filter(Boolean).join('\n')
    this.notifier.notify(msg)
  }
}

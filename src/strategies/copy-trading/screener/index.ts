import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ScreenerConfig, ScreenerState, ScreenerResult } from './types'
import { DataFetcher } from './data-fetcher'
import { ScoringEngine } from './scoring-engine'
import { LLMAnalyzer } from './llm-analyzer'
import { logger } from '../../../infrastructure/logger'

const RESULTS_PATH = './data/screener-results.json'
const SCHEDULE_INTERVAL_MS = 24 * 60 * 60 * 1000
const TOP_N_FOR_LLM = 20

const RECOMMENDATION_ORDER: Record<string, number> = {
  recommended: 0,
  cautious: 1,
  not_recommended: 2,
}

const DEFAULT_CONFIG: ScreenerConfig = {
  enabled: false,
  scheduleCron: 'disabled',
  lastRunAt: null,
  closedPositionsLimit: 200,
}

export class ScreenerService {
  private fetcher: DataFetcher
  private scorer: ScoringEngine
  private analyzer: LLMAnalyzer
  private timer: ReturnType<typeof setInterval> | null = null

  private state: ScreenerState = {
    status: 'idle',
    progress: 0,
    progressLabel: '',
    results: [],
    lastError: null,
  }

  private config: ScreenerConfig = { ...DEFAULT_CONFIG }

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.fetcher = new DataFetcher(this.config.closedPositionsLimit)
    this.scorer = new ScoringEngine()
    this.analyzer = new LLMAnalyzer(apiKey, model, baseUrl)
    this.loadResults()
  }

  getState(): ScreenerState {
    return { ...this.state, results: [...this.state.results] }
  }

  getConfig(): ScreenerConfig {
    return { ...this.config }
  }

  private readonly TAG = 'Screener'

  updateLLM(apiKey: string, model?: string, baseUrl?: string): void {
    this.analyzer = new LLMAnalyzer(apiKey, model, baseUrl)
    logger.info(this.TAG, `LLM analyzer updated (model=${model ?? 'default'}, baseUrl=${baseUrl ?? 'default'})`)
  }

  updateConfig(cfg: Partial<ScreenerConfig>): void {
    const oldLimit = this.config.closedPositionsLimit
    this.config = { ...this.config, ...cfg }
    this.saveResults()

    // Rebuild DataFetcher if closedPositionsLimit changed
    if (this.config.closedPositionsLimit !== oldLimit) {
      this.fetcher = new DataFetcher(this.config.closedPositionsLimit)
      logger.info(this.TAG, `DataFetcher rebuilt with closedPositionsLimit=${this.config.closedPositionsLimit}`)
    }

    // Restart scheduler if schedule setting changed
    this.stop()
    if (this.config.enabled && this.config.scheduleCron === 'daily') {
      this.start()
    }
  }

  start(): void {
    if (this.timer != null) return // double-start guard
    if (this.config.scheduleCron !== 'daily') return

    logger.info(this.TAG, 'Starting daily schedule')
    this.timer = setInterval(() => {
      this.run().catch((err) =>
        logger.error(this.TAG, 'Scheduled run failed:', err instanceof Error ? err.message : String(err)),
      )
    }, SCHEDULE_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
      logger.info(this.TAG, 'Stopped schedule')
    }
  }

  async run(): Promise<ScreenerResult[]> {
    if (this.state.status === 'running') {
      logger.warn(this.TAG, 'Already running, ignoring duplicate run request')
      return this.state.results
    }

    const t0 = Date.now()
    logger.info(this.TAG, '══════════════ Screener pipeline starting ══════════════')
    this.state.status = 'running'
    this.state.progress = 0
    this.state.progressLabel = 'Starting screener pipeline...'
    this.state.lastError = null

    try {
      // Stage 1 (10%): Fetch leaderboard
      this.state.progress = 10
      this.state.progressLabel = 'Fetching leaderboard...'
      logger.info(this.TAG, '[Stage 1/4] Fetching Polymarket leaderboard')
      const leaderboard = await this.fetcher.getLeaderboard()
      logger.info(this.TAG, `[Stage 1/4] Done — ${leaderboard.length} entries fetched`)

      // Stage 2 (20→60%): Build profiles
      this.state.progress = 20
      this.state.progressLabel = 'Building trader profiles...'
      logger.info(this.TAG, `[Stage 2/4] Building profiles for top ${leaderboard.length} traders`)
      const profiles = await this.fetcher.buildProfiles(leaderboard, 5)
      this.state.progress = 60
      logger.info(this.TAG, `[Stage 2/4] Done — ${profiles.length} profiles built`)

      // Stage 3 (60%): Score and take top N
      this.state.progressLabel = 'Scoring traders...'
      logger.info(this.TAG, `[Stage 3/4] Scoring ${profiles.length} profiles`)
      const scored = this.scorer.score(profiles)
      const topN = scored.slice(0, TOP_N_FOR_LLM)
      logger.info(this.TAG, `[Stage 3/4] Done — top ${topN.length} selected (cutoff score=${topN[topN.length - 1]?.totalScore ?? 'N/A'})`)

      // Stage 4 (70%): LLM analysis
      this.state.progress = 70
      this.state.progressLabel = 'Running LLM analysis...'
      logger.info(this.TAG, `[Stage 4/4] LLM analysis for ${topN.length} traders`)
      const results = await this.analyzer.analyze(topN)

      results.sort((a, b) => {
        const levelDiff =
          (RECOMMENDATION_ORDER[a.recommendation.level] ?? 1) -
          (RECOMMENDATION_ORDER[b.recommendation.level] ?? 1)
        if (levelDiff !== 0) return levelDiff
        return b.totalScore - a.totalScore
      })

      this.state.status = 'done'
      this.state.progress = 100
      this.state.progressLabel = 'Complete'
      this.state.results = results
      this.config.lastRunAt = Math.floor(Date.now() / 1000)

      this.saveResults()

      const recommended = results.filter(r => r.recommendation.level === 'recommended').length
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      logger.info(this.TAG, `══════ Pipeline complete in ${elapsed}s — ${results.length} results, ${recommended} recommended ══════`)

      return results
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.state.status = 'error'
      this.state.lastError = message
      this.state.progressLabel = 'Error'
      logger.error(this.TAG, 'Pipeline failed:', message)
      return this.state.results
    }
  }

  private loadResults(): void {
    if (!existsSync(RESULTS_PATH)) return
    try {
      const raw = readFileSync(RESULTS_PATH, 'utf-8')
      const data = JSON.parse(raw) as {
        results?: ScreenerResult[]
        config?: ScreenerConfig
      }
      if (Array.isArray(data.results)) {
        this.state.results = data.results
        this.state.status = data.results.length > 0 ? 'done' : 'idle'
        this.state.progress = data.results.length > 0 ? 100 : 0
      }
      if (data.config) {
        this.config = { ...DEFAULT_CONFIG, ...data.config }
      }
      logger.info(this.TAG, `Loaded ${this.state.results.length} cached results from disk`)
    } catch {
      logger.error(this.TAG, 'Failed to load results from disk')
    }
  }

  private saveResults(): void {
    try {
      const dir = dirname(RESULTS_PATH)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const data = { results: this.state.results, config: this.config }
      writeFileSync(RESULTS_PATH, JSON.stringify(data, null, 2), 'utf-8')
      logger.debug(this.TAG, `Results saved to ${RESULTS_PATH}`)
    } catch (err) {
      logger.error(this.TAG, 'Failed to save results to disk:', err instanceof Error ? err.message : String(err))
    }
  }
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ScreenerConfig, ScreenerState, ScreenerResult } from './types'
import { DataFetcher } from './data-fetcher'
import { ScoringEngine } from './scoring-engine'
import { LLMAnalyzer } from './llm-analyzer'

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
    this.fetcher = new DataFetcher()
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

  updateLLM(apiKey: string, model?: string, baseUrl?: string): void {
    this.analyzer = new LLMAnalyzer(apiKey, model, baseUrl)
    console.log(`[Screener] LLM analyzer updated (model: ${model ?? 'default'}, baseUrl: ${baseUrl ?? 'default'})`)
  }

  updateConfig(cfg: Partial<ScreenerConfig>): void {
    this.config = { ...this.config, ...cfg }
    this.saveResults()

    // Restart scheduler if schedule setting changed
    this.stop()
    if (this.config.enabled && this.config.scheduleCron === 'daily') {
      this.start()
    }
  }

  start(): void {
    if (this.timer != null) return // double-start guard
    if (this.config.scheduleCron !== 'daily') return

    console.log('[Screener] Starting daily schedule')
    this.timer = setInterval(() => {
      this.run().catch((err) =>
        console.error('[Screener] Scheduled run failed:', err),
      )
    }, SCHEDULE_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
      console.log('[Screener] Stopped schedule')
    }
  }

  async run(): Promise<ScreenerResult[]> {
    // Guard: if already running, return current results
    if (this.state.status === 'running') {
      console.log('[Screener] Already running, returning current results')
      return this.state.results
    }

    this.state.status = 'running'
    this.state.progress = 0
    this.state.progressLabel = 'Starting screener pipeline...'
    this.state.lastError = null

    try {
      // Stage 1 (10%): Fetch leaderboard
      this.state.progress = 10
      this.state.progressLabel = 'Fetching leaderboard...'
      console.log('[Screener] Stage 1: Fetching leaderboard')
      const leaderboard = await this.fetcher.getLeaderboard()
      console.log(`[Screener] Fetched ${leaderboard.length} leaderboard entries`)

      // Stage 2 (20→60%): Build profiles
      this.state.progress = 20
      this.state.progressLabel = 'Building trader profiles...'
      console.log('[Screener] Stage 2: Building profiles')
      const profiles = await this.fetcher.buildProfiles(leaderboard, 5)
      this.state.progress = 60
      console.log(`[Screener] Built ${profiles.length} profiles`)

      // Stage 3 (60%): Score and take top N
      this.state.progressLabel = 'Scoring traders...'
      console.log('[Screener] Stage 3: Scoring traders')
      const scored = this.scorer.score(profiles)
      const topN = scored.slice(0, TOP_N_FOR_LLM)
      console.log(`[Screener] Scored ${scored.length} traders, top ${topN.length} selected for LLM analysis`)

      // Stage 4 (70%): LLM analysis
      this.state.progress = 70
      this.state.progressLabel = 'Running LLM analysis...'
      console.log('[Screener] Stage 4: LLM analysis')
      const results = await this.analyzer.analyze(topN)

      // Sort results: by recommendation level (recommended < cautious < not_recommended),
      // then by totalScore descending
      results.sort((a, b) => {
        const levelDiff =
          (RECOMMENDATION_ORDER[a.recommendation.level] ?? 1) -
          (RECOMMENDATION_ORDER[b.recommendation.level] ?? 1)
        if (levelDiff !== 0) return levelDiff
        return b.totalScore - a.totalScore
      })

      // Done
      this.state.status = 'done'
      this.state.progress = 100
      this.state.progressLabel = 'Complete'
      this.state.results = results
      this.config.lastRunAt = Math.floor(Date.now() / 1000)

      this.saveResults()
      console.log(`[Screener] Pipeline complete: ${results.length} results`)

      return results
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.state.status = 'error'
      this.state.lastError = message
      this.state.progressLabel = 'Error'
      console.error('[Screener] Pipeline failed:', err)
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
      console.log(
        `[Screener] Loaded ${this.state.results.length} results from disk`,
      )
    } catch {
      console.error('[Screener] Failed to load results from disk')
    }
  }

  private saveResults(): void {
    try {
      const dir = dirname(RESULTS_PATH)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const data = { results: this.state.results, config: this.config }
      writeFileSync(RESULTS_PATH, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Screener] Failed to save results to disk:', err)
    }
  }
}

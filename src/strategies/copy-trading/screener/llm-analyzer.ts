import Anthropic from '@anthropic-ai/sdk'
import type {
  ScoredTrader,
  ScreenerResult,
  ScreenerResultDetail,
  LLMRecommendation,
  TraderMetrics,
  TraderProfile,
  PeriodStats,
  ClosedPosition,
  ClosedPositionSummary,
} from './types'
import { logger } from '../../../infrastructure/logger'

const BATCH_SIZE = 5

interface LLMResponseItem {
  address: string
  level: 'recommended' | 'cautious' | 'not_recommended'
  reasoning: string
  suggestedSizeMode: 'fixed' | 'proportional'
  suggestedAmount: number
  suggestedMaxCopiesPerMarket: number
  riskWarning: string
}

export class LLMAnalyzer {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514', baseUrl?: string) {
    this.client = new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) })
    this.model = model
  }

  private readonly TAG = 'LLMAnalyzer'

  async analyze(traders: ScoredTrader[]): Promise<ScreenerResult[]> {
    logger.info(this.TAG, `Starting LLM analysis for ${traders.length} traders (batch size=${BATCH_SIZE}, model=${this.model})`)
    const results: ScreenerResult[] = []
    const totalBatches = Math.ceil(traders.length / BATCH_SIZE)

    for (let i = 0; i < traders.length; i += BATCH_SIZE) {
      const batch = traders.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      logger.info(this.TAG, `LLM batch ${batchNum}/${totalBatches}: analyzing ${batch.map(t => t.profile.entry.username || t.profile.entry.address.slice(0, 8)).join(', ')}`)
      const batchResults = await this.analyzeBatch(batch)
      results.push(...batchResults)
      logger.info(this.TAG, `LLM batch ${batchNum}/${totalBatches} done`)
    }

    logger.info(this.TAG, `LLM analysis complete: ${results.length} results`)
    return results
  }

  private async analyzeBatch(batch: ScoredTrader[]): Promise<ScreenerResult[]> {
    const llmInputs = batch.map((t) => this.formatTraderData(t))
    const tradersText = llmInputs
      .map((text, idx) => `--- Trader ${idx + 1} ---\n${text}`)
      .join('\n\n')

    const prompt = `你是一个专业的加密货币交易分析师。请分析以下 Polymarket 交易者的数据，并为每位交易者提供跟单建议。

分析要求：
- 根据综合评分和交易活跃度进行推荐
- 对于大资金组合（总持仓价值 > $10,000），建议使用 proportional（比例）模式
- 对于小资金组合（总持仓价值 <= $10,000），建议使用 fixed（固定）模式
- 如果 diversification（分散度）评分低，降低建议金额
- 对于胜率高但交易次数少的交易者，保持谨慎态度
- suggestedAmount: fixed 模式下为 USDC 金额（建议 5-50），proportional 模式下为比例（0.01-0.1）
- suggestedMaxCopiesPerMarket: 建议 1-3 之间

交易者数据：

${tradersText}

请严格按照以下 JSON 数组格式返回分析结果（不要包含任何其他文字）：
[
  {
    "address": "交易者地址",
    "level": "recommended 或 cautious 或 not_recommended",
    "reasoning": "中文推荐理由",
    "suggestedSizeMode": "fixed 或 proportional",
    "suggestedAmount": 数字,
    "suggestedMaxCopiesPerMarket": 数字,
    "riskWarning": "中文风险提示"
  }
]`

    logger.debug(this.TAG, `Sending request to LLM (${this.model}), prompt length=${prompt.length} chars`)
    const t0 = Date.now()

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })

      const elapsed = Date.now() - t0
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')

      logger.debug(this.TAG, `LLM responded in ${elapsed}ms, response length=${text.length} chars`)

      const parsed = this.parseResponse(text)
      logger.info(this.TAG, `Parsed ${parsed.length}/${batch.length} recommendations from LLM response`)
      return this.mapToResults(batch, parsed, llmInputs, text)
    } catch (error) {
      const elapsed = Date.now() - t0
      logger.error(this.TAG, `API call failed after ${elapsed}ms, using fallback:`, error instanceof Error ? error.message : String(error))
      return batch.map((t, idx) => this.buildFallbackResult(t, llmInputs[idx] ?? ''))
    }
  }

  private parseResponse(text: string): LLMResponseItem[] {
    // Try to extract JSON array — handle both raw JSON and markdown code blocks
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (!arrayMatch) {
      logger.warn(this.TAG, 'Could not extract JSON array from response, raw text preview:', text.slice(0, 200))
      return []
    }

    try {
      const items: LLMResponseItem[] = JSON.parse(arrayMatch[0])
      logger.debug(this.TAG, `JSON parse succeeded: ${items.length} items`)
      return items
    } catch (e) {
      logger.warn(this.TAG, 'Failed to parse JSON response:', e instanceof Error ? e.message : String(e))
      return []
    }
  }

  private buildDetail(trader: ScoredTrader, llmInput: string, llmRaw: string): ScreenerResultDetail {
    return {
      positions: trader.profile.positions,
      trades: trader.profile.recentTrades,
      llmInput,
      llmRaw,
    }
  }

  private mapToResults(
    batch: ScoredTrader[],
    parsed: LLMResponseItem[],
    llmInputs: string[],
    llmResponseText: string,
  ): ScreenerResult[] {
    const now = Math.floor(Date.now() / 1000)
    const parsedMap = new Map(parsed.map((item) => [item.address, item]))

    return batch.map((trader, idx) => {
      const item = parsedMap.get(trader.profile.entry.address)
      const llmInput = llmInputs[idx] ?? ''

      if (item) {
        logger.debug(this.TAG, `Mapped result for ${trader.profile.entry.username || trader.profile.entry.address.slice(0, 10)}: level=${item.level}`)
        const recommendation: LLMRecommendation = {
          level: item.level,
          reasoning: item.reasoning,
          suggestedSizeMode: item.suggestedSizeMode,
          suggestedAmount: item.suggestedAmount,
          suggestedMaxCopiesPerMarket: item.suggestedMaxCopiesPerMarket,
          riskWarning: item.riskWarning,
        }

        return {
          address: trader.profile.entry.address,
          username: trader.profile.entry.username,
          profileImage: trader.profile.entry.profileImage,
          rank: trader.profile.entry.rank,
          pnl: trader.profile.entry.pnl,
          volume: trader.profile.entry.volume,
          totalPortfolioValue: trader.profile.totalPortfolioValue,
          scores: trader.scores,
          totalScore: trader.totalScore,
          metrics: this.computeMetrics(trader.profile),
          recommendation,
          detail: this.buildDetail(trader, llmInput, JSON.stringify(item, null, 2)),
          screenedAt: now,
        }
      }

      logger.warn(this.TAG, `No LLM result for ${trader.profile.entry.username || trader.profile.entry.address.slice(0, 10)}, using fallback`)
      return this.buildFallbackResult(trader, llmInput, llmResponseText)
    })
  }

  private buildFallbackResult(trader: ScoredTrader, llmInput = '', llmResponseText = ''): ScreenerResult {
    const now = Math.floor(Date.now() / 1000)
    const isLargePortfolio = trader.profile.totalPortfolioValue > 10_000

    const recommendation: LLMRecommendation = {
      level: 'cautious',
      reasoning: 'LLM 分析暂不可用，基于评分数据提供保守建议。请人工审核后再决定是否跟单。',
      suggestedSizeMode: isLargePortfolio ? 'proportional' : 'fixed',
      suggestedAmount: isLargePortfolio ? 0.02 : 10,
      suggestedMaxCopiesPerMarket: 1,
      riskWarning: '此建议由备用逻辑生成，未经 LLM 深度分析，请谨慎参考。',
    }

    return {
      address: trader.profile.entry.address,
      username: trader.profile.entry.username,
      profileImage: trader.profile.entry.profileImage,
      rank: trader.profile.entry.rank,
      pnl: trader.profile.entry.pnl,
      volume: trader.profile.entry.volume,
      totalPortfolioValue: trader.profile.totalPortfolioValue,
      scores: trader.scores,
      totalScore: trader.totalScore,
      metrics: this.computeMetrics(trader.profile),
      recommendation,
      detail: this.buildDetail(trader, llmInput, llmResponseText),
      screenedAt: now,
    }
  }

  private computePeriodStats(trades: TraderProfile['recentTrades'], closedPositions: ClosedPosition[], cutoffSeconds: number): PeriodStats {
    const inPeriod = trades.filter((t) => t.timestamp >= cutoffSeconds)
    let buyCount = 0, sellCount = 0, buyVolume = 0, sellVolume = 0
    for (const t of inPeriod) {
      if (t.side === 'buy') { buyCount++; buyVolume += t.size }
      else { sellCount++; sellVolume += t.size }
    }

    // Win/loss from closed (settled) positions in this period
    const closedInPeriod = closedPositions.filter((p) => p.timestamp >= cutoffSeconds)
    let winCount = 0, winPnl = 0, lossCount = 0, lossPnl = 0
    for (const p of closedInPeriod) {
      if (p.realizedPnl > 0) { winCount++; winPnl += p.realizedPnl }
      else { lossCount++; lossPnl += Math.abs(p.realizedPnl) }
    }

    return {
      tradeCount: inPeriod.length,
      buyCount,
      sellCount,
      volume: buyVolume + sellVolume,
      netFlow: sellVolume - buyVolume,
      winCount,
      winPnl,
      lossCount,
      lossPnl,
    }
  }

  private computeMetrics(profile: TraderProfile): TraderMetrics {
    const trades = profile.recentTrades
    const closed = profile.closedPositions ?? []
    const tradeCount = trades.length
    const uniqueMarkets = new Set(profile.positions.map((p) => p.conditionId)).size
    const avgTradeSize =
      trades.length > 0
        ? trades.reduce((sum, t) => sum + t.size, 0) / trades.length
        : 0
    const nowSeconds = Math.floor(Date.now() / 1000)
    const mostRecent =
      trades.length > 0
        ? trades.reduce((max, t) => (t.timestamp > max ? t.timestamp : max), 0)
        : 0
    const daysSinceLastTrade =
      mostRecent > 0 ? Math.floor((nowSeconds - mostRecent) / 86_400) : 999

    const periods = {
      day:   this.computePeriodStats(trades, closed, nowSeconds - 86_400),
      week:  this.computePeriodStats(trades, closed, nowSeconds - 7 * 86_400),
      month: this.computePeriodStats(trades, closed, nowSeconds - 30 * 86_400),
    }

    const closedPositionSummary = this.computeClosedPositionSummary(closed)

    return { tradeCount, uniqueMarkets, avgTradeSize, daysSinceLastTrade, periods, closedPositionSummary }
  }

  private computeClosedPositionSummary(closed: ClosedPosition[]): ClosedPositionSummary {
    const total = closed.length
    let wins = 0, losses = 0, totalPnl = 0
    for (const p of closed) {
      totalPnl += p.realizedPnl
      if (p.realizedPnl > 0) wins++
      else losses++
    }
    return {
      total,
      wins,
      losses,
      totalPnl,
      winRate: total > 0 ? wins / total : 0,
      avgPnlPerTrade: total > 0 ? totalPnl / total : 0,
    }
  }

  private formatTraderData(trader: ScoredTrader): string {
    const { profile, scores, totalScore } = trader
    const { entry, positions, recentTrades, totalPortfolioValue } = profile

    const lines: string[] = [
      `Address: ${entry.address}`,
      `Username: ${entry.username}`,
      `Rank: #${entry.rank}`,
      `PnL: $${entry.pnl.toFixed(2)}`,
      `Volume: $${entry.volume.toFixed(2)}`,
      `Portfolio Value: $${totalPortfolioValue.toFixed(2)}`,
      '',
      `Scores:`,
      `  Returns: ${scores.returns.toFixed(1)} / 100`,
      `  Activity: ${scores.activity.toFixed(1)} / 100`,
      `  Portfolio Size: ${scores.portfolioSize.toFixed(1)} / 100`,
      `  Diversification: ${scores.diversification.toFixed(1)} / 100`,
      `  Total: ${totalScore.toFixed(1)} / 100`,
    ]

    // Top 5 positions
    const topPositions = positions.slice(0, 5)
    if (topPositions.length > 0) {
      lines.push('', 'Top Positions:')
      for (const pos of topPositions) {
        lines.push(
          `  - ${pos.title} [${pos.outcome}] size=$${pos.size.toFixed(2)} value=$${pos.currentValue.toFixed(2)}`,
        )
      }
    }

    // Last 10 trades
    const lastTrades = recentTrades.slice(0, 10)
    if (lastTrades.length > 0) {
      lines.push('', 'Recent Trades:')
      for (const trade of lastTrades) {
        const date = new Date(trade.timestamp * 1000).toISOString().slice(0, 10)
        lines.push(
          `  - [${date}] ${trade.side.toUpperCase()} ${trade.title} [${trade.outcome}] size=$${trade.size.toFixed(2)} @${trade.price.toFixed(3)}`,
        )
      }
    }

    // Closed positions summary (settled markets)
    const closed = profile.closedPositions ?? []
    if (closed.length > 0) {
      const summary = this.computeClosedPositionSummary(closed)
      lines.push(
        '',
        'Closed Positions (Settled Markets):',
        `  Total: ${summary.total} (Win: ${summary.wins}, Loss: ${summary.losses})`,
        `  Win Rate: ${(summary.winRate * 100).toFixed(1)}%`,
        `  Total Realized PnL: $${summary.totalPnl.toFixed(2)}`,
        `  Avg PnL per Position: $${summary.avgPnlPerTrade.toFixed(2)}`,
      )
      // Top 5 closed positions by absolute PnL
      const topClosed = [...closed].sort((a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl)).slice(0, 5)
      for (const cp of topClosed) {
        const pnlSign = cp.realizedPnl >= 0 ? '+' : ''
        lines.push(
          `  - ${cp.title} [${cp.outcome}] avgPrice=${cp.avgPrice.toFixed(3)} pnl=${pnlSign}$${cp.realizedPnl.toFixed(2)}`,
        )
      }
    }

    return lines.join('\n')
  }
}

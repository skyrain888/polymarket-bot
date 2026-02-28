import Anthropic from '@anthropic-ai/sdk'
import type {
  ScoredTrader,
  ScreenerResult,
  LLMRecommendation,
} from './types'

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

  async analyze(traders: ScoredTrader[]): Promise<ScreenerResult[]> {
    const results: ScreenerResult[] = []

    for (let i = 0; i < traders.length; i += BATCH_SIZE) {
      const batch = traders.slice(i, i + BATCH_SIZE)
      const batchResults = await this.analyzeBatch(batch)
      results.push(...batchResults)
    }

    return results
  }

  private async analyzeBatch(batch: ScoredTrader[]): Promise<ScreenerResult[]> {
    const tradersText = batch
      .map((t, idx) => `--- Trader ${idx + 1} ---\n${this.formatTraderData(t)}`)
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

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')

      const parsed = this.parseResponse(text)
      return this.mapToResults(batch, parsed)
    } catch (error) {
      console.error('[LLMAnalyzer] API call failed, using fallback:', error)
      return batch.map((t) => this.buildFallbackResult(t))
    }
  }

  private parseResponse(text: string): LLMResponseItem[] {
    // Try to extract JSON array — handle both raw JSON and markdown code blocks
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (!arrayMatch) {
      console.warn('[LLMAnalyzer] Could not extract JSON array from response')
      return []
    }

    try {
      const items: LLMResponseItem[] = JSON.parse(arrayMatch[0])
      return items
    } catch (e) {
      console.warn('[LLMAnalyzer] Failed to parse JSON response:', e)
      return []
    }
  }

  private mapToResults(
    batch: ScoredTrader[],
    parsed: LLMResponseItem[],
  ): ScreenerResult[] {
    const now = Math.floor(Date.now() / 1000)
    const parsedMap = new Map(parsed.map((item) => [item.address, item]))

    return batch.map((trader) => {
      const item = parsedMap.get(trader.profile.entry.address)

      if (item) {
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
          recommendation,
          screenedAt: now,
        }
      }

      return this.buildFallbackResult(trader)
    })
  }

  private buildFallbackResult(trader: ScoredTrader): ScreenerResult {
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
      recommendation,
      screenedAt: now,
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

    return lines.join('\n')
  }
}

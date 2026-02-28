import Anthropic from '@anthropic-ai/sdk'
import type { ReviewDataSummary, StrategyReport, WalletScore } from '../types'
import { logger } from '../../../infrastructure/logger'

export class StrategyAnalyzer {
  private readonly TAG = 'StrategyAnalyzer'

  constructor(
    private getLLMConfig: () => { provider: string; apiKey: string; model: string; baseURL?: string },
  ) {}

  async analyze(data: ReviewDataSummary): Promise<StrategyReport> {
    const config = this.getLLMConfig()
    const client = new Anthropic({ apiKey: config.apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}) })
    const prompt = this.buildPrompt(data)

    logger.info(this.TAG, `Starting strategy analysis (model=${config.model}, prompt=${prompt.length} chars)`)
    const t0 = Date.now()

    try {
      const response = await client.messages.create({
        model: config.model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('')

      logger.info(this.TAG, `LLM responded in ${Date.now() - t0}ms`)
      return this.parseResponse(text)
    } catch (error) {
      logger.error(this.TAG, `LLM call failed:`, error instanceof Error ? error.message : String(error))
      return this.fallbackReport(data)
    }
  }

  private buildPrompt(data: ReviewDataSummary): string {
    const walletDetails = data.copyTrades.map(w => {
      const marketBreakdown = new Map<string, { count: number; pnl: number }>()
      for (const t of w.trades) {
        const entry = marketBreakdown.get(t.title ?? t.marketId) ?? { count: 0, pnl: 0 }
        entry.count++
        entry.pnl += t.pnl ?? 0
        marketBreakdown.set(t.title ?? t.marketId, entry)
      }
      const topMarkets = [...marketBreakdown.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([name, d]) => `  ${name.slice(0, 40)}: ${d.count}笔, PnL $${d.pnl.toFixed(2)}`)
        .join('\n')

      return `钱包 ${w.label} (${w.walletAddress.slice(0, 10)}...):
  交易数: ${w.totalTrades}, 总PnL: $${w.totalPnl.toFixed(2)}, 胜率: ${(w.winRate * 100).toFixed(1)}%
  总投入: $${w.totalCopiedSize.toFixed(2)}, 赢${w.winCount}笔/亏${w.lossCount}笔
  热门市场:\n${topMarkets || '  无'}`
    }).join('\n\n')

    const signalStats = Object.entries(data.signals.byProvider)
      .map(([provider, s]) => `${provider}: ${s.count}条信号, 平均置信度 ${(s.avgConfidence * 100).toFixed(1)}%`)
      .join('\n')

    return `你是一个专业的加密货币交易策略分析师。请对以下周期内的跟单策略行为进行深度分析。

分析周期: ${data.periodStart} ~ ${data.periodEnd}

=== 总览 ===
总 PnL: $${data.overview.totalPnl.toFixed(2)}
总交易数: ${data.overview.totalTrades}
跟单钱包数: ${data.copyTrades.length}

=== 各钱包详情 ===
${walletDetails || '无跟单数据'}

=== 信号统计 ===
${signalStats || '无信号数据'}

请从以下维度进行分析：
1. 各跟单钱包表现对比（收益率、胜率、活跃度排名）
2. 信号准确率（如有信号数据）
3. 市场选择偏好（哪类市场表现好/差）
4. 交易时机分析
5. 跟单参数合理性（比例、限额是否需要调整）

请严格按照以下 JSON 格式返回（不要包含任何其他文字）：
{
  "overallScore": 0到100的评分,
  "walletScores": [
    {
      "address": "钱包地址",
      "label": "钱包标签",
      "score": 0到100,
      "pnl": PnL数字,
      "winRate": 胜率(0-1),
      "assessment": "中文评价"
    }
  ],
  "walletComparison": "钱包对比分析文字",
  "signalAccuracy": "信号准确率分析文字",
  "marketPreference": "市场偏好分析文字",
  "timingAnalysis": "交易时机分析文字",
  "parameterAssessment": "参数合理性评估文字",
  "summary": "总结文字"
}`
  }

  private parseResponse(text: string): StrategyReport {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.warn(this.TAG, 'Could not extract JSON from response')
      throw new Error('Failed to parse strategy analysis response')
    }
    try {
      return JSON.parse(jsonMatch[0]) as StrategyReport
    } catch (e) {
      logger.warn(this.TAG, 'JSON parse failed:', e instanceof Error ? e.message : String(e))
      throw new Error('Failed to parse strategy analysis JSON')
    }
  }

  private fallbackReport(data: ReviewDataSummary): StrategyReport {
    const walletScores: WalletScore[] = data.copyTrades.map(w => ({
      address: w.walletAddress,
      label: w.label,
      score: 50,
      pnl: w.totalPnl,
      winRate: w.winRate,
      assessment: 'LLM 分析不可用',
    }))

    return {
      overallScore: 50,
      walletScores,
      walletComparison: 'LLM 分析不可用，无法生成钱包对比',
      signalAccuracy: 'LLM 分析不可用，无法生成信号准确率分析',
      marketPreference: 'LLM 分析不可用，无法生成市场偏好分析',
      timingAnalysis: 'LLM 分析不可用，无法生成时机分析',
      parameterAssessment: 'LLM 分析不可用，无法生成参数评估',
      summary: `共 ${data.copyTrades.length} 个跟单钱包，总 PnL $${data.overview.totalPnl.toFixed(2)}（LLM 分析失败，仅展示基础数据）`,
    }
  }
}

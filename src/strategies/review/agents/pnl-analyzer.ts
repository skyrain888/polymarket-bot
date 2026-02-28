import Anthropic from '@anthropic-ai/sdk'
import type { ReviewDataSummary, PnLReport } from '../types'
import { logger } from '../../../infrastructure/logger'

export class PnLAnalyzer {
  private readonly TAG = 'PnLAnalyzer'

  constructor(
    private getLLMConfig: () => { provider: string; apiKey: string; model: string; baseURL?: string },
  ) {}

  async analyze(data: ReviewDataSummary): Promise<PnLReport> {
    const config = this.getLLMConfig()
    const client = new Anthropic({ apiKey: config.apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}) })
    const prompt = this.buildPrompt(data)

    logger.info(this.TAG, `Starting PnL analysis (model=${config.model}, prompt=${prompt.length} chars)`)
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
    const walletSummaries = data.copyTrades.map(w =>
      `钱包 ${w.label}: 交易${w.totalTrades}笔, 总PnL $${w.totalPnl.toFixed(2)}, 胜率${(w.winRate * 100).toFixed(1)}%, 总投入 $${w.totalCopiedSize.toFixed(2)}`
    ).join('\n')

    const topTrades = data.copyTrades
      .flatMap(w => w.trades.map(t => ({ ...t, walletLabel: w.label })))
      .sort((a, b) => Math.abs(b.pnl ?? 0) - Math.abs(a.pnl ?? 0))
      .slice(0, 20)
      .map(t => `${t.walletLabel} | ${t.side} ${t.title?.slice(0, 30)} | 投入$${t.copiedSize.toFixed(2)} @ ${t.price.toFixed(3)} | PnL $${(t.pnl ?? 0).toFixed(2)}`)
      .join('\n')

    const orderStats = data.orders.map(o =>
      `策略 ${o.strategyId}: ${o.totalOrders}笔 (执行${o.executedCount}, 拒绝${o.rejectedCount})`
    ).join('\n')

    return `你是一个专业的加密货币交易收益分析师。请对以下周期内的交易数据进行深度收益与风险分析。

分析周期: ${data.periodStart} ~ ${data.periodEnd}

=== 总览 ===
总 PnL: $${data.overview.totalPnl.toFixed(2)}
总交易数: ${data.overview.totalTrades}
总胜率: ${(data.overview.winRate * 100).toFixed(1)}%
最佳钱包: ${data.overview.bestWallet ? `${data.overview.bestWallet.label} ($${data.overview.bestWallet.pnl.toFixed(2)})` : '无'}
最差钱包: ${data.overview.worstWallet ? `${data.overview.worstWallet.label} ($${data.overview.worstWallet.pnl.toFixed(2)})` : '无'}

=== 各钱包汇总 ===
${walletSummaries || '无跟单数据'}

=== 影响最大的交易 (Top 20) ===
${topTrades || '无交易数据'}

=== 订单统计 ===
${orderStats || '无订单数据'}

=== 账户快照 ===
${data.accountSnapshots.map(s => `${s.snapshotDate}: 余额 $${s.balance.toFixed(2)}, 总PnL $${s.totalPnl.toFixed(2)}`).join('\n') || '无快照数据'}

请从以下维度进行分析：
1. 盈亏归因：哪些交易/市场贡献了最大盈亏
2. 风险暴露：资金集中度、最大单笔亏损
3. 回撤分析：最大回撤幅度
4. 收益稳定性：日收益波动、夏普比率估算

请严格按照以下 JSON 格式返回（不要包含任何其他文字）：
{
  "overallScore": 0到100的评分,
  "totalPnl": 总PnL数字,
  "winRate": 胜率(0-1),
  "maxDrawdown": 最大回撤百分比,
  "sharpeEstimate": 夏普比率估算,
  "profitAttribution": "盈亏归因分析文字",
  "riskExposure": "风险暴露分析文字",
  "drawdownAnalysis": "回撤分析文字",
  "stabilityAnalysis": "收益稳定性分析文字",
  "summary": "总结文字"
}`
  }

  private parseResponse(text: string): PnLReport {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.warn(this.TAG, 'Could not extract JSON from response')
      throw new Error('Failed to parse PnL analysis response')
    }
    try {
      return JSON.parse(jsonMatch[0]) as PnLReport
    } catch (e) {
      logger.warn(this.TAG, 'JSON parse failed:', e instanceof Error ? e.message : String(e))
      throw new Error('Failed to parse PnL analysis JSON')
    }
  }

  private fallbackReport(data: ReviewDataSummary): PnLReport {
    return {
      overallScore: 50,
      totalPnl: data.overview.totalPnl,
      winRate: data.overview.winRate,
      maxDrawdown: 0,
      sharpeEstimate: 0,
      profitAttribution: 'LLM 分析不可用，无法生成盈亏归因',
      riskExposure: 'LLM 分析不可用，无法生成风险暴露分析',
      drawdownAnalysis: 'LLM 分析不可用，无法生成回撤分析',
      stabilityAnalysis: 'LLM 分析不可用，无法生成稳定性分析',
      summary: `周期内总 PnL $${data.overview.totalPnl.toFixed(2)}，胜率 ${(data.overview.winRate * 100).toFixed(1)}%（LLM 分析失败，仅展示基础数据）`,
    }
  }
}

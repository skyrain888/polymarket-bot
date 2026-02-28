import Anthropic from '@anthropic-ai/sdk'
import type { ReviewDataSummary, PnLReport, StrategyReport, ReviewReport } from '../types'
import { logger } from '../../../infrastructure/logger'

export class Coordinator {
  private readonly TAG = 'Coordinator'

  constructor(
    private getLLMConfig: () => { provider: string; apiKey: string; model: string; baseURL?: string },
  ) {}

  async coordinate(
    data: ReviewDataSummary,
    pnlReport: PnLReport,
    strategyReport: StrategyReport,
  ): Promise<ReviewReport> {
    const config = this.getLLMConfig()
    const client = new Anthropic({ apiKey: config.apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}) })
    const prompt = this.buildPrompt(data, pnlReport, strategyReport)

    logger.info(this.TAG, `Starting coordination (model=${config.model}, prompt=${prompt.length} chars)`)
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
      return this.fallbackReport(pnlReport, strategyReport)
    }
  }

  private buildPrompt(data: ReviewDataSummary, pnlReport: PnLReport, strategyReport: StrategyReport): string {
    const walletList = data.copyTrades.map(w =>
      `${w.label}: PnL $${w.totalPnl.toFixed(2)}, 胜率 ${(w.winRate * 100).toFixed(1)}%, ${w.totalTrades}笔`
    ).join('\n')

    const walletScoreList = strategyReport.walletScores.map(w =>
      `${w.label}: 评分${w.score}, PnL $${w.pnl.toFixed(2)}, 评价: ${w.assessment}`
    ).join('\n')

    return `你是一个专业的加密货币交易系统顾问。请基于以下收益分析和策略分析的结果，生成综合复盘报告和可执行的改进建议。

分析周期: ${data.periodStart} ~ ${data.periodEnd}

=== 收益分析结果 ===
评分: ${pnlReport.overallScore}/100
总 PnL: $${pnlReport.totalPnl.toFixed(2)}, 胜率: ${(pnlReport.winRate * 100).toFixed(1)}%
最大回撤: ${pnlReport.maxDrawdown}%, 夏普比率: ${pnlReport.sharpeEstimate}
盈亏归因: ${pnlReport.profitAttribution}
风险暴露: ${pnlReport.riskExposure}
回撤分析: ${pnlReport.drawdownAnalysis}
稳定性: ${pnlReport.stabilityAnalysis}

=== 策略分析结果 ===
评分: ${strategyReport.overallScore}/100
钱包对比: ${strategyReport.walletComparison}
信号准确率: ${strategyReport.signalAccuracy}
市场偏好: ${strategyReport.marketPreference}
时机分析: ${strategyReport.timingAnalysis}
参数评估: ${strategyReport.parameterAssessment}

=== 当前跟单钱包 ===
${walletList || '无'}

=== 钱包评分 ===
${walletScoreList || '无'}

请生成：
1. 综合评价（整体表现评分和关键发现）
2. 可执行建议列表，每条建议必须包含具体的操作类型

建议类型限定为：
- adjust_ratio: 调整跟单比例（target 为钱包地址，suggestedValue 为新比例）
- pause_wallet: 暂停跟单某钱包（target 为钱包地址）
- resume_wallet: 恢复跟单某钱包（target 为钱包地址）
- adjust_risk_limit: 调整风险限额（target 为参数名如 maxDailyTradesPerWallet）
- adjust_poll_interval: 调整轮询间隔（suggestedValue 为秒数）
- system_improvement: 系统能力改进建议（无需 target/value）

请严格按照以下 JSON 格式返回（不要包含任何其他文字）：
{
  "overallScore": 0到100的综合评分,
  "keyFindings": ["关键发现1", "关键发现2", ...],
  "comprehensiveAssessment": "综合评价文字",
  "suggestions": [
    {
      "type": "建议类型",
      "description": "中文建议描述",
      "target": "目标参数（可选）",
      "currentValue": "当前值（可选）",
      "suggestedValue": "建议值（可选）",
      "confidence": "high 或 medium 或 low",
      "reasoning": "中文推理依据"
    }
  ]
}`
  }

  private parseResponse(text: string): ReviewReport {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.warn(this.TAG, 'Could not extract JSON from response')
      throw new Error('Failed to parse coordinator response')
    }
    try {
      return JSON.parse(jsonMatch[0]) as ReviewReport
    } catch (e) {
      logger.warn(this.TAG, 'JSON parse failed:', e instanceof Error ? e.message : String(e))
      throw new Error('Failed to parse coordinator JSON')
    }
  }

  private fallbackReport(pnlReport: PnLReport, strategyReport: StrategyReport): ReviewReport {
    return {
      overallScore: Math.round((pnlReport.overallScore + strategyReport.overallScore) / 2),
      keyFindings: ['LLM 协调分析不可用，仅展示基础汇总'],
      comprehensiveAssessment: `收益评分 ${pnlReport.overallScore}/100，策略评分 ${strategyReport.overallScore}/100（LLM 分析失败）`,
      suggestions: [],
    }
  }
}

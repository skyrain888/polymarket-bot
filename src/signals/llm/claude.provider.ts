import type { LLMProvider, MarketContext, AnalysisResult } from './provider.interface.ts'
import Anthropic from '@anthropic-ai/sdk'

const SYSTEM_PROMPT = `You are a prediction market analyst. Analyze the given market and return a JSON object with:
- sentiment: "bullish" | "bearish" | "neutral" (from YES perspective)
- confidence: 0-1 (how confident you are in your analysis)
- estimatedProbability: 0-1 (your estimate of YES outcome probability)
- summary: one sentence summary
- reasoning: 2-3 sentences of reasoning

Respond ONLY with valid JSON.`

export class ClaudeProvider implements LLMProvider {
  name = 'claude'
  private client: Anthropic

  constructor(private config: { apiKey: string; model: string }) {
    this.client = new Anthropic({ apiKey: config.apiKey })
  }

  async analyze(ctx: MarketContext): Promise<AnalysisResult> {
    const prompt = `Market: ${ctx.question}
Category: ${ctx.category}
Current YES price: ${ctx.yesPrice} (implies ${(ctx.yesPrice * 100).toFixed(1)}% probability)
End date: ${ctx.endDate}
24h volume: $${ctx.volume24h.toLocaleString()}
${ctx.recentNews?.length ? `\nRecent news:\n${ctx.recentNews.join('\n')}` : ''}`

    const message = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (message.content[0] as any).text
    try {
      const parsed = JSON.parse(raw)
      return { ...parsed, rawResponse: raw }
    } catch {
      return { sentiment: 'neutral', confidence: 0, estimatedProbability: ctx.yesPrice, summary: 'Parse error', reasoning: raw, rawResponse: raw }
    }
  }
}

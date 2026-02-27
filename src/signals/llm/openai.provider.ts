import type { LLMProvider, MarketContext, AnalysisResult } from './provider.interface.ts'
import OpenAI from 'openai'

export class OpenAIProvider implements LLMProvider {
  name = 'openai'
  private client: OpenAI

  constructor(private config: { apiKey: string; model: string }) {
    this.client = new OpenAI({ apiKey: config.apiKey })
  }

  async analyze(ctx: MarketContext): Promise<AnalysisResult> {
    const prompt = `Analyze this prediction market as JSON only:
Market: ${ctx.question}
YES price: ${ctx.yesPrice}, End: ${ctx.endDate}
Return: {"sentiment":"bullish"|"bearish"|"neutral","confidence":0-1,"estimatedProbability":0-1,"summary":"...","reasoning":"..."}`

    const resp = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 512,
    })

    const raw = resp.choices[0]?.message?.content ?? '{}'
    try {
      return { ...JSON.parse(raw), rawResponse: raw }
    } catch {
      return { sentiment: 'neutral', confidence: 0, estimatedProbability: ctx.yesPrice, summary: 'Parse error', reasoning: raw, rawResponse: raw }
    }
  }
}

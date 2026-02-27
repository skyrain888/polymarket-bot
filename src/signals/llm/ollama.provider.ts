import type { LLMProvider, MarketContext, AnalysisResult } from './provider.interface.ts'

export class OllamaProvider implements LLMProvider {
  name = 'ollama'
  private host: string

  constructor(private config: { model: string; ollamaHost?: string }) {
    this.host = config.ollamaHost ?? 'http://localhost:11434'
  }

  async analyze(ctx: MarketContext): Promise<AnalysisResult> {
    const prompt = `Analyze this prediction market. Respond with JSON only.
Market: ${ctx.question}, YES price: ${ctx.yesPrice}, End: ${ctx.endDate}
Return JSON: {"sentiment":"bullish"|"bearish"|"neutral","confidence":0-1,"estimatedProbability":0-1,"summary":"...","reasoning":"..."}`

    const resp = await fetch(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, prompt, stream: false, format: 'json' }),
    })
    const data = await resp.json() as any
    const raw = data.response ?? '{}'
    try {
      return { ...JSON.parse(raw), rawResponse: raw }
    } catch {
      return { sentiment: 'neutral', confidence: 0, estimatedProbability: ctx.yesPrice, summary: 'Parse error', reasoning: raw, rawResponse: raw }
    }
  }
}

import type { LLMProvider, MarketContext, AnalysisResult } from './provider.interface.ts'

export class GeminiProvider implements LLMProvider {
  name = 'gemini'

  constructor(private config: { apiKey: string; model: string }) {}

  async analyze(ctx: MarketContext): Promise<AnalysisResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`
    const prompt = `Analyze this prediction market, respond with JSON only:
Market: ${ctx.question}, YES price: ${ctx.yesPrice}, End: ${ctx.endDate}
JSON schema: {"sentiment":"bullish"|"bearish"|"neutral","confidence":0-1,"estimatedProbability":0-1,"summary":"...","reasoning":"..."}`

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    })
    const data = await resp.json() as any
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
    try {
      const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
      return { ...JSON.parse(clean), rawResponse: raw }
    } catch {
      return { sentiment: 'neutral', confidence: 0, estimatedProbability: ctx.yesPrice, summary: 'Parse error', reasoning: raw, rawResponse: raw }
    }
  }
}

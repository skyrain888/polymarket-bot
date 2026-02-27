import type { QuantSignal } from './quant/engine.ts'
import type { AnalysisResult } from './llm/provider.interface.ts'

export interface SignalBundle {
  marketId: string
  timestamp: Date
  quant: QuantSignal
  llm: AnalysisResult | null
}

export class SignalAggregator {
  private bundles = new Map<string, SignalBundle>()

  update(marketId: string, quant: QuantSignal, llm: AnalysisResult | null): SignalBundle {
    const bundle: SignalBundle = { marketId, timestamp: new Date(), quant, llm }
    this.bundles.set(marketId, bundle)
    return bundle
  }

  get(marketId: string): SignalBundle | undefined {
    return this.bundles.get(marketId)
  }

  getAll(): SignalBundle[] {
    return [...this.bundles.values()]
  }
}

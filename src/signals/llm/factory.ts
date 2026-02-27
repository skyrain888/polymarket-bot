import type { LLMProvider } from './provider.interface.ts'
import { ClaudeProvider } from './claude.provider.ts'
import { OpenAIProvider } from './openai.provider.ts'
import { GeminiProvider } from './gemini.provider.ts'
import { OllamaProvider } from './ollama.provider.ts'
import type { LLMProviderName } from '../../config/types.ts'

interface FactoryConfig {
  provider: LLMProviderName
  apiKey: string
  model: string
  ollamaHost?: string
}

export function createLLMProvider(config: FactoryConfig): LLMProvider {
  switch (config.provider) {
    case 'claude':  return new ClaudeProvider(config)
    case 'openai':  return new OpenAIProvider(config)
    case 'gemini':  return new GeminiProvider(config)
    case 'ollama':  return new OllamaProvider(config)
    default: throw new Error(`Unknown LLM provider: ${config.provider}`)
  }
}

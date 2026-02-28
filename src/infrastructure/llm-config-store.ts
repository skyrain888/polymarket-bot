import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { LLMProviderName } from '../config/types.ts'

const DEFAULT_PATH = './data/llm-config.json'

export interface LLMPersistedConfig {
  provider: LLMProviderName
  apiKey: string
  model: string
  baseUrl?: string
  ollamaHost?: string
}

export class LLMConfigStore {
  constructor(private filePath: string = DEFAULT_PATH) {}

  load(): LLMPersistedConfig | null {
    if (!existsSync(this.filePath)) return null
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      return JSON.parse(raw) as LLMPersistedConfig
    } catch {
      console.error(`[LLMConfigStore] Failed to read ${this.filePath}, falling back to env`)
      return null
    }
  }

  save(config: LLMPersistedConfig): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf-8')
    } catch (err) {
      console.error(`[LLMConfigStore] Failed to write ${this.filePath}:`, err)
    }
  }
}

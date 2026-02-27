import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { CopyTradingConfig } from '../strategies/copy-trading/types.ts'

const DEFAULT_PATH = './data/copy-trading.json'

export class ConfigStore {
  constructor(private filePath: string = DEFAULT_PATH) {}

  load(): CopyTradingConfig | null {
    if (!existsSync(this.filePath)) return null
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      return JSON.parse(raw) as CopyTradingConfig
    } catch {
      console.error(`[ConfigStore] Failed to read ${this.filePath}, falling back to env`)
      return null
    }
  }

  save(config: CopyTradingConfig): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf-8')
  }
}

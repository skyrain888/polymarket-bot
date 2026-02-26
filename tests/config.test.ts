import { describe, test, expect } from 'bun:test'

describe('Config', () => {
  test('loads config with defaults', async () => {
    process.env.BOT_MODE = 'paper'
    process.env.LLM_PROVIDER = 'claude'
    const { loadConfig } = await import('../src/config/index.ts')
    const config = loadConfig()
    expect(config.mode).toBe('paper')
    expect(config.llm.provider).toBe('claude')
    expect(config.risk.maxPositionPct).toBe(0.20)
  })

  test('throws if required env missing', async () => {
    delete process.env.POLY_PRIVATE_KEY
    process.env.BOT_MODE = 'live'
    const { loadConfig } = await import('../src/config/index.ts')
    expect(() => loadConfig()).toThrow('POLY_PRIVATE_KEY required in live mode')
  })
})

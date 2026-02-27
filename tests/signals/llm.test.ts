import { describe, test, expect } from 'bun:test'
import { createLLMProvider } from '../../src/signals/llm/factory.ts'

describe('LLM Provider Factory', () => {
  test('creates claude provider', () => {
    const provider = createLLMProvider({ provider: 'claude', apiKey: 'test', model: 'claude-haiku-4-5-20251001' })
    expect(provider).toBeDefined()
    expect(typeof provider.analyze).toBe('function')
  })

  test('creates openai provider', () => {
    const provider = createLLMProvider({ provider: 'openai', apiKey: 'test', model: 'gpt-4o-mini' })
    expect(provider).toBeDefined()
  })

  test('throws for unknown provider', () => {
    expect(() => createLLMProvider({ provider: 'unknown' as any, apiKey: '', model: '' })).toThrow()
  })
})

import { describe, test, expect } from 'bun:test'
import { PolymarketClient } from '../../src/infrastructure/polymarket/client.ts'

describe('PolymarketClient', () => {
  test('paper mode skips real API calls', async () => {
    const client = new PolymarketClient({ mode: 'paper', privateKey: '', apiKey: '', apiSecret: '', apiPassphrase: '', host: '' })
    const result = await client.placeOrder({ marketId: 'x', tokenId: 'y', side: 'buy', size: 10, price: 0.5 })
    expect(result.status).toBe('simulated')
  })

  test('getMarkets returns array', async () => {
    const client = new PolymarketClient({ mode: 'paper', privateKey: '', apiKey: '', apiSecret: '', apiPassphrase: '', host: '' })
    // Paper mode returns mock data
    const markets = await client.getMarkets()
    expect(Array.isArray(markets)).toBe(true)
  })
})

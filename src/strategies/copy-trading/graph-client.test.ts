import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { GraphClient } from './graph-client.ts'

describe('GraphClient', () => {
  it('returns empty array when fetch returns no events', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        data: { orderFilledEvents: [] }
      })))
    ) as any

    const client = new GraphClient()
    const trades = await client.getRecentTrades('0xABC', 0)
    expect(trades).toEqual([])
  })

  it('maps GraphQL response to CopiedTrade shape', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        data: {
          orderFilledEvents: [{
            id: 'evt1',
            market: { id: 'mkt1' },
            outcomeIndex: 0,
            side: 'BUY',
            size: '100',
            price: '0.45',
            timestamp: '1000',
            transactionHash: '0xTX1',
          }]
        }
      })))
    ) as any

    const client = new GraphClient()
    const trades = await client.getRecentTrades('0xABC', 0)
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({
      marketId: 'mkt1',
      side: 'buy',
      size: 100,
      price: 0.45,
      txHash: '0xTX1',
      timestamp: 1000,
    })
  })
})

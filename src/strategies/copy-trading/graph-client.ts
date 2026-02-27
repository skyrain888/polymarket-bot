import type { CopiedTrade } from './types.ts'

const SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/polymarket/polymarket-orderbook-v2'

const QUERY = `
  query GetRecentTrades($wallet: String!, $since: Int!) {
    orderFilledEvents(
      where: { maker: $wallet, timestamp_gt: $since }
      orderBy: timestamp
      orderDirection: desc
      first: 10
    ) {
      id
      market { id }
      outcomeIndex
      side
      size
      price
      timestamp
      transactionHash
    }
  }
`

export class GraphClient {
  constructor(private url = SUBGRAPH_URL) {}

  async getRecentTrades(walletAddress: string, since: number): Promise<Omit<CopiedTrade, 'walletAddress' | 'label' | 'copiedSize' | 'originalSize'>[]> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { wallet: walletAddress.toLowerCase(), since } }),
    })

    if (!res.ok) throw new Error(`Graph request failed: ${res.status}`)

    const json = await res.json() as any
    const events = json?.data?.orderFilledEvents ?? []

    return events.map((e: any) => ({
      marketId: e.market.id,
      tokenId: `${e.market.id}-${e.outcomeIndex === 0 ? 'YES' : 'NO'}`,
      side: (e.side as string).toLowerCase() as 'buy' | 'sell',
      size: Number(e.size),
      price: Number(e.price),
      txHash: e.transactionHash,
      timestamp: Number(e.timestamp),
    }))
  }
}

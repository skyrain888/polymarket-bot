import type { Market, OrderIntent, OrderResult, OrderBook } from './types.ts'

interface ClientConfig {
  mode: 'paper' | 'live' | 'backtest'
  privateKey: string
  apiKey: string
  apiSecret: string
  apiPassphrase: string
  host: string
}

export class PolymarketClient {
  private clobClient: any = null

  constructor(private config: ClientConfig) {}

  private async getClobClient() {
    if (this.config.mode !== 'live') return null
    if (!this.clobClient) {
      const { ClobClient } = await import('@polymarket/clob-client')
      const { ethers } = await import('ethers')
      const signer = new ethers.Wallet(this.config.privateKey)
      this.clobClient = new ClobClient(this.config.host, 137, signer, {
        key: this.config.apiKey,
        secret: this.config.apiSecret,
        passphrase: this.config.apiPassphrase,
      })
    }
    return this.clobClient
  }

  async getMarkets(nextCursor?: string): Promise<Market[]> {
    if (this.config.mode !== 'live') {
      // Paper/backtest: return mock markets
      return []
    }
    const client = await this.getClobClient()
    const resp = await client.getMarkets(nextCursor)
    return (resp.data ?? []).map((m: any) => ({
      id: m.id,
      conditionId: m.condition_id,
      question: m.question,
      category: m.category ?? 'unknown',
      endDate: m.end_date_iso,
      yesPrice: Number(m.tokens?.[0]?.price ?? 0),
      noPrice: Number(m.tokens?.[1]?.price ?? 0),
      volume24h: Number(m.volume_24hr ?? 0),
      liquidity: Number(m.liquidity ?? 0),
      active: m.active,
    }))
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    if (this.config.mode !== 'live') {
      return { bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 100 }] }
    }
    const client = await this.getClobClient()
    return client.getOrderBook(tokenId)
  }

  async placeOrder(intent: OrderIntent): Promise<OrderResult> {
    if (this.config.mode !== 'live') {
      return {
        orderId: `sim-${Date.now()}`,
        status: 'simulated',
        marketId: intent.marketId,
        side: intent.side,
        size: intent.size,
        price: intent.price,
      }
    }
    const client = await this.getClobClient()
    const { Side, OrderType } = await import('@polymarket/clob-client')
    const order = await client.createOrder({
      tokenID: intent.tokenId,
      price: intent.price,
      side: intent.side === 'buy' ? Side.BUY : Side.SELL,
      size: intent.size,
    })
    const resp = await client.postOrder(order, OrderType.GTC)
    return {
      orderId: resp.orderID ?? `ord-${Date.now()}`,
      status: resp.status ?? 'open',
      marketId: intent.marketId,
      side: intent.side,
      size: intent.size,
      price: intent.price,
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    if (this.config.mode !== 'live') return
    const client = await this.getClobClient()
    await client.cancelOrder({ orderID: orderId })
  }

  async getBalance(): Promise<number> {
    if (this.config.mode !== 'live') return 10000 // paper balance
    const client = await this.getClobClient()
    const bal = await client.getBalanceAllowance({ asset_type: 'USDC' })
    return Number(bal.balance ?? 0)
  }
}

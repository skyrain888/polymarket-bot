import { describe, it, expect, mock } from 'bun:test'
import { CopyTradingStrategy } from './index.ts'
import type { CopyTradingConfig } from '../../config/types.ts'

const baseConfig: CopyTradingConfig = {
  enabled: true,
  wallets: [{ address: '0xAAA', label: 'Wallet A', sizeMode: 'fixed', fixedAmount: 50 }],
  maxDailyTradesPerWallet: 3,
  maxWalletExposureUsdc: 200,
  maxTotalExposureUsdc: 500,
}

const mockMarket = { id: 'mkt1', conditionId: 'cond1', question: 'Q?', category: 'test', endDate: '', yesPrice: 0.5, noPrice: 0.5, volume24h: 1000, liquidity: 500, active: true }
const mockSignals = { marketId: 'mkt1', timestamp: new Date(), quant: { spread: 0.04, momentum: 0, liquidityScore: 0.5 }, llm: null }

describe('CopyTradingStrategy', () => {
  it('returns null when disabled', async () => {
    const strategy = new CopyTradingStrategy({ ...baseConfig, enabled: false }, mock(() => Promise.resolve([])) as any)
    const intent = await strategy.evaluate(mockMarket, mockSignals)
    expect(intent).toBeNull()
  })

  it('returns null when no wallets configured', async () => {
    const strategy = new CopyTradingStrategy({ ...baseConfig, wallets: [] }, mock(() => Promise.resolve([])) as any)
    const intent = await strategy.evaluate(mockMarket, mockSignals)
    expect(intent).toBeNull()
  })

  it('generates TradeIntent for new trade with fixed sizing', async () => {
    const mockGetTrades = mock(() => Promise.resolve([{
      marketId: 'mkt1',
      tokenId: 'mkt1-YES',
      side: 'buy' as const,
      size: 200,
      price: 0.45,
      txHash: '0xTX1',
      timestamp: 1000,
    }]))

    const strategy = new CopyTradingStrategy(baseConfig, { getRecentTrades: mockGetTrades } as any)
    const intent = await strategy.evaluate(mockMarket, mockSignals)

    expect(intent).not.toBeNull()
    expect(intent!.size).toBe(50)           // fixed amount
    expect(intent!.side).toBe('buy')
    expect(intent!.price).toBe(0.45)
    expect(intent!.strategyId).toBe('copy-trading')
  })

  it('does not re-fire same txHash twice', async () => {
    const trade = { marketId: 'mkt1', tokenId: 'mkt1-YES', side: 'buy' as const, size: 200, price: 0.45, txHash: '0xTX1', timestamp: 1000 }
    const mockGetTrades = mock(() => Promise.resolve([trade]))
    const strategy = new CopyTradingStrategy(baseConfig, { getRecentTrades: mockGetTrades } as any)

    await strategy.evaluate(mockMarket, mockSignals) // first tick - fires
    const second = await strategy.evaluate(mockMarket, mockSignals) // same tx - skip
    expect(second).toBeNull()
  })

  it('blocks trade when daily limit reached', async () => {
    const mockGetTrades = mock()
      .mockResolvedValueOnce([{ marketId: 'mkt1', tokenId: 'mkt1-YES', side: 'buy' as const, size: 100, price: 0.45, txHash: '0xT1', timestamp: 1000 }])
      .mockResolvedValueOnce([{ marketId: 'mkt1', tokenId: 'mkt1-YES', side: 'buy' as const, size: 100, price: 0.45, txHash: '0xT2', timestamp: 1001 }])
      .mockResolvedValueOnce([{ marketId: 'mkt1', tokenId: 'mkt1-YES', side: 'buy' as const, size: 100, price: 0.45, txHash: '0xT3', timestamp: 1002 }])
      .mockResolvedValueOnce([{ marketId: 'mkt1', tokenId: 'mkt1-YES', side: 'buy' as const, size: 100, price: 0.45, txHash: '0xT4', timestamp: 1003 }])

    const strategy = new CopyTradingStrategy({ ...baseConfig, maxDailyTradesPerWallet: 3 }, { getRecentTrades: mockGetTrades } as any)

    await strategy.evaluate(mockMarket, mockSignals) // trade 1
    await strategy.evaluate(mockMarket, mockSignals) // trade 2
    await strategy.evaluate(mockMarket, mockSignals) // trade 3
    const blocked = await strategy.evaluate(mockMarket, mockSignals) // should be blocked
    expect(blocked).toBeNull()
  })
})

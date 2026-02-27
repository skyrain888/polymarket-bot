import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import type { PositionTracker } from '../../core/position-tracker.ts'
import type { RiskManager } from '../../core/risk-manager.ts'
import type { StrategyEngine } from '../../strategies/engine.ts'
import type { OrderRepository, SignalRepository } from '../storage/repositories.ts'
import type { CopyTradingStrategy } from '../../strategies/copy-trading/index.ts'
import type { BotConfig } from '../../config/types.ts'
import { overviewView, layout } from './views.ts'

interface DashboardDeps {
  positionTracker: PositionTracker
  riskManager: RiskManager
  strategyEngine: StrategyEngine
  orderRepo: OrderRepository
  signalRepo: SignalRepository
  getBalance: () => Promise<number>
  config?: BotConfig
  copyTradingStrategy?: CopyTradingStrategy
}

export function createDashboard(deps: DashboardDeps, port: number) {
  const app = new Hono()

  app.get('/', async (c) => {
    const [balance, positions] = await Promise.all([deps.getBalance(), deps.positionTracker.getAllPositions()])
    const todayPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0)
    return c.html(overviewView({ balance, todayPnl, activeStrategies: deps.strategyEngine.getStrategies().filter(s => s.enabled).length, openPositions: positions.length }))
  })

  app.get('/positions', (c) => {
    const positions = deps.positionTracker.getAllPositions()
    const rows = positions.map(p => `<tr>
      <td>${p.marketId}</td>
      <td>${p.strategyId}</td>
      <td>${p.size.toFixed(2)}</td>
      <td>$${p.avgPrice.toFixed(3)}</td>
      <td class="${p.unrealizedPnl >= 0 ? 'positive' : 'negative'}">${p.unrealizedPnl >= 0 ? '+' : ''}$${p.unrealizedPnl.toFixed(2)}</td>
    </tr>`).join('')
    return c.html(layout('Positions', `
      <h2 style="margin-bottom:1rem">Positions</h2>
      <div class="card">
        <table>
          <thead><tr><th>Market</th><th>Strategy</th><th>Size</th><th>Avg Price</th><th>Unrealized PnL</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#888">No open positions</td></tr>'}</tbody>
        </table>
      </div>
    `))
  })

  app.get('/orders', (c) => {
    const orders = deps.orderRepo.findRecent(50)
    const rows = orders.map(o => `<tr>
      <td>${o.strategyId}</td>
      <td>${o.marketId.slice(0, 12)}…</td>
      <td>${o.side}</td>
      <td>${o.size.toFixed(2)}</td>
      <td>$${o.price.toFixed(3)}</td>
      <td><span class="badge ${o.status === 'filled' || o.status === 'simulated' ? 'badge-ok' : o.status === 'rejected' ? 'badge-err' : 'badge-warn'}">${o.status}</span></td>
    </tr>`).join('')
    return c.html(layout('Orders', `
      <h2 style="margin-bottom:1rem">Order History</h2>
      <div class="card">
        <table>
          <thead><tr><th>Strategy</th><th>Market</th><th>Side</th><th>Size</th><th>Price</th><th>Status</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#888">No orders yet</td></tr>'}</tbody>
        </table>
      </div>
    `))
  })

  app.get('/strategies', (c) => {
    const strategies = deps.strategyEngine.getStrategies()
    const rows = strategies.map(s => `<tr>
      <td>${s.name}</td>
      <td><span class="badge ${s.enabled ? 'badge-ok' : 'badge-err'}">${s.enabled ? 'Active' : 'Disabled'}</span></td>
      <td>${(deps.riskManager.isCircuitTripped(s.id) ? '🔴 Tripped' : '🟢 OK')}</td>
      <td>${(s.getWeight() * 100).toFixed(0)}%</td>
    </tr>`).join('')
    return c.html(layout('Strategies', `
      <h2 style="margin-bottom:1rem">Strategies</h2>
      <div class="card">
        <table>
          <thead><tr><th>Strategy</th><th>Status</th><th>Circuit</th><th>Weight</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `))
  })

  app.get('/copy-trading', (c) => {
    const strategy = deps.copyTradingStrategy
    const wallets = deps.config?.copyTrading.wallets ?? []
    const copies = strategy?.getRecentCopies(50) ?? []

    const walletRows = wallets.map(w => `<tr>
      <td style="font-family:monospace;font-size:0.85rem">${w.address.slice(0, 8)}…${w.address.slice(-6)}</td>
      <td>${w.label}</td>
      <td><span class="badge badge-warn">${w.sizeMode}</span></td>
      <td>${w.sizeMode === 'fixed' ? `$${w.fixedAmount}` : `${((w.proportionPct ?? 0) * 100).toFixed(0)}%`}</td>
    </tr>`).join('')

    const copyRows = copies.slice().reverse().map(c => `<tr>
      <td style="color:#888;font-size:0.8rem">${new Date(c.timestamp * 1000).toLocaleString()}</td>
      <td>${c.label}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem">${c.marketId}</td>
      <td><span class="badge ${c.side === 'buy' ? 'badge-ok' : 'badge-err'}">${c.side}</span></td>
      <td>$${c.copiedSize.toFixed(2)}</td>
      <td style="color:#888;font-size:0.8rem">${c.txHash.slice(0, 10)}…</td>
    </tr>`).join('')

    const enabled = deps.config?.copyTrading.enabled ?? false
    return c.html(layout('Copy Trading', `
      <h2 style="margin-bottom:0.5rem">Copy Trading</h2>
      <p style="margin-bottom:1rem;color:#888">Status: <span class="badge ${enabled ? 'badge-ok' : 'badge-err'}">${enabled ? 'Enabled' : 'Disabled'}</span></p>
      <div class="card" style="margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;color:#7c83fd">Monitored Wallets</h3>
        <table>
          <thead><tr><th>Address</th><th>Label</th><th>Mode</th><th>Size</th></tr></thead>
          <tbody>${walletRows || '<tr><td colspan="4" style="text-align:center;color:#888">No wallets configured</td></tr>'}</tbody>
        </table>
      </div>
      <div class="card">
        <h3 style="margin-bottom:1rem;color:#7c83fd">Recent Copy Trades</h3>
        <table>
          <thead><tr><th>Time</th><th>Wallet</th><th>Market</th><th>Side</th><th>Size</th><th>TxHash</th></tr></thead>
          <tbody>${copyRows || '<tr><td colspan="6" style="text-align:center;color:#888">No copy trades yet</td></tr>'}</tbody>
        </table>
      </div>
    `))
  })

  // SSE endpoint for real-time updates
  app.get('/events', (c) => streamSSE(c, async (stream) => {
    while (true) {
      await stream.writeSSE({ data: 'ping', event: 'heartbeat' })
      await Bun.sleep(5000)
    }
  }))

  serve({ fetch: app.fetch, port }, () => {
    console.log(`Dashboard running at http://localhost:${port}`)
  })

  return app
}

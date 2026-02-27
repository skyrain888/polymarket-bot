import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import type { PositionTracker } from '../../core/position-tracker.ts'
import type { RiskManager } from '../../core/risk-manager.ts'
import type { StrategyEngine } from '../../strategies/engine.ts'
import type { OrderRepository, SignalRepository } from '../storage/repositories.ts'
import { overviewView, layout } from './views.ts'

interface DashboardDeps {
  positionTracker: PositionTracker
  riskManager: RiskManager
  strategyEngine: StrategyEngine
  orderRepo: OrderRepository
  signalRepo: SignalRepository
  getBalance: () => Promise<number>
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

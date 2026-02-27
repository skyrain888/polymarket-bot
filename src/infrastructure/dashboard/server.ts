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
  config: BotConfig
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

  app.get('/signals', (c) => {
    const signals = deps.signalRepo.findAll(50)
    const sentimentColor = (s: string | null) => s === 'bullish' ? 'badge-ok' : s === 'bearish' ? 'badge-err' : 'badge-warn'
    const rows = signals.map(s => `<tr>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.marketId}</td>
      <td>${s.provider}</td>
      <td><span class="badge ${sentimentColor(s.sentiment)}">${s.sentiment ?? 'n/a'}</span></td>
      <td>${s.confidence != null ? (s.confidence * 100).toFixed(0) + '%' : '-'}</td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.summary ?? '-'}</td>
    </tr>`).join('')
    return c.html(layout('Signals', `
      <h2 style="margin-bottom:1rem">Signals</h2>
      <div class="card">
        <table>
          <thead><tr><th>Market</th><th>Provider</th><th>Sentiment</th><th>Confidence</th><th>Summary</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#888">No signals yet</td></tr>'}</tbody>
        </table>
      </div>
    `))
  })

  app.get('/config', (c) => {
    const cfg = deps.config
    const mask = (s: string) => s ? s.slice(0, 4) + '****' : '(not set)'
    const row = (label: string, value: string) => `<tr><td style="color:#888;width:240px">${label}</td><td>${value}</td></tr>`
    return c.html(layout('Config', `
      <h2 style="margin-bottom:1rem">Config</h2>
      <div class="card" style="margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;color:#7c83fd">General</h3>
        <table>
          ${row('Mode', `<span class="badge ${cfg.mode === 'live' ? 'badge-err' : cfg.mode === 'paper' ? 'badge-warn' : 'badge-ok'}">${cfg.mode}</span>`)}
          ${row('DB Path', cfg.dbPath)}
          ${row('Dashboard Port', String(cfg.dashboard.port))}
        </table>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;color:#7c83fd">LLM</h3>
        <table>
          ${row('Provider', cfg.llm.provider)}
          ${row('Model', cfg.llm.model)}
          ${row('API Key', mask(cfg.llm.apiKey))}
          ${cfg.llm.ollamaHost ? row('Ollama Host', cfg.llm.ollamaHost) : ''}
        </table>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;color:#7c83fd">Risk</h3>
        <table>
          ${row('Max Position', (cfg.risk.maxPositionPct * 100).toFixed(0) + '%')}
          ${row('Max Total Exposure', (cfg.risk.maxTotalExposurePct * 100).toFixed(0) + '%')}
          ${row('Max Daily Loss', (cfg.risk.maxDailyLossPct * 100).toFixed(0) + '%')}
          ${row('Max Consecutive Losses', String(cfg.risk.maxConsecutiveLosses))}
          ${row('Cooldown', cfg.risk.cooldownMinutes + ' min')}
          ${row('Max Volume Impact', (cfg.risk.maxVolumeImpactPct * 100).toFixed(0) + '%')}
          ${row('Max Slippage', (cfg.risk.maxSlippagePct * 100).toFixed(0) + '%')}
        </table>
      </div>
      <div class="card">
        <h3 style="margin-bottom:1rem;color:#7c83fd">Notifications</h3>
        <table>
          ${row('Telegram', cfg.notify.telegram ? `<span class="badge badge-ok">Configured</span>` : `<span class="badge badge-err">Not set</span>`)}
          ${row('Discord', cfg.notify.discord ? `<span class="badge badge-ok">Configured</span>` : `<span class="badge badge-err">Not set</span>`)}
        </table>
      </div>
    `))
  })

  app.get('/copy-trading', (c) => {
    const strategy = deps.copyTradingStrategy
    const wallets = deps.config.copyTrading.wallets
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

    const enabled = deps.config.copyTrading.enabled
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

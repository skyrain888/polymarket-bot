import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import type { PositionTracker } from '../../core/position-tracker.ts'
import type { RiskManager } from '../../core/risk-manager.ts'
import type { StrategyEngine } from '../../strategies/engine.ts'
import type { OrderRepository, SignalRepository } from '../storage/repositories.ts'
import type { CopyTradingStrategy } from '../../strategies/copy-trading/index.ts'
import type { BotConfig } from '../../config/types.ts'
import type { ConfigStore } from '../config-store.ts'
import type { SizeMode } from '../../strategies/copy-trading/types.ts'
import type { ArchiveService } from '../archive/service.ts'
import type { ArchiveRepository } from '../archive/repository.ts'
import type { ScreenerService } from '../../strategies/copy-trading/screener/index.ts'
import type { ScreenerResult, ScreenerState } from '../../strategies/copy-trading/screener/types.ts'
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
  configStore?: ConfigStore
  archiveService?: ArchiveService
  archiveRepo?: ArchiveRepository
  screenerService?: ScreenerService
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
    return c.html(layout('持仓', `
      <h2 style="margin-bottom:1rem">持仓</h2>
      <div class="card">
        <table>
          <thead><tr><th>市场</th><th>策略</th><th>数量</th><th>均价</th><th>未实现盈亏</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#888">暂无持仓</td></tr>'}</tbody>
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
    return c.html(layout('订单', `
      <h2 style="margin-bottom:1rem">订单历史</h2>
      <div class="card">
        <table>
          <thead><tr><th>策略</th><th>市场</th><th>方向</th><th>数量</th><th>价格</th><th>状态</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#888">暂无订单</td></tr>'}</tbody>
        </table>
      </div>
    `))
  })

  app.get('/strategies', (c) => {
    const strategies = deps.strategyEngine.getStrategies()
    const rows = strategies.map(s => `<tr>
      <td>${s.name}</td>
      <td><span class="badge ${s.enabled ? 'badge-ok' : 'badge-err'}">${s.enabled ? '运行中' : '已禁用'}</span></td>
      <td>${(deps.riskManager.isCircuitTripped(s.id) ? '🔴 已熔断' : '🟢 正常')}</td>
      <td>${(s.getWeight() * 100).toFixed(0)}%</td>
    </tr>`).join('')
    return c.html(layout('策略', `
      <h2 style="margin-bottom:1rem">策略</h2>
      <div class="card">
        <table>
          <thead><tr><th>策略</th><th>状态</th><th>熔断器</th><th>权重</th></tr></thead>
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
    return c.html(layout('信号', `
      <h2 style="margin-bottom:1rem">信号</h2>
      <div class="card">
        <table>
          <thead><tr><th>市场</th><th>来源</th><th>情绪</th><th>置信度</th><th>摘要</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#888">暂无信号</td></tr>'}</tbody>
        </table>
      </div>
    `))
  })

  app.get('/config', (c) => {
    const cfg = deps.config
    const mask = (s: string) => s ? s.slice(0, 4) + '****' : '(未设置)'
    const row = (label: string, value: string) => `<tr><td style="color:#888;width:240px">${label}</td><td>${value}</td></tr>`
    return c.html(layout('配置', `
      <h2 style="margin-bottom:1rem">配置</h2>
      <div class="card" style="margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;color:#7c83fd">通用</h3>
        <table>
          ${row('模式', `<span class="badge ${cfg.mode === 'live' ? 'badge-err' : cfg.mode === 'paper' ? 'badge-warn' : 'badge-ok'}">${cfg.mode}</span>`)}
          ${row('数据库路径', cfg.dbPath)}
          ${row('仪表盘端口', String(cfg.dashboard.port))}
        </table>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;color:#7c83fd">大模型</h3>
        <table>
          ${row('提供商', cfg.llm.provider)}
          ${row('模型', cfg.llm.model)}
          ${row('API 密钥', mask(cfg.llm.apiKey))}
          ${cfg.llm.ollamaHost ? row('Ollama 地址', cfg.llm.ollamaHost) : ''}
        </table>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;color:#7c83fd">风控</h3>
        <table>
          ${row('最大持仓比例', (cfg.risk.maxPositionPct * 100).toFixed(0) + '%')}
          ${row('最大总敞口', (cfg.risk.maxTotalExposurePct * 100).toFixed(0) + '%')}
          ${row('最大日亏损', (cfg.risk.maxDailyLossPct * 100).toFixed(0) + '%')}
          ${row('最大连续亏损', String(cfg.risk.maxConsecutiveLosses))}
          ${row('冷却时间', cfg.risk.cooldownMinutes + ' 分钟')}
          ${row('最大成交量影响', (cfg.risk.maxVolumeImpactPct * 100).toFixed(0) + '%')}
          ${row('最大滑点', (cfg.risk.maxSlippagePct * 100).toFixed(0) + '%')}
        </table>
      </div>
      <div class="card">
        <h3 style="margin-bottom:1rem;color:#7c83fd">通知</h3>
        <table>
          ${row('Telegram', cfg.notify.telegram ? `<span class="badge badge-ok">已配置</span>` : `<span class="badge badge-err">未设置</span>`)}
          ${row('Discord', cfg.notify.discord ? `<span class="badge badge-ok">已配置</span>` : `<span class="badge badge-err">未设置</span>`)}
        </table>
      </div>
    `))
  })

  // Helper: persist config and hot-reload strategy
  function applyConfig() {
    deps.configStore?.save(deps.config.copyTrading)
    deps.copyTradingStrategy?.updateConfig(deps.config.copyTrading)
  }

  // Helper: compute status label/class for a copy entry
  function computeStatus(cp: { marketStatus?: { closed?: boolean; acceptingOrders?: boolean; endDate?: string; resolvedPrices?: Map<string, number> }; tokenId: string; side: string }) {
    const ms = cp.marketStatus
    let statusLabel = '-'
    let statusClass = 'badge-warn'
    let statusKey = ''
    if (ms) {
      if (ms.closed) {
        const resolvedPrice = ms.resolvedPrices?.get(cp.tokenId)
        if (resolvedPrice !== undefined) {
          const won = cp.side === 'buy' ? resolvedPrice === 1 : resolvedPrice === 0
          statusLabel = won ? '已结算·胜' : '已结算·负'
          statusClass = won ? 'badge-ok' : 'badge-err'
          statusKey = won ? 'settled-win' : 'settled-loss'
        } else {
          statusLabel = '已结算'
          statusClass = 'badge-err'
          statusKey = 'settled'
        }
      } else if (!ms.acceptingOrders) {
        statusLabel = '待结算'; statusClass = 'badge-warn'; statusKey = 'pending'
      } else {
        const endPast = ms.endDate ? new Date(ms.endDate).getTime() < Date.now() : false
        if (endPast) { statusLabel = '已截止'; statusClass = 'badge-warn'; statusKey = 'expired' }
        else { statusLabel = '交易中'; statusClass = 'badge-ok'; statusKey = 'active' }
      }
    }
    return { statusLabel, statusClass, statusKey }
  }

  function screenerPageHtml(state: ScreenerState, cfg: { scheduleCron: string; lastRunAt: number | null }, notConfigured = false): string {
    const lastRun = cfg.lastRunAt ? new Date(cfg.lastRunAt * 1000).toLocaleString() : '从未'

    if (notConfigured) {
      return `
    <h2 style="margin-bottom:1rem">智能钱包筛选</h2>
    <div class="card" style="text-align:center;color:#888;padding:3rem">
      <p style="margin-bottom:0.5rem">筛选功能需要配置 LLM API Key</p>
      <p style="font-size:0.85rem">请在环境变量中设置 <code style="background:#2a2a3e;padding:2px 6px;border-radius:3px">LLM_API_KEY</code> 后重启服务</p>
    </div>`
    }

    return `
    <h2 style="margin-bottom:1rem">智能钱包筛选</h2>
    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
        <button hx-post="/screener/run" hx-target="#screener-content" hx-swap="innerHTML"
          style="background:#7c83fd;color:#fff;border:none;padding:0.5rem 1.5rem;border-radius:6px;cursor:pointer;font-size:1rem"
          ${state.status === 'running' ? 'disabled' : ''}>
          ${state.status === 'running' ? '筛选中...' : '开始筛选'}
        </button>
        <form hx-post="/screener/schedule" hx-target="#schedule-status" hx-swap="innerHTML" style="display:flex;gap:0.5rem;align-items:center">
          <label style="color:#888;font-size:0.9rem">定时:</label>
          <select name="schedule" style="background:#2a2a3e;color:#e0e0e0;border:1px solid #3a3a4e;padding:0.3rem;border-radius:4px">
            <option value="disabled" ${cfg.scheduleCron === 'disabled' ? 'selected' : ''}>关闭</option>
            <option value="daily" ${cfg.scheduleCron === 'daily' ? 'selected' : ''}>每日</option>
          </select>
          <button type="submit" style="background:#3a3a4e;color:#e0e0e0;border:none;padding:0.3rem 0.8rem;border-radius:4px;cursor:pointer">保存</button>
          <span id="schedule-status"></span>
        </form>
        <span style="color:#888;font-size:0.85rem">上次筛选: ${lastRun}</span>
      </div>
    </div>
    <div id="screener-content">
      ${state.status === 'running' ? screenerProgressHtml(state) : screenerResultsHtml(state)}
    </div>`
  }

  function screenerProgressHtml(state: ScreenerState): string {
    return `
    <div class="card" hx-get="/screener/progress" hx-trigger="every 2s" hx-swap="outerHTML">
      <div style="margin-bottom:0.5rem;color:#888">${state.progressLabel}</div>
      <div style="background:#2a2a3e;border-radius:4px;height:24px;overflow:hidden">
        <div style="background:#7c83fd;height:100%;width:${state.progress}%;transition:width 0.3s;display:flex;align-items:center;justify-content:center;font-size:0.8rem;color:#fff">
          ${state.progress}%
        </div>
      </div>
    </div>`
  }

  function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function screenerResultsHtml(state: ScreenerState): string {
    if (state.lastError) {
      return `<div class="card"><span class="badge badge-err">筛选失败: ${escHtml(state.lastError)}</span></div>`
    }
    if (state.results.length === 0) {
      return `<div class="card" style="text-align:center;color:#888;padding:3rem">点击"开始筛选"从 Polymarket 排行榜发现优质跟单对象</div>`
    }

    const levelBadge = (l: string) => l === 'recommended' ? '<span class="badge badge-ok">推荐</span>'
      : l === 'cautious' ? '<span class="badge badge-warn">谨慎</span>'
      : '<span class="badge badge-err">不推荐</span>'

    const cards = state.results.map((r: ScreenerResult, i: number) => `
      <div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem">
          <div>
            <span style="color:#7c83fd;font-weight:bold;font-size:1.1rem">#${i + 1} ${escHtml(r.username || r.address.slice(0, 10))}</span>
            <span style="color:#888;font-size:0.8rem;margin-left:0.5rem">${r.address.slice(0, 6)}...${r.address.slice(-4)}</span>
            <span style="margin-left:0.5rem">排名 #${r.rank}</span>
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center">
            ${levelBadge(r.recommendation.level)}
            <span style="background:#2a2a3e;padding:2px 8px;border-radius:4px;font-size:0.85rem">综合 ${r.totalScore}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:0.75rem;font-size:0.85rem">
          <div><span style="color:#888">PnL:</span> <span class="${r.pnl >= 0 ? 'positive' : 'negative'}">$${r.pnl.toFixed(0)}</span></div>
          <div><span style="color:#888">成交量:</span> $${r.volume >= 1000 ? (r.volume / 1000).toFixed(1) + 'K' : r.volume.toFixed(0)}</div>
          <div><span style="color:#888">持仓:</span> $${r.totalPortfolioValue >= 1000 ? (r.totalPortfolioValue / 1000).toFixed(1) + 'K' : r.totalPortfolioValue.toFixed(0)}</div>
          <div style="display:flex;gap:0.3rem">
            <span style="color:#2ecc71;font-size:0.75rem">收益${r.scores.returns}</span>
            <span style="color:#3498db;font-size:0.75rem">活跃${r.scores.activity}</span>
            <span style="color:#f39c12;font-size:0.75rem">规模${r.scores.portfolioSize}</span>
            <span style="color:#9b59b6;font-size:0.75rem">分散${r.scores.diversification}</span>
          </div>
        </div>
        <div style="background:#12121e;border-radius:6px;padding:0.75rem;margin-bottom:0.75rem">
          <div style="font-size:0.85rem;margin-bottom:0.5rem"><strong style="color:#7c83fd">跟单理由:</strong> ${escHtml(r.recommendation.reasoning)}</div>
          <div style="font-size:0.85rem;margin-bottom:0.5rem"><strong style="color:#7c83fd">推荐策略:</strong> ${r.recommendation.suggestedSizeMode === 'fixed' ? '固定金额 $' + r.recommendation.suggestedAmount : '比例 ' + (r.recommendation.suggestedAmount * 100).toFixed(0) + '%'} | 单市场上限: ${r.recommendation.suggestedMaxCopiesPerMarket}次</div>
          <div style="font-size:0.85rem;color:#e74c3c">风险提示: ${escHtml(r.recommendation.riskWarning)}</div>
        </div>
        <div style="text-align:right" id="add-wallet-${i}">
          <form hx-post="/screener/add-wallet" hx-target="#add-wallet-${i}" hx-swap="innerHTML" style="display:inline">
            <input type="hidden" name="address" value="${r.address}">
            <input type="hidden" name="label" value="${r.username || r.address.slice(0, 10)}">
            <input type="hidden" name="sizeMode" value="${r.recommendation.suggestedSizeMode}">
            <input type="hidden" name="amount" value="${r.recommendation.suggestedAmount}">
            <input type="hidden" name="maxCopiesPerMarket" value="${r.recommendation.suggestedMaxCopiesPerMarket}">
            <button type="submit" style="background:#1e4d2b;color:#2ecc71;border:1px solid #2ecc71;padding:0.4rem 1rem;border-radius:4px;cursor:pointer">+ 添加到跟单</button>
          </form>
        </div>
      </div>
    `).join('')

    const recommendedCount = state.results.filter((r: ScreenerResult) => r.recommendation.level === 'recommended').length
    const screenedAt = state.results[0]?.screenedAt
    const timeStr = screenedAt ? new Date(screenedAt * 1000).toLocaleString() : ''

    return `
    <div style="margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:0.9rem;color:#888">共 ${state.results.length} 个钱包 | ${recommendedCount} 个推荐 | 筛选时间: ${timeStr}</span>
    </div>
    ${cards}`
  }

  // Filter parameters for trades card
  interface TradesFilter {
    wallet?: string   // wallet label (exact match)
    market?: string   // market title (fuzzy match)
    side?: string     // 'buy' | 'sell'
    status?: string   // statusKey: 'active' | 'pending' | 'settled-win' | 'settled-loss' | 'settled' | 'expired'
    time?: string     // 'today' | '3d' | '7d' | '30d'
  }

  // Helper: render just the trades card (reused by full page and HTMX polling)
  async function copyTradingTradesCard(refreshInterval = 10, filter: TradesFilter = {}) {
    const strategy = deps.copyTradingStrategy
    const pnlData = await strategy?.getRecentCopiesWithPnl(200)
    let copies = pnlData?.copies ?? []

    // Compute status for each copy, then apply filters
    const enriched = copies.map(cp => ({ ...cp, ...computeStatus(cp) }))

    let filtered = enriched
    if (filter.wallet) {
      filtered = filtered.filter(cp => cp.label === filter.wallet)
    }
    if (filter.market) {
      const q = filter.market.toLowerCase()
      filtered = filtered.filter(cp => (cp.title || cp.marketId).toLowerCase().includes(q))
    }
    if (filter.side) {
      filtered = filtered.filter(cp => cp.side === filter.side)
    }
    if (filter.status) {
      filtered = filtered.filter(cp => cp.statusKey === filter.status)
    }
    if (filter.time) {
      const now = Date.now()
      const cutoffs: Record<string, number> = {
        today: now - (now % 86400000),  // start of today UTC
        '3d': now - 3 * 86400000,
        '7d': now - 7 * 86400000,
        '30d': now - 30 * 86400000,
      }
      const cutoff = cutoffs[filter.time]
      if (cutoff) {
        filtered = filtered.filter(cp => cp.timestamp * 1000 >= cutoff)
      }
    }

    const totalPnl = filtered.reduce((sum, cp) => sum + cp.pnl, 0)
    const settledPnl = filtered.filter(cp => cp.statusKey === 'settled-win' || cp.statusKey === 'settled-loss' || cp.statusKey === 'settled').reduce((sum, cp) => sum + cp.pnl, 0)
    const settledExpiredPnl = filtered.filter(cp => cp.statusKey === 'settled-win' || cp.statusKey === 'settled-loss' || cp.statusKey === 'settled' || cp.statusKey === 'expired').reduce((sum, cp) => sum + cp.pnl, 0)

    const copyRows = filtered.slice().reverse().map(cp => {
      return `<tr>
      <td style="color:#888;font-size:0.8rem">${new Date(cp.timestamp * 1000).toLocaleString()}</td>
      <td>${cp.label}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.85rem" title="${cp.marketId}">${cp.title || cp.marketId.slice(0, 16) + '…'}</td>
      <td><span style="color:#c0a0ff;font-weight:600">${cp.outcome || '-'}</span></td>
      <td><span class="badge ${cp.statusClass}">${cp.statusLabel}</span></td>
      <td><span class="badge ${cp.side === 'buy' ? 'badge-ok' : 'badge-err'}">${cp.side}</span></td>
      <td>$${cp.originalSize.toFixed(2)}</td>
      <td>$${cp.price.toFixed(3)}</td>
      <td>${(cp.marketStatus?.closed || cp.currentPrice > 0) ? '$' + cp.currentPrice.toFixed(3) : '-'}</td>
      <td style="color:${cp.pnl >= 0 ? '#2ecc71' : '#e74c3c'};font-weight:600">${cp.pnl >= 0 ? '+' : ''}$${cp.pnl.toFixed(2)}</td>
      <td>$${cp.copiedSize.toFixed(2)}</td>
      <td style="font-size:0.8rem"><a href="https://polygonscan.com/tx/${cp.txHash}" target="_blank" style="color:#5b9bd5;text-decoration:none">${cp.txHash.slice(0, 10)}…</a></td>
    </tr>`}).join('')

    // Build query string preserving all filter params
    const qs = new URLSearchParams()
    qs.set('interval', String(refreshInterval))
    if (filter.wallet) qs.set('wallet', filter.wallet)
    if (filter.market) qs.set('market', filter.market)
    if (filter.side) qs.set('side', filter.side)
    if (filter.status) qs.set('status', filter.status)
    if (filter.time) qs.set('time', filter.time)
    const qsStr = qs.toString()

    const opts = [5, 10, 30, 60, 0].map(v =>
      `<option value="${v}"${v === refreshInterval ? ' selected' : ''}>${v === 0 ? '关闭' : v + '秒'}</option>`
    ).join('')

    const triggerAttr = refreshInterval > 0 ? `hx-trigger="every ${refreshInterval}s"` : ''

    // Wallet options from config
    const walletLabels = [...new Set(deps.config.copyTrading.wallets.map(w => w.label))]
    const walletOpts = [`<option value="">全部</option>`].concat(
      walletLabels.map(l => `<option value="${l}"${filter.wallet === l ? ' selected' : ''}>${l}</option>`)
    ).join('')

    const sideOpts = [
      `<option value="">全部</option>`,
      `<option value="buy"${filter.side === 'buy' ? ' selected' : ''}>buy</option>`,
      `<option value="sell"${filter.side === 'sell' ? ' selected' : ''}>sell</option>`,
    ].join('')

    const statusOptions = [
      { value: '', label: '全部' },
      { value: 'active', label: '交易中' },
      { value: 'pending', label: '待结算' },
      { value: 'expired', label: '已截止' },
      { value: 'settled-win', label: '已结算·胜' },
      { value: 'settled-loss', label: '已结算·负' },
    ]
    const statusOpts = statusOptions.map(o =>
      `<option value="${o.value}"${filter.status === o.value ? ' selected' : ''}>${o.label}</option>`
    ).join('')

    const timeOptions = [
      { value: '', label: '全部' },
      { value: 'today', label: '今天' },
      { value: '3d', label: '近3天' },
      { value: '7d', label: '近7天' },
      { value: '30d', label: '近30天' },
    ]
    const timeOpts = timeOptions.map(o =>
      `<option value="${o.value}"${filter.time === o.value ? ' selected' : ''}>${o.label}</option>`
    ).join('')

    // JS helper to rebuild hx-get URL from filter form values
    // NOTE: avoid raw HTML strings with quotes in inline handlers — they break attribute parsing
    const filterJs = `(function(){
      var el=document.getElementById('ct-trades');
      var f=document.getElementById('ct-filter');
      var ps=new URLSearchParams();
      ps.set('interval',f.querySelector('[name=_interval]').value);
      ['wallet','market','side','status','time'].forEach(function(k){var v=f.querySelector('[name='+k+']').value;if(v)ps.set(k,v)});
      var url='/copy-trading/trades?'+ps.toString();
      var p=document.createElement('div');p.id='ct-trades';p.style.cssText='text-align:center;padding:2rem;color:#888';p.textContent='筛选中...';
      el.parentNode.replaceChild(p,el);
      htmx.ajax('GET',url,{target:'#ct-trades',swap:'outerHTML'});
    })()`

    const refreshJs = `(function(){
      var el=document.getElementById('ct-trades');
      var f=document.getElementById('ct-filter');
      var ps=new URLSearchParams();
      var iv=this.value;
      ps.set('interval',iv);
      ['wallet','market','side','status','time'].forEach(function(k){var v=f.querySelector('[name='+k+']').value;if(v)ps.set(k,v)});
      var url='/copy-trading/trades?'+ps.toString();
      var p=document.createElement('div');p.id='ct-trades';p.style.cssText='text-align:center;padding:2rem;color:#888';p.textContent='加载中...';
      el.parentNode.replaceChild(p,el);
      htmx.ajax('GET',url,{target:'#ct-trades',swap:'outerHTML'});
    })()`

    const selStyle = 'background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:4px 8px;border-radius:4px;font-size:0.8rem'
    const inputStyle = 'background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:4px 8px;border-radius:4px;font-size:0.8rem;width:140px'

    return `<div class="card" id="ct-trades" hx-get="/copy-trading/trades?${qsStr}" ${triggerAttr} hx-swap="outerHTML">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
          <h3 style="color:#7c83fd;margin:0">最近跟单记录</h3>
          <div style="display:flex;align-items:center;gap:0.5rem">
            ${filtered.length > 0 ? `<span style="padding:0.3rem 0.6rem;background:${totalPnl >= 0 ? '#1e4d2b22' : '#4d1e1e22'};border:1px solid ${totalPnl >= 0 ? '#1e4d2b' : '#4d1e1e'};border-radius:4px;font-size:0.8rem">
              <span style="color:#888">实时:</span>
              <span style="color:${totalPnl >= 0 ? '#2ecc71' : '#e74c3c'};font-weight:700">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</span>
            </span>
            <span style="padding:0.3rem 0.6rem;background:${settledPnl >= 0 ? '#1e4d2b22' : '#4d1e1e22'};border:1px solid ${settledPnl >= 0 ? '#1e4d2b' : '#4d1e1e'};border-radius:4px;font-size:0.8rem">
              <span style="color:#888">已结算:</span>
              <span style="color:${settledPnl >= 0 ? '#2ecc71' : '#e74c3c'};font-weight:700">${settledPnl >= 0 ? '+' : ''}$${settledPnl.toFixed(2)}</span>
            </span>
            <span style="padding:0.3rem 0.6rem;background:${settledExpiredPnl >= 0 ? '#1e4d2b22' : '#4d1e1e22'};border:1px solid ${settledExpiredPnl >= 0 ? '#1e4d2b' : '#4d1e1e'};border-radius:4px;font-size:0.8rem">
              <span style="color:#888">已结算+已截止:</span>
              <span style="color:${settledExpiredPnl >= 0 ? '#2ecc71' : '#e74c3c'};font-weight:700">${settledExpiredPnl >= 0 ? '+' : ''}$${settledExpiredPnl.toFixed(2)}</span>
            </span>
            <span style="color:#888;font-size:0.8rem">(${filtered.length}条)</span>` : ''}
            <label style="color:#888;font-size:0.8rem;margin-left:0.5rem">自动刷新:</label>
            <select onchange="${refreshJs}" style="${selStyle}">
              ${opts}
            </select>
          </div>
        </div>
        <div id="ct-filter" style="display:flex;gap:0.75rem;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap">
          <input type="hidden" name="_interval" value="${refreshInterval}">
          <div style="display:flex;align-items:center;gap:4px">
            <label style="color:#888;font-size:0.8rem">钱包:</label>
            <select name="wallet" onchange="${filterJs}" style="${selStyle}">${walletOpts}</select>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <label style="color:#888;font-size:0.8rem">市场:</label>
            <input name="market" type="text" placeholder="搜索市场名称…" value="${filter.market ?? ''}" onkeydown="if(event.key==='Enter'){${filterJs}}" style="${inputStyle}">
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <label style="color:#888;font-size:0.8rem">方向:</label>
            <select name="side" onchange="${filterJs}" style="${selStyle}">${sideOpts}</select>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <label style="color:#888;font-size:0.8rem">状态:</label>
            <select name="status" onchange="${filterJs}" style="${selStyle}">${statusOpts}</select>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <label style="color:#888;font-size:0.8rem">时间:</label>
            <select name="time" onchange="${filterJs}" style="${selStyle}">${timeOpts}</select>
          </div>
        </div>
        <table>
          <thead><tr><th>时间</th><th>钱包</th><th>市场</th><th>结果</th><th>状态</th><th>方向</th><th>原始金额</th><th>入场价</th><th>当前价</th><th>盈亏</th><th>跟单金额</th><th>交易哈希</th></tr></thead>
          <tbody>${copyRows || '<tr><td colspan="12" style="text-align:center;color:#888">暂无跟单记录</td></tr>'}</tbody>
        </table>
      </div>`
  }

  // Helper: render the copy-trading page body (reused by GET and POST)
  async function copyTradingBody(toast?: string) {
    const cfg = deps.config.copyTrading
    const wallets = cfg.wallets

    const walletRows = wallets.map(w => `<tr id="wr-${w.address}">
      <td style="font-family:monospace;font-size:0.85rem">${w.address.slice(0, 8)}…${w.address.slice(-6)}</td>
      <td>${w.label}</td>
      <td><span class="badge badge-warn">${w.sizeMode}</span></td>
      <td>${w.sizeMode === 'fixed' ? `$${w.fixedAmount}` : `${((w.proportionPct ?? 0) * 100).toFixed(0)}%`}</td>
      <td>${w.maxCopiesPerMarket ?? 1}</td>
      <td style="white-space:nowrap">
        <button hx-get="/copy-trading/wallet/edit?address=${encodeURIComponent(w.address)}" hx-target="#wr-${w.address}" hx-swap="outerHTML" style="background:#1e3a5e;color:#5b9bd5;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.8rem;margin-right:4px">编辑</button>
        <button hx-post="/copy-trading/wallet/delete" hx-vals='{"address":"${w.address}"}' hx-target="#ct-page" hx-swap="innerHTML" style="background:#4d1e1e;color:#e74c3c;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.8rem">移除</button>
      </td>
    </tr>`).join('')

    const enabled = cfg.enabled
    const tradesCard = await copyTradingTradesCard()

    const toastHtml = toast
      ? `<div style="background:#1e4d2b;border:1px solid #2ecc71;color:#2ecc71;padding:0.5rem 1rem;border-radius:4px;margin-bottom:1rem">${toast}</div>`
      : ''

    const archiveCfg = cfg.archive ?? { enabled: false, autoArchiveDays: 30 }
    const dateInputStyle = 'background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-size:0.85rem'
    const yesterday = new Date(Date.now() - 86400000)
    const yesterdayStart = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}T00:00`
    const yesterdayEnd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}T23:59`
    const archivePanel = `
      <div class="card" style="margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;color:#7c83fd">归档设置</h3>
        <form hx-post="/copy-trading/archive/config" hx-target="#ct-page" hx-swap="innerHTML"
              style="display:grid;grid-template-columns:auto 1fr auto auto;gap:0.75rem;align-items:end">
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">启用自动归档</label>
            <input name="enabled" type="checkbox" ${archiveCfg.enabled ? 'checked' : ''}
                   style="width:16px;height:16px;margin-top:6px">
          </div>
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">超过 N 天自动归档</label>
            <input name="autoArchiveDays" type="number" min="1" max="365" value="${archiveCfg.autoArchiveDays}"
                   style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px">
          </div>
          <button type="submit"
                  style="background:#1e3a5e;color:#5b9bd5;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;height:34px">
            保存
          </button>
          <button type="button"
                  hx-post="/copy-trading/archive/now" hx-target="#ct-page" hx-swap="innerHTML"
                  style="background:#3a2a1e;color:#e0a84c;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;height:34px">
            立即归档
          </button>
        </form>
        <div style="border-top:1px solid #3a3a5e;margin-top:1rem;padding-top:1rem">
          <h4 style="color:#e74c3c;font-size:0.9rem;margin-bottom:0.75rem">清除活跃数据</h4>
          <form hx-post="/copy-trading/archive/clear" hx-target="#ct-page" hx-swap="innerHTML"
                style="display:flex;gap:0.75rem;align-items:end;flex-wrap:wrap">
            <input type="hidden" name="target" value="active">
            <div>
              <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">起始时间</label>
              <input name="from" type="datetime-local" value="${yesterdayStart}" required style="${dateInputStyle}">
            </div>
            <div>
              <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">结束时间</label>
              <input name="to" type="datetime-local" value="${yesterdayEnd}" required style="${dateInputStyle}">
            </div>
            <button type="submit"
                    onclick="return confirm('确定清除所选日期范围内的活跃跟单数据？此操作不可撤销！')"
                    style="background:#4d1e1e;color:#e74c3c;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;height:34px">
              清除活跃数据
            </button>
          </form>
        </div>
      </div>`

    return `
      ${toastHtml}
      <h2 style="margin-bottom:0.5rem">跟单交易</h2>
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem">
        <span style="color:#888">状态: <span class="badge ${enabled ? 'badge-ok' : 'badge-err'}">${enabled ? '已启用' : '已禁用'}</span></span>
        <button hx-post="/copy-trading/toggle" hx-target="#ct-page" hx-swap="innerHTML" style="background:${enabled ? '#4d1e1e' : '#1e4d2b'};color:${enabled ? '#e74c3c' : '#2ecc71'};border:none;padding:6px 16px;border-radius:4px;cursor:pointer">${enabled ? '禁用' : '启用'}</button>
      </div>

      <div class="card" style="margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;color:#7c83fd">风控限制</h3>
        <form hx-post="/copy-trading/limits" hx-target="#ct-page" hx-swap="innerHTML" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:0.75rem;align-items:end">
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">轮询间隔（秒）</label>
            <input name="pollInterval" type="number" min="1" value="${cfg.pollIntervalSeconds ?? 30}" style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px">
          </div>
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">每钱包日交易上限</label>
            <input name="maxDailyTrades" type="number" value="${cfg.maxDailyTradesPerWallet}" style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px">
          </div>
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">单钱包最大敞口 (USDC)</label>
            <input name="maxWalletExposure" type="number" value="${cfg.maxWalletExposureUsdc}" style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px">
          </div>
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">总最大敞口 (USDC)</label>
            <input name="maxTotalExposure" type="number" value="${cfg.maxTotalExposureUsdc}" style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px">
          </div>
          <button type="submit" style="background:#1e3a5e;color:#5b9bd5;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;height:34px">保存</button>
        </form>
      </div>

      <div class="card" style="margin-bottom:1rem">
        <h3 style="margin-bottom:1rem;color:#7c83fd">监控钱包</h3>
        <table>
          <thead><tr><th>地址</th><th>标签</th><th>模式</th><th>金额</th><th>每市场上限</th><th></th></tr></thead>
          <tbody>${walletRows || '<tr><td colspan="6" style="text-align:center;color:#888">暂无配置钱包</td></tr>'}</tbody>
        </table>
        <h4 style="margin:1.25rem 0 0.75rem;color:#888;font-size:0.9rem">添加钱包</h4>
        <form hx-post="/copy-trading/wallet" hx-target="#ct-page" hx-swap="innerHTML" style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;gap:0.75rem;align-items:end">
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">地址</label>
            <input name="address" type="text" placeholder="0x..." required style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-family:monospace;font-size:0.85rem">
          </div>
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">标签</label>
            <input name="label" type="text" placeholder="大户" required style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px">
          </div>
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">模式</label>
            <select name="sizeMode" style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px">
              <option value="fixed">固定金额</option>
              <option value="proportional">按比例</option>
            </select>
          </div>
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">金额 / %</label>
            <input name="amount" type="number" step="0.01" value="50" required style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px">
          </div>
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">每市场上限</label>
            <input name="maxCopiesPerMarket" type="number" min="1" value="1" required style="width:100%;background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:6px 10px;border-radius:4px">
          </div>
          <button type="submit" style="background:#1e4d2b;color:#2ecc71;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;height:34px">添加</button>
        </form>
      </div>

      ${archivePanel}

      ${tradesCard}
    `
  }

  app.get('/copy-trading', async (c) => {
    return c.html(layout('跟单', `<div id="ct-page">${await copyTradingBody()}</div>`))
  })

  // HTMX polling: return just the trades card with optional filters
  app.get('/copy-trading/trades', async (c) => {
    const interval = Math.max(0, Number(c.req.query('interval') ?? 10))
    const filter: TradesFilter = {
      wallet: c.req.query('wallet') || undefined,
      market: c.req.query('market') || undefined,
      side: c.req.query('side') || undefined,
      status: c.req.query('status') || undefined,
      time: c.req.query('time') || undefined,
    }
    return c.html(await copyTradingTradesCard(interval, filter))
  })

  // POST: toggle enable/disable
  app.post('/copy-trading/toggle', async (c) => {
    deps.config.copyTrading.enabled = !deps.config.copyTrading.enabled
    applyConfig()
    return c.html(await copyTradingBody())
  })

  // POST: add wallet
  app.post('/copy-trading/wallet', async (c) => {
    const body = await c.req.parseBody()
    const address = String(body.address ?? '').trim()
    const label = String(body.label ?? '').trim()
    const sizeMode = String(body.sizeMode ?? 'fixed') as SizeMode
    const amount = Number(body.amount ?? 50)
    const maxCopiesPerMarket = Math.max(1, Number(body.maxCopiesPerMarket ?? 1))

    if (address && label) {
      const exists = deps.config.copyTrading.wallets.some(w => w.address.toLowerCase() === address.toLowerCase())
      if (!exists) {
        deps.config.copyTrading.wallets.push({
          address,
          label,
          sizeMode,
          ...(sizeMode === 'fixed' ? { fixedAmount: amount } : { proportionPct: amount / 100 }),
          maxCopiesPerMarket,
        })
        applyConfig()
      }
    }
    return c.html(await copyTradingBody())
  })

  // POST: remove wallet
  app.post('/copy-trading/wallet/delete', async (c) => {
    const body = await c.req.parseBody()
    const address = String(body.address ?? '').trim()
    deps.config.copyTrading.wallets = deps.config.copyTrading.wallets.filter(
      w => w.address.toLowerCase() !== address.toLowerCase()
    )
    applyConfig()
    return c.html(await copyTradingBody())
  })

  // GET: inline edit form for a wallet row
  app.get('/copy-trading/wallet/edit', (c) => {
    const address = c.req.query('address') ?? ''
    const w = deps.config.copyTrading.wallets.find(w => w.address === address)
    if (!w) return c.html('')
    const s = 'background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:4px 8px;border-radius:4px;font-size:0.85rem;width:100%'
    const amount = w.sizeMode === 'fixed' ? (w.fixedAmount ?? 50) : ((w.proportionPct ?? 0.1) * 100)
    return c.html(`<tr id="wr-${w.address}">
      <td style="font-family:monospace;font-size:0.85rem">${w.address.slice(0, 8)}…${w.address.slice(-6)}</td>
      <td><input form="edit-${w.address}" name="label" value="${w.label}" style="${s}"></td>
      <td><select form="edit-${w.address}" name="sizeMode" style="${s}">
        <option value="fixed"${w.sizeMode === 'fixed' ? ' selected' : ''}>固定金额</option>
        <option value="proportional"${w.sizeMode === 'proportional' ? ' selected' : ''}>按比例</option>
      </select></td>
      <td><input form="edit-${w.address}" name="amount" type="number" step="0.01" value="${amount}" style="${s}"></td>
      <td><input form="edit-${w.address}" name="maxCopiesPerMarket" type="number" min="1" value="${w.maxCopiesPerMarket ?? 1}" style="${s}"></td>
      <td style="white-space:nowrap">
        <form id="edit-${w.address}" hx-post="/copy-trading/wallet/update" hx-target="#ct-page" hx-swap="innerHTML" style="display:inline">
          <input type="hidden" name="address" value="${w.address}">
          <button type="submit" style="background:#1e4d2b;color:#2ecc71;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.8rem;margin-right:4px">保存</button>
        </form>
        <button hx-get="/copy-trading/wallet/row?address=${encodeURIComponent(w.address)}" hx-target="#wr-${w.address}" hx-swap="outerHTML" style="background:#3a3a5e;color:#888;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.8rem">取消</button>
      </td>
    </tr>`)
  })

  // GET: return a single display row (for cancel)
  app.get('/copy-trading/wallet/row', (c) => {
    const address = c.req.query('address') ?? ''
    const w = deps.config.copyTrading.wallets.find(w => w.address === address)
    if (!w) return c.html('')
    return c.html(`<tr id="wr-${w.address}">
      <td style="font-family:monospace;font-size:0.85rem">${w.address.slice(0, 8)}…${w.address.slice(-6)}</td>
      <td>${w.label}</td>
      <td><span class="badge badge-warn">${w.sizeMode}</span></td>
      <td>${w.sizeMode === 'fixed' ? `$${w.fixedAmount}` : `${((w.proportionPct ?? 0) * 100).toFixed(0)}%`}</td>
      <td>${w.maxCopiesPerMarket ?? 1}</td>
      <td style="white-space:nowrap">
        <button hx-get="/copy-trading/wallet/edit?address=${encodeURIComponent(w.address)}" hx-target="#wr-${w.address}" hx-swap="outerHTML" style="background:#1e3a5e;color:#5b9bd5;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.8rem;margin-right:4px">编辑</button>
        <button hx-post="/copy-trading/wallet/delete" hx-vals='{"address":"${w.address}"}' hx-target="#ct-page" hx-swap="innerHTML" style="background:#4d1e1e;color:#e74c3c;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.8rem">移除</button>
      </td>
    </tr>`)
  })

  // POST: save wallet edits
  app.post('/copy-trading/wallet/update', async (c) => {
    const body = await c.req.parseBody()
    const address = String(body.address ?? '').trim()
    const w = deps.config.copyTrading.wallets.find(w => w.address.toLowerCase() === address.toLowerCase())
    if (w) {
      const label = String(body.label ?? '').trim()
      const sizeMode = String(body.sizeMode ?? w.sizeMode) as SizeMode
      const amount = Number(body.amount ?? 50)
      const maxCopiesPerMarket = Math.max(1, Number(body.maxCopiesPerMarket ?? 1))
      if (label) w.label = label
      w.sizeMode = sizeMode
      if (sizeMode === 'fixed') {
        w.fixedAmount = amount
        delete (w as any).proportionPct
      } else {
        w.proportionPct = amount / 100
        delete (w as any).fixedAmount
      }
      w.maxCopiesPerMarket = maxCopiesPerMarket
      applyConfig()
    }
    return c.html(await copyTradingBody())
  })

  // POST: update risk limits
  app.post('/copy-trading/limits', async (c) => {
    const body = await c.req.parseBody()
    const pollInterval = Number(body.pollInterval)
    const maxDaily = Number(body.maxDailyTrades)
    const maxWallet = Number(body.maxWalletExposure)
    const maxTotal = Number(body.maxTotalExposure)
    if (pollInterval >= 1) deps.config.copyTrading.pollIntervalSeconds = pollInterval
    if (maxDaily > 0) deps.config.copyTrading.maxDailyTradesPerWallet = maxDaily
    if (maxWallet > 0) deps.config.copyTrading.maxWalletExposureUsdc = maxWallet
    if (maxTotal > 0) deps.config.copyTrading.maxTotalExposureUsdc = maxTotal
    applyConfig()
    return c.html(await copyTradingBody('风控限制已保存'))
  })

  // POST: save archive config
  app.post('/copy-trading/archive/config', async (c) => {
    const body = await c.req.parseBody()
    const enabled = body.enabled === 'on'
    const days = Math.max(1, Number(body.autoArchiveDays ?? 30))
    deps.config.copyTrading.archive = { enabled, autoArchiveDays: days }
    applyConfig()
    return c.html(await copyTradingBody())
  })

  // POST: manual archive now
  app.post('/copy-trading/archive/now', async (c) => {
    const count = deps.archiveService?.archiveNow(
      deps.config.copyTrading.archive?.autoArchiveDays ?? 30
    ) ?? 0
    return c.html(await copyTradingBody(`已归档 ${count} 条记录`))
  })

  // POST: clear data by date range
  app.post('/copy-trading/archive/clear', async (c) => {
    const body = await c.req.parseBody()
    const fromStr = String(body.from ?? '')
    const toStr = String(body.to ?? '')
    if (!fromStr || !toStr) {
      if (String(body.target) === 'archive') return c.redirect('/copy-trading/history')
      return c.html(await copyTradingBody('请选择起始和结束日期'))
    }
    const from = Math.floor(new Date(fromStr).getTime() / 1000)
    const to = Math.floor(new Date(toStr).getTime() / 1000) + 59
    const target = String(body.target) as 'archive' | 'active' | 'all'
    const count = deps.archiveService?.clearData(from, to, target) ?? 0
    if (target === 'archive') {
      return c.redirect('/copy-trading/history')
    }
    return c.html(await copyTradingBody(`已清除 ${count} 条记录`))
  })

  // GET: archive history page
  app.get('/copy-trading/history', async (c) => {
    const wallet = c.req.query('wallet') || undefined
    const days = c.req.query('days') ? Number(c.req.query('days')) : undefined
    const page = Math.max(0, Number(c.req.query('page') ?? 0))
    const pageSize = 100

    const since = days != null ? Math.floor(Date.now() / 1000) - days * 86400 : undefined
    const { rows, total } = deps.archiveRepo?.findAll({ label: wallet, since, page, pageSize })
      ?? { rows: [], total: 0 }

    const walletLabels = [...new Set(deps.config.copyTrading.wallets.map(w => w.label))]
    const selStyle = 'background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:4px 8px;border-radius:4px;font-size:0.8rem'

    const walletOpts = [`<option value="">全部钱包</option>`]
      .concat(walletLabels.map(l => `<option value="${l}"${wallet === l ? ' selected' : ''}>${l}</option>`))
      .join('')

    const dayOpts = [
      { v: '', label: '全部时间' },
      { v: '7', label: '近7天' },
      { v: '30', label: '近30天' },
      { v: '90', label: '近90天' },
      { v: '365', label: '近1年' },
    ].map(o => `<option value="${o.v}"${String(days ?? '') === o.v ? ' selected' : ''}>${o.label}</option>`).join('')

    const archiveRows = rows.map(r => `<tr>
      <td style="color:#888;font-size:0.8rem">${new Date(r.timestamp * 1000).toLocaleString()}</td>
      <td>${r.label}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.85rem">${r.title || r.marketId.slice(0, 16) + '…'}</td>
      <td><span style="color:#c0a0ff;font-weight:600">${r.outcome || '-'}</span></td>
      <td><span class="badge ${r.side === 'buy' ? 'badge-ok' : 'badge-err'}">${r.side}</span></td>
      <td>$${r.originalSize.toFixed(2)}</td>
      <td>$${r.price.toFixed(3)}</td>
      <td>$${r.copiedSize.toFixed(2)}</td>
      <td style="font-size:0.8rem"><a href="https://polygonscan.com/tx/${r.txHash}" target="_blank" style="color:#5b9bd5;text-decoration:none">${r.txHash.slice(0, 10)}…</a></td>
      <td style="color:#888;font-size:0.75rem">${r.archivedAt}</td>
    </tr>`).join('')

    const totalPages = Math.ceil(total / pageSize)
    const buildQs = (p: number) => {
      const ps = new URLSearchParams()
      if (wallet) ps.set('wallet', wallet)
      if (days != null) ps.set('days', String(days))
      ps.set('page', String(p))
      return ps.toString()
    }
    const pagination = totalPages > 1 ? `
      <div style="display:flex;gap:0.5rem;justify-content:center;margin-top:1rem">
        ${page > 0 ? `<a href="/copy-trading/history?${buildQs(page - 1)}" style="color:#5b9bd5">← 上一页</a>` : ''}
        <span style="color:#888">第 ${page + 1} / ${totalPages} 页 (共 ${total} 条)</span>
        ${page < totalPages - 1 ? `<a href="/copy-trading/history?${buildQs(page + 1)}" style="color:#5b9bd5">下一页 →</a>` : ''}
      </div>` : `<div style="color:#888;font-size:0.8rem;text-align:right;margin-top:0.5rem">共 ${total} 条归档记录</div>`

    const filterJs = `window.location='/copy-trading/history?'+new URLSearchParams({wallet:document.getElementById('h-wallet').value,days:document.getElementById('h-days').value,page:'0'}).toString()`

    const historyDateInputStyle = 'background:#2a2a3e;border:1px solid #3a3a5e;color:#e0e0e0;padding:4px 8px;border-radius:4px;font-size:0.8rem'
    const hYesterday = new Date(Date.now() - 86400000)
    const hYesterdayStart = `${hYesterday.getFullYear()}-${String(hYesterday.getMonth() + 1).padStart(2, '0')}-${String(hYesterday.getDate()).padStart(2, '0')}T00:00`
    const hYesterdayEnd = `${hYesterday.getFullYear()}-${String(hYesterday.getMonth() + 1).padStart(2, '0')}-${String(hYesterday.getDate()).padStart(2, '0')}T23:59`

    return c.html(layout('历史存档', `
      <h2 style="margin-bottom:1rem">历史存档</h2>
      <div class="card">
        <div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:4px">
            <label style="color:#888;font-size:0.8rem">钱包:</label>
            <select id="h-wallet" onchange="${filterJs}" style="${selStyle}">${walletOpts}</select>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <label style="color:#888;font-size:0.8rem">时间:</label>
            <select id="h-days" onchange="${filterJs}" style="${selStyle}">${dayOpts}</select>
          </div>
          <a href="/copy-trading" style="margin-left:auto;color:#5b9bd5;font-size:0.85rem">← 返回跟单</a>
        </div>
        <form method="POST" action="/copy-trading/archive/clear"
              style="display:flex;gap:0.75rem;align-items:end;margin-bottom:0.75rem;flex-wrap:wrap;padding:0.75rem;background:#1a1a2e;border-radius:4px;border:1px solid #3a3a5e">
          <input type="hidden" name="target" value="archive">
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">起始时间</label>
            <input name="from" type="datetime-local" value="${hYesterdayStart}" required style="${historyDateInputStyle}">
          </div>
          <div>
            <label style="color:#888;font-size:0.8rem;display:block;margin-bottom:4px">结束时间</label>
            <input name="to" type="datetime-local" value="${hYesterdayEnd}" required style="${historyDateInputStyle}">
          </div>
          <button type="submit"
                  onclick="return confirm('确定清除所选日期范围内的归档数据？此操作不可撤销！')"
                  style="background:#4d1e1e;color:#e74c3c;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;height:34px;font-size:0.85rem">
            清除归档数据
          </button>
        </form>
        <table>
          <thead><tr><th>时间</th><th>钱包</th><th>市场</th><th>结果</th><th>方向</th><th>原始金额</th><th>入场价</th><th>跟单金额</th><th>交易哈希</th><th>归档时间</th></tr></thead>
          <tbody>${archiveRows || '<tr><td colspan="10" style="text-align:center;color:#888">暂无归档记录</td></tr>'}</tbody>
        </table>
        ${pagination}
      </div>
    `))
  })

  // ── Screener Routes ──────────────────────────────────────────

  app.get('/screener', (c) => {
    const screener = deps.screenerService
    const state = screener?.getState() ?? { status: 'idle' as const, progress: 0, progressLabel: '', results: [] as ScreenerResult[], lastError: null }
    const cfg = screener?.getConfig() ?? { enabled: false, scheduleCron: 'disabled' as const, lastRunAt: null }
    return c.html(layout('智能筛选', screenerPageHtml(state, cfg, !screener)))
  })

  app.post('/screener/run', async (c) => {
    const screener = deps.screenerService
    if (!screener) return c.text('Screener not configured', 500)
    screener.run().catch((err) => console.error('[Screener] Manual run failed:', err))
    return c.html(screenerProgressHtml(screener.getState()))
  })

  app.get('/screener/progress', (c) => {
    const screener = deps.screenerService
    const state = screener?.getState() ?? { status: 'idle' as const, progress: 0, progressLabel: '', results: [] as ScreenerResult[], lastError: null }
    if (state.status === 'done' || state.status === 'error') {
      return c.html(screenerResultsHtml(state))
    }
    return c.html(screenerProgressHtml(state))
  })

  app.get('/screener/results', (c) => {
    const screener = deps.screenerService
    const state = screener?.getState() ?? { status: 'idle' as const, progress: 0, progressLabel: '', results: [] as ScreenerResult[], lastError: null }
    return c.html(screenerResultsHtml(state))
  })

  app.post('/screener/add-wallet', async (c) => {
    const body = await c.req.parseBody()
    const address = String(body.address ?? '')
    const label = String(body.label ?? '')
    const sizeMode = String(body.sizeMode ?? 'fixed') as 'fixed' | 'proportional'
    const amount = Number(body.amount ?? 30)
    const maxCopiesPerMarket = Number(body.maxCopiesPerMarket ?? 2)

    if (!address) return c.text('Missing address', 400)

    const existing = deps.config.copyTrading.wallets.find(w => w.address.toLowerCase() === address.toLowerCase())
    if (existing) return c.html('<span class="badge badge-warn">已在跟单列表中</span>')

    deps.config.copyTrading.wallets.push({
      address: address.toLowerCase(),
      label: label || address.slice(0, 10),
      sizeMode,
      fixedAmount: sizeMode === 'fixed' ? amount : undefined,
      proportionPct: sizeMode === 'proportional' ? amount : undefined,
      maxCopiesPerMarket,
    })
    applyConfig()
    return c.html('<span class="badge badge-ok">已添加到跟单</span>')
  })

  app.post('/screener/schedule', async (c) => {
    const body = await c.req.parseBody()
    const schedule = String(body.schedule ?? 'disabled')
    const validSchedule = schedule === 'daily' ? 'daily' as const : 'disabled' as const
    deps.screenerService?.updateConfig({
      enabled: validSchedule === 'daily',
      scheduleCron: validSchedule,
    })
    return c.html(`<span class="badge badge-ok">${validSchedule === 'daily' ? '已开启每日筛选' : '已关闭定时筛选'}</span>`)
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

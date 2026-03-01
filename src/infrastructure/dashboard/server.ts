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
import { ScreenerService as ScreenerServiceClass } from '../../strategies/copy-trading/screener/index.ts'
import type { ScreenerResult, ScreenerState } from '../../strategies/copy-trading/screener/types.ts'
import type { LLMConfigStore } from '../llm-config-store.ts'
import type { ReviewService } from '../../strategies/review/index.ts'
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
  llmConfigStore?: LLMConfigStore
  reviewService?: ReviewService
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

  function maskKey(key: string): string {
    if (!key || key.length < 8) return key ? '****' : ''
    return key.slice(0, 4) + '****' + key.slice(-4)
  }

  function screenerPageHtml(state: ScreenerState, cfg: { scheduleCron: string; lastRunAt: number | null; closedPositionsLimit?: number }, llmCfg: { provider: string; apiKey: string; model: string; baseUrl?: string; ollamaHost?: string }, hasScreener: boolean): string {
    const lastRun = cfg.lastRunAt ? new Date(cfg.lastRunAt * 1000).toLocaleString() : '从未'
    const maskedKey = maskKey(llmCfg.apiKey)
    const hasKey = !!llmCfg.apiKey

    const llmConfigForm = `
    <div class="card" style="margin-bottom:1rem">
      <h3 style="margin-bottom:0.75rem;color:#7c83fd">LLM 配置</h3>
      <form hx-post="/screener/llm-config" hx-target="#screener-page" hx-swap="innerHTML"
        style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;align-items:end">
        <div>
          <label style="color:#888;font-size:0.85rem;display:block;margin-bottom:0.25rem">Provider</label>
          <select name="provider" style="width:100%;background:#2a2a3e;color:#e0e0e0;border:1px solid #3a3a4e;padding:0.4rem;border-radius:4px">
            <option value="claude" ${llmCfg.provider === 'claude' ? 'selected' : ''}>Claude (Anthropic)</option>
            <option value="openai" ${llmCfg.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
            <option value="gemini" ${llmCfg.provider === 'gemini' ? 'selected' : ''}>Gemini</option>
            <option value="ollama" ${llmCfg.provider === 'ollama' ? 'selected' : ''}>Ollama (本地)</option>
          </select>
        </div>
        <div>
          <label style="color:#888;font-size:0.85rem;display:block;margin-bottom:0.25rem">模型</label>
          <input name="model" value="${escHtml(llmCfg.model)}" placeholder="e.g. claude-sonnet-4-20250514"
            style="width:100%;background:#2a2a3e;color:#e0e0e0;border:1px solid #3a3a4e;padding:0.4rem;border-radius:4px;box-sizing:border-box">
        </div>
        <div>
          <label style="color:#888;font-size:0.85rem;display:block;margin-bottom:0.25rem">API Key ${maskedKey ? `<span style="color:#555;font-size:0.8rem">(当前: ${maskedKey})</span>` : ''}</label>
          <input name="apiKey" type="password" placeholder="${hasKey ? '留空保持不变' : '输入 API Key'}"
            style="width:100%;background:#2a2a3e;color:#e0e0e0;border:1px solid #3a3a4e;padding:0.4rem;border-radius:4px;box-sizing:border-box">
        </div>
        <div>
          <label style="color:#888;font-size:0.85rem;display:block;margin-bottom:0.25rem">Base URL <span style="color:#555;font-size:0.8rem">(中转站地址，留空用官方)</span></label>
          <input name="baseUrl" value="${escHtml(llmCfg.baseUrl ?? '')}" placeholder="https://api.example.com/v1"
            style="width:100%;background:#2a2a3e;color:#e0e0e0;border:1px solid #3a3a4e;padding:0.4rem;border-radius:4px;box-sizing:border-box">
        </div>
        <div>
          <label style="color:#888;font-size:0.85rem;display:block;margin-bottom:0.25rem">Ollama Host <span style="color:#555;font-size:0.8rem">(仅 Ollama)</span></label>
          <input name="ollamaHost" value="${escHtml(llmCfg.ollamaHost ?? '')}" placeholder="http://localhost:11434"
            style="width:100%;background:#2a2a3e;color:#e0e0e0;border:1px solid #3a3a4e;padding:0.4rem;border-radius:4px;box-sizing:border-box">
        </div>
        <div style="grid-column:1/-1;display:flex;gap:0.5rem;align-items:center">
          <button type="submit" style="background:#7c83fd;color:#fff;border:none;padding:0.5rem 1.5rem;border-radius:6px;cursor:pointer">保存 LLM 配置</button>
          ${hasKey ? '<span class="badge badge-ok">已配置</span>' : '<span class="badge badge-warn">未配置</span>'}
          <span id="llm-save-status"></span>
        </div>
      </form>
    </div>`

    const screenerControls = `
    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
        <button hx-post="/screener/run" hx-target="#screener-content" hx-swap="innerHTML"
          style="background:#7c83fd;color:#fff;border:none;padding:0.5rem 1.5rem;border-radius:6px;cursor:pointer;font-size:1rem${!hasKey ? ';opacity:0.5' : ''}"
          ${state.status === 'running' || !hasKey ? 'disabled' : ''}>
          ${state.status === 'running' ? '筛选中...' : '开始筛选'}
        </button>
        <form hx-post="/screener/schedule" hx-target="#schedule-status" hx-swap="innerHTML" style="display:flex;gap:0.5rem;align-items:center">
          <label style="color:#888;font-size:0.9rem">定时:</label>
          <select name="schedule" style="background:#2a2a3e;color:#e0e0e0;border:1px solid #3a3a4e;padding:0.3rem;border-radius:4px">
            <option value="disabled" ${cfg.scheduleCron === 'disabled' ? 'selected' : ''}>关闭</option>
            <option value="daily" ${cfg.scheduleCron === 'daily' ? 'selected' : ''}>每日</option>
          </select>
          <label style="color:#888;font-size:0.9rem;margin-left:0.5rem">历史结算:</label>
          <input name="closedPositionsLimit" type="number" value="${cfg.closedPositionsLimit ?? 200}" min="10" max="5000" step="10"
            style="width:5rem;background:#2a2a3e;color:#e0e0e0;border:1px solid #3a3a4e;padding:0.3rem;border-radius:4px;text-align:center;box-sizing:border-box">
          <span style="color:#555;font-size:0.75rem">笔</span>
          <button type="submit" style="background:#3a3a4e;color:#e0e0e0;border:none;padding:0.3rem 0.8rem;border-radius:4px;cursor:pointer">保存</button>
          <span id="schedule-status"></span>
        </form>
        <span style="color:#888;font-size:0.85rem">上次筛选: ${lastRun}</span>
      </div>
    </div>`

    return `
    <div id="screener-page">
    <h2 style="margin-bottom:1rem">智能钱包筛选</h2>
    ${llmConfigForm}
    ${screenerControls}
    <div id="screener-content">
      ${state.status === 'running' ? screenerProgressHtml(state) : screenerResultsHtml(state)}
    </div>
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

    const fmtUsd = (v: number) => v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'K' : '$' + v.toFixed(0)
    const scoreBar = (v: number) => {
      const color = v >= 80 ? '#2ecc71' : v >= 50 ? '#f39c12' : '#e74c3c'
      return `<span style="color:${color};font-weight:bold">${Math.round(v)}</span>`
    }

    const fmtFlow = (v: number) => {
      if (Math.abs(v) < 1) return '<span style="color:#888">—</span>'
      const color = v > 0 ? '#2ecc71' : '#e74c3c'
      const sign = v > 0 ? '+' : ''
      return `<span style="color:${color}">${sign}${fmtUsd(v)}</span>`
    }

    const periodCol = (label: string, p: { tradeCount: number; buyCount: number; sellCount: number; volume: number; netFlow: number; winCount?: number; winPnl?: number; lossCount?: number; lossPnl?: number } | undefined) => {
      if (!p) return `<td style="padding:0.3rem 0.5rem;color:#555;text-align:center">—</td>`
      const hasWinLoss = p.winCount != null
      let winLossHtml = ''
      if (hasWinLoss) {
        const totalClosed = (p.winCount ?? 0) + (p.lossCount ?? 0)
        if (totalClosed === 0) {
          winLossHtml = `<div style="font-size:0.75rem;color:#555">无已结算持仓</div>`
        } else {
          winLossHtml = `<div style="font-size:0.8rem"><span style="color:#2ecc71">赢${p.winCount}笔 +${fmtUsd(p.winPnl ?? 0)}</span> / <span style="color:#e74c3c">亏${p.lossCount}笔 -${fmtUsd(p.lossPnl ?? 0)}</span></div>`
        }
      }
      return `<td style="padding:0.3rem 0.5rem;border-left:1px solid #1e1e2e;vertical-align:top">
        <div style="font-size:0.75rem;color:#666;margin-bottom:2px">${label}</div>
        <div style="font-size:0.85rem">${p.tradeCount}笔 <span style="color:#3498db;font-size:0.75rem">(买${p.buyCount}/卖${p.sellCount})</span></div>
        <div style="font-size:0.8rem;color:#aaa">量: ${fmtUsd(p.volume)}</div>
        <div style="font-size:0.8rem">净: ${fmtFlow(p.netFlow)}</div>
        ${winLossHtml}
      </td>`
    }

    const cards = state.results.map((r: ScreenerResult, i: number) => {
      const polymarketUrl = `https://polymarket.com/profile/${r.address}`
      const m = r.metrics
      const recencyLabel = m
        ? (m.daysSinceLastTrade === 0 ? '今天' : m.daysSinceLastTrade === 999 ? '未知' : m.daysSinceLastTrade + '天前')
        : '-'

      return `
      <div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem">
          <div>
            <a href="${polymarketUrl}" target="_blank" rel="noopener" style="color:#7c83fd;font-weight:bold;font-size:1.1rem;text-decoration:none">#${i + 1} ${escHtml(r.username || r.address.slice(0, 10))} ↗</a>
            <span style="color:#888;font-size:0.8rem;margin-left:0.5rem" title="${r.address}">${r.address.slice(0, 6)}...${r.address.slice(-4)}</span>
            <span style="margin-left:0.5rem">排名 #${r.rank}</span>
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center">
            ${levelBadge(r.recommendation.level)}
            <span style="background:#2a2a3e;padding:2px 8px;border-radius:4px;font-size:0.85rem">综合 ${r.totalScore}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:0.5rem;font-size:0.85rem">
          <div><span style="color:#888">PnL:</span> <span class="${r.pnl >= 0 ? 'positive' : 'negative'}">${fmtUsd(r.pnl)}</span></div>
          <div><span style="color:#888">成交量:</span> ${fmtUsd(r.volume)}</div>
          <div><span style="color:#888">持仓:</span> ${fmtUsd(r.totalPortfolioValue)}</div>
          <div><span style="color:#888">近期:</span> ${m ? m.tradeCount + '笔 / 均' + fmtUsd(m.avgTradeSize) : '-'}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:0.75rem;font-size:0.82rem;background:#0d0d1a;border-radius:4px;padding:0.4rem 0.5rem">
          <div style="display:flex;flex-direction:column;gap:2px">
            <span style="color:#888;font-size:0.75rem">收益评分 (35%)</span>
            ${scoreBar(r.scores.returns)}
          </div>
          <div style="display:flex;flex-direction:column;gap:2px">
            <span style="color:#888;font-size:0.75rem">活跃评分 (25%)</span>
            ${scoreBar(r.scores.activity)}
          </div>
          <div style="display:flex;flex-direction:column;gap:2px">
            <span style="color:#888;font-size:0.75rem">规模评分 (20%)</span>
            ${scoreBar(r.scores.portfolioSize)}
          </div>
          <div style="display:flex;flex-direction:column;gap:2px">
            <span style="color:#888;font-size:0.75rem">分散评分 (20%)</span>
            ${scoreBar(r.scores.diversification)}
          </div>
        </div>
        ${m ? '' : `<div style="margin-bottom:0.75rem;padding:0.4rem 0.6rem;background:#0d0d1a;border-radius:4px;font-size:0.78rem;color:#555">时间段数据需重新运行筛选后显示 →
          <button hx-post="/screener/run" hx-target="#screener-content" hx-swap="innerHTML"
            style="background:none;border:1px solid #333;color:#7c83fd;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:0.78rem;margin-left:0.4rem">重新筛选</button>
        </div>`}
        ${m ? `
        <div style="margin-bottom:0.75rem;overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
            <thead>
              <tr style="background:#0d0d1a">
                <td style="padding:0.3rem 0.5rem;color:#555;font-size:0.75rem">时间段</td>
                <td style="padding:0.3rem 0.5rem;border-left:1px solid #1e1e2e;color:#555;font-size:0.75rem">24小时</td>
                <td style="padding:0.3rem 0.5rem;border-left:1px solid #1e1e2e;color:#555;font-size:0.75rem">7天</td>
                <td style="padding:0.3rem 0.5rem;border-left:1px solid #1e1e2e;color:#555;font-size:0.75rem">30天</td>
              </tr>
            </thead>
            <tbody>
              <tr style="border-top:1px solid #1e1e2e">
                <td></td>
                ${periodCol('', m.periods.day)}
                ${periodCol('', m.periods.week)}
                ${periodCol('', m.periods.month)}
              </tr>
            </tbody>
          </table>
          <div style="font-size:0.75rem;color:#555;margin-top:4px;display:flex;gap:1.5rem;flex-wrap:wrap">
            <span><span style="color:#2ecc71">净&gt;0</span> 卖出多 → 获利了结 &nbsp;|&nbsp; <span style="color:#e74c3c">净&lt;0</span> 买入多 → 持续建仓（利于跟单）</span>
            <span style="color:#444">持仓市场 ${m.uniqueMarkets} 个 · 最近交易 ${recencyLabel}</span>
          </div>
          ${m.closedPositionSummary && m.closedPositionSummary.total > 0 ? `<div style="font-size:0.8rem;margin-top:6px;padding:6px 8px;background:#0d0d1a;border-radius:4px;display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center">
            <span style="color:#7c83fd;font-weight:bold">历史结算</span>
            <span>共 ${m.closedPositionSummary.total} 笔</span>
            <span>胜率 <span style="color:${m.closedPositionSummary.winRate >= 0.6 ? '#2ecc71' : m.closedPositionSummary.winRate >= 0.4 ? '#f39c12' : '#e74c3c'}">${(m.closedPositionSummary.winRate * 100).toFixed(1)}%</span></span>
            <span>赢 <span style="color:#2ecc71">${m.closedPositionSummary.wins}笔</span> / 亏 <span style="color:#e74c3c">${m.closedPositionSummary.losses}笔</span></span>
            <span>总盈亏 <span style="color:${m.closedPositionSummary.totalPnl >= 0 ? '#2ecc71' : '#e74c3c'}">${m.closedPositionSummary.totalPnl >= 0 ? '+' : ''}${fmtUsd(m.closedPositionSummary.totalPnl)}</span></span>
            <span style="color:#666">均盈亏 ${m.closedPositionSummary.avgPnlPerTrade >= 0 ? '+' : ''}${fmtUsd(m.closedPositionSummary.avgPnlPerTrade)}/笔</span>
          </div>` : ''}
        </div>` : ''}
        <div style="background:#12121e;border-radius:6px;padding:0.75rem;margin-bottom:0.75rem">
          <div style="font-size:0.85rem;margin-bottom:0.5rem"><strong style="color:#7c83fd">跟单理由:</strong> ${escHtml(r.recommendation.reasoning)}</div>
          <div style="font-size:0.85rem;margin-bottom:0.5rem"><strong style="color:#7c83fd">推荐策略:</strong> ${r.recommendation.suggestedSizeMode === 'fixed' ? '固定金额 $' + r.recommendation.suggestedAmount : '比例 ' + (r.recommendation.suggestedAmount * 100).toFixed(0) + '%'} | 单市场上限: ${r.recommendation.suggestedMaxCopiesPerMarket}次</div>
          <div style="font-size:0.85rem;color:#e74c3c">风险提示: ${escHtml(r.recommendation.riskWarning)}</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div id="screener-detail-toggle-${r.address}">
            ${r.detail ? `<button hx-get="/screener/detail/${r.address}" hx-target="#screener-detail-${r.address}" hx-swap="innerHTML"
              style="background:none;border:1px solid #333;color:#888;padding:0.3rem 0.75rem;border-radius:4px;cursor:pointer;font-size:0.8rem">📊 查看过程数据</button>` : ''}
          </div>
          <div id="add-wallet-${i}">
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
        <div id="screener-detail-${r.address}"></div>
      </div>
    `}).join('')

    const recommendedCount = state.results.filter((r: ScreenerResult) => r.recommendation.level === 'recommended').length
    const screenedAt = state.results[0]?.screenedAt
    const timeStr = screenedAt ? new Date(screenedAt * 1000).toLocaleString() : ''

    return `
    <div style="margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:0.9rem;color:#888">共 ${state.results.length} 个钱包 | ${recommendedCount} 个推荐 | 筛选时间: ${timeStr}</span>
    </div>
    ${cards}`
  }

  function screenerDetailHtml(r: ScreenerResult): string {
    const d = r.detail!
    const fmtTs = (ts: number) => new Date(ts * 1000).toLocaleString()
    const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString()
    const fmtUsdD = (v: number) => v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'K' : '$' + v.toFixed(0)

    // ── Positions ──
    const posRows = d.positions.length === 0
      ? '<tr><td colspan="4" style="color:#555;padding:0.5rem;text-align:center">暂无持仓</td></tr>'
      : [...d.positions]
          .sort((a, b) => b.currentValue - a.currentValue)
          .map(p => `<tr style="border-top:1px solid #1e1e2e">
            <td style="padding:0.3rem 0.5rem;font-size:0.8rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(p.title)}">${escHtml(p.title)}</td>
            <td style="padding:0.3rem 0.5rem;font-size:0.8rem">${escHtml(p.outcome)}</td>
            <td style="padding:0.3rem 0.5rem;font-size:0.8rem;text-align:right">${fmtUsdD(p.size)}</td>
            <td style="padding:0.3rem 0.5rem;font-size:0.8rem;text-align:right">${fmtUsdD(p.currentValue)}</td>
          </tr>`).join('')

    // ── Trades ──
    const sortedTrades = [...d.trades].sort((a, b) => b.timestamp - a.timestamp)
    const tradeRows = sortedTrades.length === 0
      ? '<tr><td colspan="5" style="color:#555;padding:0.5rem;text-align:center">无交易记录</td></tr>'
      : sortedTrades.map(t => {
          const sideColor = t.side === 'buy' ? '#3498db' : '#e67e22'
          return `<tr style="border-top:1px solid #1e1e2e">
            <td style="padding:0.25rem 0.5rem;font-size:0.78rem;color:#888">${fmtDate(t.timestamp)}</td>
            <td style="padding:0.25rem 0.5rem;font-size:0.78rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(t.title)}">${escHtml(t.title)}</td>
            <td style="padding:0.25rem 0.5rem;font-size:0.78rem;color:#aaa">${escHtml(t.outcome)}</td>
            <td style="padding:0.25rem 0.5rem;font-size:0.78rem;color:${sideColor};font-weight:bold">${t.side.toUpperCase()}</td>
            <td style="padding:0.25rem 0.5rem;font-size:0.78rem;text-align:right">${fmtUsdD(t.size)}</td>
            <td style="padding:0.25rem 0.5rem;font-size:0.78rem;text-align:right;color:#888">${(t.price * 100).toFixed(1)}%</td>
          </tr>`
        }).join('')

    return `
    <div style="border-top:1px solid #1e1e2e;margin-top:0.75rem;padding-top:0.75rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <span style="font-size:0.85rem;font-weight:bold;color:#7c83fd">过程数据 · 筛选时 ${fmtTs(r.screenedAt)}</span>
        <button hx-get="/screener/detail/${r.address}/close" hx-target="#screener-detail-${r.address}" hx-swap="innerHTML"
          style="background:none;border:1px solid #333;color:#888;padding:0.2rem 0.6rem;border-radius:4px;cursor:pointer;font-size:0.78rem">收起 ▲</button>
      </div>

      <div style="margin-bottom:1rem">
        <div style="font-size:0.8rem;color:#888;margin-bottom:0.4rem">当前持仓（${d.positions.length} 个）</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
            <thead><tr style="background:#0d0d1a;color:#666;font-size:0.75rem">
              <th style="padding:0.3rem 0.5rem;text-align:left;font-weight:normal">市场</th>
              <th style="padding:0.3rem 0.5rem;text-align:left;font-weight:normal">方向</th>
              <th style="padding:0.3rem 0.5rem;text-align:right;font-weight:normal">规模</th>
              <th style="padding:0.3rem 0.5rem;text-align:right;font-weight:normal">当前价值</th>
            </tr></thead>
            <tbody>${posRows}</tbody>
          </table>
        </div>
      </div>

      <div style="margin-bottom:1rem">
        <div style="font-size:0.8rem;color:#888;margin-bottom:0.4rem">30天交易记录（${d.trades.length} 笔，按时间倒序）</div>
        <div style="max-height:280px;overflow-y:auto;overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
            <thead><tr style="background:#0d0d1a;color:#666;font-size:0.75rem;position:sticky;top:0">
              <th style="padding:0.25rem 0.5rem;text-align:left;font-weight:normal">日期</th>
              <th style="padding:0.25rem 0.5rem;text-align:left;font-weight:normal">市场</th>
              <th style="padding:0.25rem 0.5rem;text-align:left;font-weight:normal">结果</th>
              <th style="padding:0.25rem 0.5rem;font-weight:normal">方向</th>
              <th style="padding:0.25rem 0.5rem;text-align:right;font-weight:normal">金额</th>
              <th style="padding:0.25rem 0.5rem;text-align:right;font-weight:normal">价格</th>
            </tr></thead>
            <tbody>${tradeRows}</tbody>
          </table>
        </div>
      </div>

      <details style="margin-bottom:0.5rem">
        <summary style="cursor:pointer;font-size:0.8rem;color:#666;padding:0.3rem 0;user-select:none">LLM 输入数据 ▸</summary>
        <pre style="background:#0a0a16;border-radius:4px;padding:0.75rem;font-size:0.72rem;color:#aaa;overflow-x:auto;margin-top:0.4rem;max-height:300px;overflow-y:auto">${escHtml(d.llmInput)}</pre>
      </details>

      <details>
        <summary style="cursor:pointer;font-size:0.8rem;color:#666;padding:0.3rem 0;user-select:none">LLM 原始响应 ▸</summary>
        <pre style="background:#0a0a16;border-radius:4px;padding:0.75rem;font-size:0.72rem;color:#aaa;overflow-x:auto;margin-top:0.4rem;max-height:200px;overflow-y:auto">${escHtml(d.llmRaw)}</pre>
      </details>
    </div>`
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
    const cfg = screener?.getConfig() ?? { enabled: false, scheduleCron: 'disabled' as const, lastRunAt: null, closedPositionsLimit: 200 }
    const llmCfg = { provider: deps.config.llm.provider || 'claude', apiKey: deps.config.llm.apiKey || '', model: deps.config.llm.model || '', baseUrl: deps.config.llm.baseUrl, ollamaHost: deps.config.llm.ollamaHost }
    return c.html(layout('智能筛选', screenerPageHtml(state, cfg, llmCfg, !!screener)))
  })

  app.post('/screener/llm-config', async (c) => {
    const body = await c.req.parseBody()
    const provider = (String(body.provider ?? 'claude')) as import('../../config/types.ts').LLMProviderName
    const model = String(body.model ?? '').trim()
    const apiKeyInput = String(body.apiKey ?? '').trim()
    const baseUrl = String(body.baseUrl ?? '').trim() || undefined
    const ollamaHost = String(body.ollamaHost ?? '').trim() || undefined

    // Keep existing key if input is empty
    const apiKey = apiKeyInput || deps.config.llm.apiKey

    // Update runtime config
    deps.config.llm.provider = provider
    deps.config.llm.model = model || deps.config.llm.model
    deps.config.llm.apiKey = apiKey
    deps.config.llm.baseUrl = baseUrl
    deps.config.llm.ollamaHost = ollamaHost

    // Persist to disk
    if (deps.llmConfigStore) {
      deps.llmConfigStore.save({
        provider,
        apiKey,
        model: deps.config.llm.model,
        baseUrl,
        ollamaHost,
      })
    }

    // Create or update screener service
    if (apiKey) {
      if (deps.screenerService) {
        deps.screenerService.updateLLM(apiKey, deps.config.llm.model || undefined, deps.config.llm.baseUrl)
      } else {
        const svc = new ScreenerServiceClass(apiKey, deps.config.llm.model || undefined, deps.config.llm.baseUrl)
        deps.screenerService = svc
        console.log('[Dashboard] Created new ScreenerService from LLM config')
      }
    }

    // Return full updated page
    const screener = deps.screenerService
    const state = screener?.getState() ?? { status: 'idle' as const, progress: 0, progressLabel: '', results: [] as ScreenerResult[], lastError: null }
    const cfg = screener?.getConfig() ?? { enabled: false, scheduleCron: 'disabled' as const, lastRunAt: null, closedPositionsLimit: 200 }
    const llmCfg = { provider: deps.config.llm.provider || 'claude', apiKey: deps.config.llm.apiKey || '', model: deps.config.llm.model || '', baseUrl: deps.config.llm.baseUrl, ollamaHost: deps.config.llm.ollamaHost }
    return c.html(screenerPageHtml(state, cfg, llmCfg, !!screener))
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

  app.get('/screener/detail/:address', (c) => {
    const address = c.req.param('address')
    const screener = deps.screenerService
    const state = screener?.getState()
    const result = state?.results.find(r => r.address === address)
    if (!result?.detail) return c.html('<span style="color:#555;font-size:0.8rem">暂无过程数据（请重新运行筛选）</span>')
    return c.html(screenerDetailHtml(result))
  })

  app.get('/screener/detail/:address/close', (c) => {
    const address = c.req.param('address')
    return c.html(`<button hx-get="/screener/detail/${address}" hx-target="#screener-detail-${address}" hx-swap="innerHTML"
      style="background:none;border:1px solid #333;color:#888;padding:0.3rem 0.75rem;border-radius:4px;cursor:pointer;font-size:0.8rem">📊 查看过程数据</button>`)
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
    const closedPositionsLimit = Math.max(10, Math.min(5000, Number(body.closedPositionsLimit ?? 200)))
    deps.screenerService?.updateConfig({
      enabled: validSchedule === 'daily',
      scheduleCron: validSchedule,
      closedPositionsLimit,
    })
    return c.html(`<span class="badge badge-ok">${validSchedule === 'daily' ? '已开启每日筛选' : '已关闭定时筛选'} · 历史结算${closedPositionsLimit}笔</span>`)
  })

  // ── Review Routes ──────────────────────────────────────────

  app.get('/review', (c) => {
    const svc = deps.reviewService
    const progress = svc?.getProgress() ?? { status: 'idle' as const }
    const reviewCfg = deps.config.copyTrading.review ?? { enabled: false, autoReviewTime: '06:00', timezone: 'Asia/Shanghai' }
    const reports = svc?.getRepo().findAll(5) ?? []
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const day7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const day30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

    let latestReportHtml = '<div style="color:#888;text-align:center;padding:2rem">暂无复盘报告，点击"开始复盘"生成</div>'
    if (reports.length > 0) {
      const r = reports[0]
      latestReportHtml = reviewReportCardHtml(r)
    }

    const historyRows = reports.map(r => `
      <tr>
        <td>${escHtml(r.period_start)} ~ ${escHtml(r.period_end)}</td>
        <td><span class="badge ${r.status === 'completed' ? 'badge-ok' : r.status === 'failed' ? 'badge-err' : 'badge-warn'}">${escHtml(r.status)}</span></td>
        <td>${escHtml(r.trigger_type)}</td>
        <td>${escHtml(r.created_at)}</td>
        <td><button hx-get="/review/report/${r.id}" hx-target="#review-report" hx-swap="innerHTML"
          style="background:#7c83fd;color:#fff;border:none;padding:0.3rem 0.75rem;border-radius:4px;cursor:pointer">查看</button></td>
      </tr>
    `).join('')

    return c.html(layout('智能复盘', `
      <h2 style="margin-bottom:1rem">智能复盘</h2>

      <div class="card">
        <h3 style="margin-bottom:1rem;color:#7c83fd">手动复盘</h3>
        <form hx-post="/review/run" hx-target="#review-progress" hx-swap="innerHTML" style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:flex-end">
          <div>
            <label style="font-size:0.85rem;color:#888">开始日期</label><br>
            <input type="date" name="periodStart" value="${day7}" style="background:#2a2a3e;color:#e0e0e0;border:1px solid #333;padding:0.4rem;border-radius:4px">
          </div>
          <div>
            <label style="font-size:0.85rem;color:#888">结束日期</label><br>
            <input type="date" name="periodEnd" value="${today}" style="background:#2a2a3e;color:#e0e0e0;border:1px solid #333;padding:0.4rem;border-radius:4px">
          </div>
          <div style="display:flex;gap:0.5rem">
            <button type="button" onclick="this.form.periodStart.value='${today}';this.form.periodEnd.value='${today}'"
              style="background:#2a2a3e;color:#e0e0e0;border:1px solid #333;padding:0.4rem 0.75rem;border-radius:4px;cursor:pointer">今天</button>
            <button type="button" onclick="this.form.periodStart.value='${yesterday}';this.form.periodEnd.value='${yesterday}'"
              style="background:#2a2a3e;color:#e0e0e0;border:1px solid #333;padding:0.4rem 0.75rem;border-radius:4px;cursor:pointer">昨天</button>
            <button type="button" onclick="this.form.periodStart.value='${day7}';this.form.periodEnd.value='${today}'"
              style="background:#2a2a3e;color:#e0e0e0;border:1px solid #333;padding:0.4rem 0.75rem;border-radius:4px;cursor:pointer">7天</button>
            <button type="button" onclick="this.form.periodStart.value='${day30}';this.form.periodEnd.value='${today}'"
              style="background:#2a2a3e;color:#e0e0e0;border:1px solid #333;padding:0.4rem 0.75rem;border-radius:4px;cursor:pointer">30天</button>
          </div>
          <button type="submit" style="background:#7c83fd;color:#fff;border:none;padding:0.5rem 1.5rem;border-radius:4px;cursor:pointer;font-weight:bold">开始复盘</button>
        </form>
      </div>

      <div class="card">
        <h3 style="margin-bottom:1rem;color:#7c83fd">自动复盘配置</h3>
        <form hx-post="/review/config" hx-target="#review-config-result" hx-swap="innerHTML" style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:flex-end">
          <div>
            <label style="font-size:0.85rem;color:#888">启用</label><br>
            <select name="enabled" style="background:#2a2a3e;color:#e0e0e0;border:1px solid #333;padding:0.4rem;border-radius:4px">
              <option value="true" ${reviewCfg.enabled ? 'selected' : ''}>开启</option>
              <option value="false" ${!reviewCfg.enabled ? 'selected' : ''}>关闭</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.85rem;color:#888">每日复盘时间</label><br>
            <input type="time" name="autoReviewTime" value="${escHtml(reviewCfg.autoReviewTime)}" style="background:#2a2a3e;color:#e0e0e0;border:1px solid #333;padding:0.4rem;border-radius:4px">
          </div>
          <button type="submit" style="background:#7c83fd;color:#fff;border:none;padding:0.5rem 1.5rem;border-radius:4px;cursor:pointer">保存配置</button>
          <span id="review-config-result"></span>
        </form>
      </div>

      <div id="review-progress">${progress.status !== 'idle' && progress.status !== 'completed' && progress.status !== 'failed' ? reviewProgressHtml(progress) : ''}</div>

      <div class="card" id="review-report">
        <h3 style="margin-bottom:1rem;color:#7c83fd">复盘报告</h3>
        ${latestReportHtml}
      </div>

      <div class="card">
        <h3 style="margin-bottom:1rem;color:#7c83fd">历史记录</h3>
        <div id="review-history" hx-get="/review/history" hx-trigger="load" hx-swap="innerHTML">
          <table>
            <thead><tr><th>周期</th><th>状态</th><th>触发方式</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>${historyRows}</tbody>
          </table>
        </div>
      </div>
    `))
  })

  app.post('/review/run', async (c) => {
    const svc = deps.reviewService
    if (!svc) return c.html('<span class="badge badge-err">复盘服务未配置</span>')
    const body = await c.req.parseBody()
    const periodStart = String(body.periodStart ?? '')
    const periodEnd = String(body.periodEnd ?? '')
    if (!periodStart || !periodEnd) return c.html('<span class="badge badge-err">请选择日期范围</span>')
    svc.runManual(periodStart, periodEnd).catch(err => console.error('[Review] Manual run failed:', err))
    return c.html(reviewProgressHtml(svc.getProgress()))
  })

  app.get('/review/progress', (c) => {
    const svc = deps.reviewService
    const progress = svc?.getProgress() ?? { status: 'idle' as const }
    if (progress.status === 'completed') {
      const reportId = progress.currentReportId
      if (reportId) {
        const row = svc?.getRepo().findById(reportId)
        if (row) {
          return c.html(`<div class="card">${reviewReportCardHtml(row)}</div>`)
        }
      }
      return c.html('<span class="badge badge-ok">复盘完成</span>')
    }
    if (progress.status === 'failed') {
      return c.html(`<div class="card"><span class="badge badge-err">复盘失败: ${escHtml(progress.error ?? '未知错误')}</span></div>`)
    }
    if (progress.status === 'idle') {
      return c.html('')
    }
    return c.html(reviewProgressHtml(progress))
  })

  app.get('/review/report/:id', (c) => {
    const svc = deps.reviewService
    if (!svc) return c.html('<span class="badge badge-err">复盘服务未配置</span>')
    const id = Number(c.req.param('id'))
    const row = svc.getRepo().findById(id)
    if (!row) return c.html('<span class="badge badge-err">报告不存在</span>')
    return c.html(reviewReportCardHtml(row))
  })

  app.get('/review/history', (c) => {
    const svc = deps.reviewService
    const reports = svc?.getRepo().findAll(20) ?? []
    if (reports.length === 0) return c.html('<div style="color:#888;text-align:center;padding:1rem">暂无历史记录</div>')
    const rows = reports.map(r => `
      <tr>
        <td>${escHtml(r.period_start)} ~ ${escHtml(r.period_end)}</td>
        <td><span class="badge ${r.status === 'completed' ? 'badge-ok' : r.status === 'failed' ? 'badge-err' : 'badge-warn'}">${escHtml(r.status)}</span></td>
        <td>${escHtml(r.trigger_type)}</td>
        <td>${escHtml(r.created_at)}</td>
        <td><button hx-get="/review/report/${r.id}" hx-target="#review-report" hx-swap="innerHTML"
          style="background:#7c83fd;color:#fff;border:none;padding:0.3rem 0.75rem;border-radius:4px;cursor:pointer">查看</button></td>
      </tr>
    `).join('')
    return c.html(`<table><thead><tr><th>周期</th><th>状态</th><th>触发方式</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`)
  })

  app.post('/review/config', async (c) => {
    const body = await c.req.parseBody()
    const enabled = String(body.enabled) === 'true'
    const autoReviewTime = String(body.autoReviewTime ?? '06:00')
    deps.config.copyTrading.review = {
      enabled,
      autoReviewTime,
      timezone: deps.config.copyTrading.review?.timezone ?? 'Asia/Shanghai',
    }
    applyConfig()
    if (deps.reviewService) {
      deps.reviewService.stop()
      if (enabled) deps.reviewService.start()
    }
    return c.html(`<span class="badge badge-ok">${enabled ? '已开启自动复盘 (' + escHtml(autoReviewTime) + ')' : '已关闭自动复盘'}</span>`)
  })

  app.post('/review/apply-suggestion', async (c) => {
    const body = await c.req.parseBody()
    let suggestion: { type: string; target?: string; suggestedValue?: string | number }
    try {
      suggestion = JSON.parse(String(body.suggestion ?? '{}'))
    } catch {
      return c.html('<span class="badge badge-err">无效的建议数据</span>')
    }
    const type = suggestion.type
    const target = suggestion.target
    const value = suggestion.suggestedValue

    if (type === 'adjust_ratio' && target && value !== undefined) {
      const wallet = deps.config.copyTrading.wallets.find(w => w.address.toLowerCase() === target.toLowerCase())
      if (!wallet) return c.html('<span class="badge badge-err">未找到目标钱包</span>')
      wallet.proportionPct = Number(value)
      applyConfig()
      return c.html(`<span class="badge badge-ok">已调整 ${escHtml(wallet.label)} 比例为 ${value}</span>`)
    }
    if (type === 'pause_wallet' || type === 'resume_wallet') {
      return c.html('<span class="badge badge-warn">暂停/恢复钱包功能暂未支持，请手动操作</span>')
    }
    if (type === 'adjust_risk_limit' && target && value !== undefined) {
      const key = target as keyof typeof deps.config.risk
      if (key in deps.config.risk) {
        ;(deps.config.risk as unknown as Record<string, number>)[key] = Number(value)
        return c.html(`<span class="badge badge-ok">已调整 ${escHtml(target)} 为 ${value}</span>`)
      }
      if (target === 'maxDailyTradesPerWallet') {
        deps.config.copyTrading.maxDailyTradesPerWallet = Number(value)
        applyConfig()
        return c.html(`<span class="badge badge-ok">已调整每日最大交易数为 ${value}</span>`)
      }
      if (target === 'maxWalletExposureUsdc') {
        deps.config.copyTrading.maxWalletExposureUsdc = Number(value)
        applyConfig()
        return c.html(`<span class="badge badge-ok">已调整钱包最大敞口为 ${value}</span>`)
      }
      if (target === 'maxTotalExposureUsdc') {
        deps.config.copyTrading.maxTotalExposureUsdc = Number(value)
        applyConfig()
        return c.html(`<span class="badge badge-ok">已调整总最大敞口为 ${value}</span>`)
      }
      return c.html('<span class="badge badge-err">未知的风控参数</span>')
    }
    if (type === 'adjust_poll_interval' && value !== undefined) {
      deps.config.copyTrading.pollIntervalSeconds = Number(value)
      applyConfig()
      return c.html(`<span class="badge badge-ok">已调整轮询间隔为 ${value}s</span>`)
    }
    if (type === 'system_improvement') {
      return c.html('<span class="badge badge-warn">系统改进建议仅供参考</span>')
    }
    return c.html('<span class="badge badge-warn">未知建议类型</span>')
  })

  function reviewProgressHtml(progress: import('../../strategies/review/types.ts').ReviewProgress): string {
    const statusMap: Record<string, string> = {
      idle: '空闲',
      collecting: '收集数据中...',
      analyzing_pnl: '分析盈亏中...',
      analyzing_strategy: '分析策略中...',
      coordinating: '生成综合报告中...',
      completed: '已完成',
      failed: '失败',
    }
    const label = statusMap[progress.status] ?? progress.status
    return `<div class="card" hx-get="/review/progress" hx-trigger="every 2s" hx-swap="outerHTML">
      <div style="display:flex;align-items:center;gap:1rem">
        <div style="width:20px;height:20px;border:3px solid #7c83fd;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite"></div>
        <span style="color:#7c83fd;font-weight:bold">${escHtml(label)}</span>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>`
  }

  function buildDataDetailHtml(data: import('../../strategies/review/types.ts').ReviewDataSummary): string {
    const fmtUsd = (v: number) => v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'K' : '$' + v.toFixed(2)
    const o = data.overview
    const totalWallets = data.copyTrades.length
    const totalWinCount = data.copyTrades.reduce((s, w) => s + w.winCount, 0)
    const totalLossCount = data.copyTrades.reduce((s, w) => s + w.lossCount, 0)
    const totalWinPnl = data.copyTrades.reduce((s, w) => s + w.trades.filter(t => (t.pnl ?? 0) > 0).reduce((a, t) => a + (t.pnl ?? 0), 0), 0)
    const totalLossPnl = data.copyTrades.reduce((s, w) => s + w.trades.filter(t => (t.pnl ?? 0) < 0).reduce((a, t) => a + (t.pnl ?? 0), 0), 0)
    const totalCopiedSize = data.copyTrades.reduce((s, w) => s + w.totalCopiedSize, 0)
    const totalOrders = data.orders.reduce((s, o) => s + o.totalOrders, 0)
    const totalExecuted = data.orders.reduce((s, o) => s + o.executedCount, 0)
    const totalRejected = data.orders.reduce((s, o) => s + o.rejectedCount, 0)

    // Overview grid
    const overviewHtml = `
      <div style="margin-bottom:1rem">
        <div style="font-size:0.85rem;color:#7c83fd;font-weight:bold;margin-bottom:0.5rem">总览</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.5rem">
          <div style="background:#0d0d1a;padding:0.5rem;border-radius:4px;text-align:center">
            <div style="font-size:1.1rem;font-weight:bold">${o.totalTrades}</div>
            <div style="font-size:0.75rem;color:#888">总交易数</div>
          </div>
          <div style="background:#0d0d1a;padding:0.5rem;border-radius:4px;text-align:center">
            <div style="font-size:1.1rem;font-weight:bold">${totalWallets}</div>
            <div style="font-size:0.75rem;color:#888">钱包数量</div>
          </div>
          <div style="background:#0d0d1a;padding:0.5rem;border-radius:4px;text-align:center">
            <div style="font-size:1.1rem;font-weight:bold;color:${o.totalPnl >= 0 ? '#2ecc71' : '#e74c3c'}">${fmtUsd(o.totalPnl)}</div>
            <div style="font-size:0.75rem;color:#888">总盈亏</div>
          </div>
          <div style="background:#0d0d1a;padding:0.5rem;border-radius:4px;text-align:center">
            <div style="font-size:1.1rem;font-weight:bold">${fmtUsd(totalCopiedSize)}</div>
            <div style="font-size:0.75rem;color:#888">总跟单金额</div>
          </div>
          <div style="background:#0d0d1a;padding:0.5rem;border-radius:4px;text-align:center">
            <div style="font-size:1.1rem;font-weight:bold">${(o.winRate * 100).toFixed(1)}%</div>
            <div style="font-size:0.75rem;color:#888">胜率</div>
          </div>
          <div style="background:#0d0d1a;padding:0.5rem;border-radius:4px;text-align:center">
            <div style="font-size:1.1rem;font-weight:bold;color:#2ecc71">${totalWinCount}笔 ${fmtUsd(totalWinPnl)}</div>
            <div style="font-size:0.75rem;color:#888">盈利</div>
          </div>
          <div style="background:#0d0d1a;padding:0.5rem;border-radius:4px;text-align:center">
            <div style="font-size:1.1rem;font-weight:bold;color:#e74c3c">${totalLossCount}笔 ${fmtUsd(totalLossPnl)}</div>
            <div style="font-size:0.75rem;color:#888">亏损</div>
          </div>
        </div>
      </div>`

    // Per-wallet breakdown
    const walletRows = data.copyTrades.map(w => {
      const tradeRows = w.trades.map(t => `<tr style="border-top:1px solid #1e1e2e">
        <td style="padding:2px 6px;font-size:0.75rem;color:#888">${new Date(t.timestamp * 1000).toLocaleDateString()}</td>
        <td style="padding:2px 6px;font-size:0.75rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.title || t.marketId.slice(0, 16))}</td>
        <td style="padding:2px 6px;font-size:0.75rem;color:#c0a0ff">${escHtml(t.outcome || '-')}</td>
        <td style="padding:2px 6px;font-size:0.75rem;color:${t.side === 'buy' ? '#3498db' : '#e67e22'}">${t.side}</td>
        <td style="padding:2px 6px;font-size:0.75rem;text-align:right">${fmtUsd(t.copiedSize)}</td>
        <td style="padding:2px 6px;font-size:0.75rem;text-align:right">$${t.price.toFixed(3)}</td>
        <td style="padding:2px 6px;font-size:0.75rem;text-align:right">${t.currentPrice != null ? '$' + t.currentPrice.toFixed(3) : '-'}</td>
        <td style="padding:2px 6px;font-size:0.75rem;text-align:right;color:${(t.pnl ?? 0) >= 0 ? '#2ecc71' : '#e74c3c'}">${t.pnl != null ? (t.pnl >= 0 ? '+' : '') + fmtUsd(t.pnl) : '-'}</td>
        <td style="padding:2px 6px;font-size:0.75rem">${t.settled ? '已结算' : '持仓中'}</td>
      </tr>`).join('')

      return `<div style="margin-bottom:0.75rem;border:1px solid #2a2a3e;border-radius:6px;padding:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <span style="font-weight:bold;color:#7c83fd">${escHtml(w.label)}</span>
          <span style="font-size:0.8rem;color:#888;font-family:monospace">${escHtml(w.walletAddress.slice(0, 8))}…${escHtml(w.walletAddress.slice(-4))}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:0.4rem;margin-bottom:0.5rem;font-size:0.82rem">
          <div><span style="color:#888">交易:</span> ${w.totalTrades}笔</div>
          <div><span style="color:#888">金额:</span> ${fmtUsd(w.totalCopiedSize)}</div>
          <div><span style="color:#888">盈亏:</span> <span style="color:${w.totalPnl >= 0 ? '#2ecc71' : '#e74c3c'}">${fmtUsd(w.totalPnl)}</span></div>
          <div><span style="color:#888">胜率:</span> ${(w.winRate * 100).toFixed(1)}%</div>
          <div><span style="color:#2ecc71">赢${w.winCount}笔</span></div>
          <div><span style="color:#e74c3c">亏${w.lossCount}笔</span></div>
        </div>
        ${w.trades.length > 0 ? `<details>
          <summary style="cursor:pointer;font-size:0.78rem;color:#666;user-select:none">查看 ${w.trades.length} 笔交易明细 ▸</summary>
          <div style="max-height:240px;overflow-y:auto;margin-top:0.4rem">
            <table style="width:100%;border-collapse:collapse">
              <thead><tr style="background:#0d0d1a;color:#666;font-size:0.72rem">
                <th style="padding:2px 6px;text-align:left;font-weight:normal">日期</th>
                <th style="padding:2px 6px;text-align:left;font-weight:normal">市场</th>
                <th style="padding:2px 6px;text-align:left;font-weight:normal">结果</th>
                <th style="padding:2px 6px;font-weight:normal">方向</th>
                <th style="padding:2px 6px;text-align:right;font-weight:normal">金额</th>
                <th style="padding:2px 6px;text-align:right;font-weight:normal">入场价</th>
                <th style="padding:2px 6px;text-align:right;font-weight:normal">当前价</th>
                <th style="padding:2px 6px;text-align:right;font-weight:normal">盈亏</th>
                <th style="padding:2px 6px;font-weight:normal">状态</th>
              </tr></thead>
              <tbody>${tradeRows}</tbody>
            </table>
          </div>
        </details>` : ''}
      </div>`
    }).join('')

    const walletsHtml = totalWallets > 0 ? `
      <div style="margin-bottom:1rem">
        <div style="font-size:0.85rem;color:#7c83fd;font-weight:bold;margin-bottom:0.5rem">钱包明细 (${totalWallets} 个)</div>
        ${walletRows}
      </div>` : ''

    // Orders breakdown
    const ordersHtml = data.orders.length > 0 ? `
      <div style="margin-bottom:1rem">
        <div style="font-size:0.85rem;color:#7c83fd;font-weight:bold;margin-bottom:0.5rem">订单统计 (共 ${totalOrders} 笔: 成交 ${totalExecuted} / 拒绝 ${totalRejected})</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
          <thead><tr style="background:#0d0d1a;color:#666;font-size:0.75rem">
            <th style="padding:4px 8px;text-align:left;font-weight:normal">策略</th>
            <th style="padding:4px 8px;text-align:right;font-weight:normal">总数</th>
            <th style="padding:4px 8px;text-align:right;font-weight:normal">成交</th>
            <th style="padding:4px 8px;text-align:right;font-weight:normal">拒绝</th>
          </tr></thead>
          <tbody>${data.orders.map(o => `<tr style="border-top:1px solid #1e1e2e">
            <td style="padding:4px 8px">${escHtml(o.strategyId)}</td>
            <td style="padding:4px 8px;text-align:right">${o.totalOrders}</td>
            <td style="padding:4px 8px;text-align:right;color:#2ecc71">${o.executedCount}</td>
            <td style="padding:4px 8px;text-align:right;color:#e74c3c">${o.rejectedCount}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : ''

    // Signals breakdown
    const sig = data.signals
    const providerRows = Object.entries(sig.byProvider).map(([name, info]) =>
      `<tr style="border-top:1px solid #1e1e2e">
        <td style="padding:4px 8px">${escHtml(name)}</td>
        <td style="padding:4px 8px;text-align:right">${info.count}</td>
        <td style="padding:4px 8px;text-align:right">${(info.avgConfidence * 100).toFixed(1)}%</td>
      </tr>`
    ).join('')
    const signalsHtml = sig.totalSignals > 0 ? `
      <div style="margin-bottom:1rem">
        <div style="font-size:0.85rem;color:#7c83fd;font-weight:bold;margin-bottom:0.5rem">信号统计 (共 ${sig.totalSignals} 条)</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
          <thead><tr style="background:#0d0d1a;color:#666;font-size:0.75rem">
            <th style="padding:4px 8px;text-align:left;font-weight:normal">来源</th>
            <th style="padding:4px 8px;text-align:right;font-weight:normal">数量</th>
            <th style="padding:4px 8px;text-align:right;font-weight:normal">平均置信度</th>
          </tr></thead>
          <tbody>${providerRows}</tbody>
        </table>
      </div>` : ''

    // Account snapshots
    const snapshotsHtml = data.accountSnapshots.length > 0 ? `
      <div>
        <div style="font-size:0.85rem;color:#7c83fd;font-weight:bold;margin-bottom:0.5rem">账户快照 (${data.accountSnapshots.length} 条)</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
          <thead><tr style="background:#0d0d1a;color:#666;font-size:0.75rem">
            <th style="padding:4px 8px;text-align:left;font-weight:normal">日期</th>
            <th style="padding:4px 8px;text-align:right;font-weight:normal">余额</th>
            <th style="padding:4px 8px;text-align:right;font-weight:normal">总盈亏</th>
          </tr></thead>
          <tbody>${data.accountSnapshots.map(s => `<tr style="border-top:1px solid #1e1e2e">
            <td style="padding:4px 8px">${escHtml(s.snapshotDate)}</td>
            <td style="padding:4px 8px;text-align:right">${fmtUsd(s.balance)}</td>
            <td style="padding:4px 8px;text-align:right;color:${s.totalPnl >= 0 ? '#2ecc71' : '#e74c3c'}">${fmtUsd(s.totalPnl)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : ''

    return `
      <div style="margin-top:1rem">
        <details>
          <summary style="cursor:pointer;color:#7c83fd;font-weight:bold;padding:0.5rem 0;user-select:none;font-size:0.95rem">
            📋 复盘原始数据明细 (${data.periodStart} ~ ${data.periodEnd}) ▸
          </summary>
          <div style="margin-top:0.75rem;padding:1rem;background:#12121e;border-radius:6px">
            ${overviewHtml}
            ${walletsHtml}
            ${ordersHtml}
            ${signalsHtml}
            ${snapshotsHtml}
          </div>
        </details>
      </div>`
  }

  function reviewReportCardHtml(row: import('../../strategies/review/types.ts').ReviewReportRow): string {
    let report: import('../../strategies/review/types.ts').ReviewReport | null = null
    let pnlAnalysis: import('../../strategies/review/types.ts').PnLReport | null = null
    let strategyAnalysis: import('../../strategies/review/types.ts').StrategyReport | null = null
    let dataSummary: import('../../strategies/review/types.ts').ReviewDataSummary | null = null
    let suggestions: import('../../strategies/review/types.ts').Suggestion[] = []
    try { if (row.report) report = JSON.parse(row.report) } catch {}
    try { if (row.pnl_analysis) pnlAnalysis = JSON.parse(row.pnl_analysis) } catch {}
    try { if (row.strategy_analysis) strategyAnalysis = JSON.parse(row.strategy_analysis) } catch {}
    try { if (row.data_summary) dataSummary = JSON.parse(row.data_summary) } catch {}
    try { if (row.suggestions) suggestions = JSON.parse(row.suggestions) } catch {}

    if (!report) {
      if (row.status === 'failed') return `<span class="badge badge-err">复盘失败: ${escHtml(row.error ?? '未知错误')}</span>`
      return `<span class="badge badge-warn">${escHtml(row.status)}</span>`
    }

    const scoreColor = report.overallScore >= 70 ? '#2ecc71' : report.overallScore >= 40 ? '#f39c12' : '#e74c3c'
    const findingsHtml = (report.keyFindings ?? []).map(f => `<li style="margin-bottom:0.3rem">${escHtml(f)}</li>`).join('')

    const suggestionsHtml = suggestions.length > 0 ? suggestions.map((s, i) => {
      const confBadge = s.confidence === 'high' ? 'badge-ok' : s.confidence === 'medium' ? 'badge-warn' : 'badge-err'
      return `<div style="border:1px solid #2a2a3e;border-radius:6px;padding:0.75rem;margin-bottom:0.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <strong>${escHtml(s.description)}</strong>
          <span class="badge ${confBadge}">${escHtml(s.confidence)}</span>
        </div>
        <div style="font-size:0.85rem;color:#888;margin-bottom:0.5rem">${escHtml(s.reasoning)}</div>
        ${s.currentValue !== undefined ? `<div style="font-size:0.85rem">当前: ${escHtml(String(s.currentValue))} → 建议: ${escHtml(String(s.suggestedValue ?? ''))}</div>` : ''}
        <form hx-post="/review/apply-suggestion" hx-target="#suggestion-result-${i}" hx-swap="innerHTML" style="margin-top:0.5rem">
          <input type="hidden" name="suggestion" value="${escHtml(JSON.stringify(s))}">
          <button type="submit" style="background:#7c83fd;color:#fff;border:none;padding:0.3rem 0.75rem;border-radius:4px;cursor:pointer;font-size:0.85rem">应用建议</button>
          <span id="suggestion-result-${i}"></span>
        </form>
      </div>`
    }).join('') : '<div style="color:#888">暂无建议</div>'

    const dataDetailHtml = dataSummary ? buildDataDetailHtml(dataSummary) : ''

    return reviewReportInnerHtml(row, report, pnlAnalysis, strategyAnalysis, scoreColor, findingsHtml, suggestionsHtml, dataDetailHtml)
  }

  function reviewReportInnerHtml(
    row: import('../../strategies/review/types.ts').ReviewReportRow,
    report: import('../../strategies/review/types.ts').ReviewReport,
    pnlAnalysis: import('../../strategies/review/types.ts').PnLReport | null,
    strategyAnalysis: import('../../strategies/review/types.ts').StrategyReport | null,
    scoreColor: string,
    findingsHtml: string,
    suggestionsHtml: string,
    dataDetailHtml: string = '',
  ): string {
    const pnlHtml = pnlAnalysis ? `
      <div style="margin-top:1rem">
        <div class="grid" style="margin-bottom:1rem">
          <div><span style="color:#888;font-size:0.85rem">盈亏评分</span><br><strong style="color:${pnlAnalysis.overallScore >= 70 ? '#2ecc71' : pnlAnalysis.overallScore >= 40 ? '#f39c12' : '#e74c3c'}">${pnlAnalysis.overallScore}/100</strong></div>
          <div><span style="color:#888;font-size:0.85rem">总盈亏</span><br><strong class="${pnlAnalysis.totalPnl >= 0 ? 'positive' : 'negative'}">$${pnlAnalysis.totalPnl.toFixed(2)}</strong></div>
          <div><span style="color:#888;font-size:0.85rem">胜率</span><br><strong>${(pnlAnalysis.winRate * 100).toFixed(1)}%</strong></div>
          <div><span style="color:#888;font-size:0.85rem">最大回撤</span><br><strong class="negative">${(pnlAnalysis.maxDrawdown * 100).toFixed(1)}%</strong></div>
        </div>
        <div style="font-size:0.9rem;color:#ccc;white-space:pre-wrap">${escHtml(pnlAnalysis.summary)}</div>
      </div>` : ''

    const stratHtml = strategyAnalysis ? `
      <div style="margin-top:1rem">
        <div class="grid" style="margin-bottom:1rem">
          <div><span style="color:#888;font-size:0.85rem">策略评分</span><br><strong style="color:${strategyAnalysis.overallScore >= 70 ? '#2ecc71' : strategyAnalysis.overallScore >= 40 ? '#f39c12' : '#e74c3c'}">${strategyAnalysis.overallScore}/100</strong></div>
        </div>
        ${strategyAnalysis.walletScores.length > 0 ? `<table>
          <thead><tr><th>钱包</th><th>评分</th><th>盈亏</th><th>胜率</th><th>评价</th></tr></thead>
          <tbody>${strategyAnalysis.walletScores.map(w => `<tr>
            <td>${escHtml(w.label)}</td>
            <td><strong>${w.score}/100</strong></td>
            <td class="${w.pnl >= 0 ? 'positive' : 'negative'}">$${w.pnl.toFixed(2)}</td>
            <td>${(w.winRate * 100).toFixed(1)}%</td>
            <td style="font-size:0.85rem">${escHtml(w.assessment)}</td>
          </tr>`).join('')}</tbody>
        </table>` : ''}
        <div style="font-size:0.9rem;color:#ccc;white-space:pre-wrap;margin-top:0.75rem">${escHtml(strategyAnalysis.summary)}</div>
      </div>` : ''

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <div>
          <span style="color:#888;font-size:0.85rem">${escHtml(row.period_start)} ~ ${escHtml(row.period_end)}</span>
          <span class="badge ${row.trigger_type === 'manual' ? 'badge-warn' : 'badge-ok'}" style="margin-left:0.5rem">${escHtml(row.trigger_type)}</span>
        </div>
        <div style="font-size:2rem;font-weight:bold;color:${scoreColor}">${report.overallScore}<span style="font-size:1rem;color:#888">/100</span></div>
      </div>
      ${findingsHtml ? `<div style="margin-bottom:1rem"><h4 style="color:#7c83fd;margin-bottom:0.5rem">关键发现</h4><ul style="padding-left:1.2rem;color:#ccc">${findingsHtml}</ul></div>` : ''}
      <div style="margin-bottom:1rem"><h4 style="color:#7c83fd;margin-bottom:0.5rem">综合评估</h4><div style="font-size:0.9rem;color:#ccc;white-space:pre-wrap">${escHtml(report.comprehensiveAssessment)}</div></div>
      <div style="margin-bottom:1rem"><h4 style="color:#7c83fd;margin-bottom:0.5rem">盈亏分析</h4>${pnlHtml || '<div style="color:#888">暂无数据</div>'}</div>
      <div style="margin-bottom:1rem"><h4 style="color:#7c83fd;margin-bottom:0.5rem">策略分析</h4>${stratHtml || '<div style="color:#888">暂无数据</div>'}</div>
      <div style="margin-bottom:1rem"><h4 style="color:#7c83fd;margin-bottom:0.5rem">优化建议</h4>${suggestionsHtml}</div>
      ${dataDetailHtml}
    `
  }

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

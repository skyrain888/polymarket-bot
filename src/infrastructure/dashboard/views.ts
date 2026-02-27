// HTML fragments rendered server-side
export function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>transBoot - ${title}</title>
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; }
    nav { background: #1a1a2e; padding: 1rem 2rem; display: flex; gap: 2rem; align-items: center; }
    nav a { color: #7c83fd; text-decoration: none; }
    nav a:hover { color: #fff; }
    .container { padding: 2rem; max-width: 1200px; margin: 0 auto; }
    .card { background: #1a1a2e; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
    .stat { font-size: 2rem; font-weight: bold; color: #7c83fd; }
    .label { font-size: 0.85rem; color: #888; margin-top: 0.25rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #2a2a3e; }
    th { color: #888; font-weight: normal; }
    .positive { color: #2ecc71; }
    .negative { color: #e74c3c; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; }
    .badge-ok { background: #1e4d2b; color: #2ecc71; }
    .badge-warn { background: #4d3a1e; color: #f39c12; }
    .badge-err { background: #4d1e1e; color: #e74c3c; }
  </style>
</head>
<body>
  <nav>
    <strong style="color:#7c83fd">transBoot</strong>
    <a href="/">Overview</a>
    <a href="/strategies">Strategies</a>
    <a href="/positions">Positions</a>
    <a href="/orders">Orders</a>
    <a href="/signals">Signals</a>
    <a href="/config">Config</a>
    <a href="/copy-trading">Copy Trading</a>
  </nav>
  <div class="container" hx-get="/api/refresh" hx-trigger="every 5s" hx-swap="none">
    ${body}
  </div>
</body>
</html>`
}

export function overviewView(data: {
  balance: number
  todayPnl: number
  activeStrategies: number
  openPositions: number
}): string {
  const pnlClass = data.todayPnl >= 0 ? 'positive' : 'negative'
  return layout('Overview', `
    <h2 style="margin-bottom:1rem">Overview</h2>
    <div class="grid">
      <div class="card"><div class="stat">$${data.balance.toFixed(2)}</div><div class="label">Balance (USDC)</div></div>
      <div class="card"><div class="stat ${pnlClass}">${data.todayPnl >= 0 ? '+' : ''}$${data.todayPnl.toFixed(2)}</div><div class="label">Today PnL</div></div>
      <div class="card"><div class="stat">${data.activeStrategies}</div><div class="label">Active Strategies</div></div>
      <div class="card"><div class="stat">${data.openPositions}</div><div class="label">Open Positions</div></div>
    </div>
  `)
}

import type { BacktestReport } from './engine.ts'

export function printReport(report: BacktestReport): void {
  console.log('\n=== Backtest Report ===')
  console.log(`Total Trades:  ${report.totalTrades}`)
  console.log(`Win Rate:      ${(report.winRate * 100).toFixed(1)}%`)
  console.log(`Final Balance: $${report.finalBalance.toFixed(2)}`)
  console.log(`Total Return:  ${(report.totalReturn * 100).toFixed(2)}%`)
  console.log(`Max Drawdown:  ${(report.maxDrawdown * 100).toFixed(2)}%`)
  console.log(`Sharpe Ratio:  ${report.sharpeRatio.toFixed(2)}`)
  console.log('======================\n')
}

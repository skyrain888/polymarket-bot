import { loadConfig } from './config/index.ts'
import { createDb } from './infrastructure/storage/db.ts'
import { OrderRepository, PositionRepository, SignalRepository } from './infrastructure/storage/repositories.ts'
import { PolymarketClient } from './infrastructure/polymarket/client.ts'
import { EventBus } from './core/event-bus.ts'
import { PositionTracker } from './core/position-tracker.ts'
import { RiskManager } from './core/risk-manager.ts'
import { OrderManager } from './core/order-manager.ts'
import { QuantEngine } from './signals/quant/engine.ts'
import { SignalAggregator } from './signals/aggregator.ts'
import { createLLMProvider } from './signals/llm/factory.ts'
import { StrategyEngine } from './strategies/engine.ts'
import { MarketMakerStrategy } from './strategies/market-maker/index.ts'
import { ArbitrageStrategy } from './strategies/arbitrage/index.ts'
import { MomentumStrategy } from './strategies/momentum/index.ts'
import { FundamentalStrategy } from './strategies/fundamental/index.ts'
import { Notifier } from './infrastructure/notifier/index.ts'
import { createDashboard } from './infrastructure/dashboard/server.ts'

export async function startBot() {
  const config = loadConfig()
  console.log(`[transBoot] Starting in ${config.mode.toUpperCase()} mode...`)

  // Infrastructure
  const db = createDb(config.dbPath)
  const orderRepo = new OrderRepository(db)
  const positionRepo = new PositionRepository(db)
  const signalRepo = new SignalRepository(db)
  const bus = new EventBus()
  const polyClient = new PolymarketClient({ mode: config.mode, ...config.polymarket })
  const notifier = new Notifier(config.notify)

  // Core
  const balance = await polyClient.getBalance()
  const positionTracker = new PositionTracker(positionRepo)
  const riskManager = new RiskManager(config.risk, balance)
  const orderManager = new OrderManager(polyClient, orderRepo, bus)

  // Signals
  const quantEngine = new QuantEngine()
  const aggregator = new SignalAggregator()
  const llmProvider = config.llm.apiKey ? createLLMProvider(config.llm) : null

  // Strategies
  const strategies = [
    new MarketMakerStrategy({ ...config.strategies.marketMaker, minSpread: 0.04, maxOrderSize: 200 }, balance),
    new ArbitrageStrategy({ ...config.strategies.arbitrage, minEdge: 0.05, maxOrderSize: 300 }, balance),
    new MomentumStrategy({ ...config.strategies.momentum, threshold: 0.3, maxOrderSize: 200 }, balance),
    new FundamentalStrategy({ ...config.strategies.fundamental, minConfidence: 0.65, minEdge: 0.08, maxOrderSize: 400 }, balance),
  ]
  const strategyEngine = new StrategyEngine(strategies)

  // Wire up event listeners
  bus.on('trade:executed', async (e) => {
    console.log(`[Order] Executed: ${e.side} ${e.size} @ ${e.price} on ${e.marketId}`)
    if (config.notify.telegram || config.notify.discord) {
      await notifier.info('trade_executed', `${e.side.toUpperCase()} ${e.size.toFixed(2)} @ $${e.price.toFixed(3)} on ${e.marketId}`)
    }
  })

  bus.on('circuit:tripped', async (e) => {
    console.warn(`[Risk] Circuit tripped for strategy ${e.strategyId}: ${e.reason}`)
    await notifier.warning('circuit_breaker', `Circuit tripped: ${e.strategyId} - ${e.reason}`)
  })

  // Dashboard
  createDashboard({ positionTracker, riskManager, strategyEngine, orderRepo, signalRepo, getBalance: () => polyClient.getBalance() }, config.dashboard.port)

  // Main loop
  console.log('[transBoot] Bot loop starting...')
  const INTERVAL_MS = 30_000

  async function tick() {
    try {
      const markets = await polyClient.getMarkets()
      const freshBalance = await polyClient.getBalance()
      riskManager.updateBalance(freshBalance)

      for (const market of markets.slice(0, 20)) {
        const book = await polyClient.getOrderBook(`${market.conditionId}-YES`)
        const priceHistory = [market.yesPrice]

        const quantSignal = quantEngine.compute(priceHistory, book, market.volume24h)

        let llmResult = null
        if (llmProvider) {
          try {
            llmResult = await llmProvider.analyze({ marketId: market.id, question: market.question, category: market.category, yesPrice: market.yesPrice, noPrice: market.noPrice, volume24h: market.volume24h, endDate: market.endDate })
            signalRepo.insert({ marketId: market.id, provider: llmProvider.name, sentiment: llmResult.sentiment, confidence: llmResult.confidence, summary: llmResult.summary, rawResponse: llmResult.rawResponse ?? null })
          } catch (err) {
            console.error('[LLM] Analysis failed:', err)
          }
        }

        const bundle = aggregator.update(market.id, quantSignal, llmResult)
        const intents = await strategyEngine.run(market, bundle)

        for (const intent of intents) {
          const exposure = positionTracker.getTotalExposure()
          const stratExposure = positionTracker.getStrategyExposure(intent.strategyId)
          const check = riskManager.check({ strategyId: intent.strategyId, size: intent.size, price: intent.price, volume24h: market.volume24h, currentExposure: exposure, strategyExposure: stratExposure })

          if (check.allowed) {
            await orderManager.execute(intent)
          } else {
            orderManager.reject(intent, check.reason!)
          }
        }
      }
    } catch (err) {
      console.error('[tick] Error:', err)
    }
  }

  // Run first tick immediately
  await tick()
  setInterval(tick, INTERVAL_MS)
  console.log(`[transBoot] Running. Next tick in ${INTERVAL_MS / 1000}s`)
}

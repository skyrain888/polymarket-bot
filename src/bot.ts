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
import { CopyTradingStrategy } from './strategies/copy-trading/index.ts'
import { Notifier } from './infrastructure/notifier/index.ts'
import { createDashboard } from './infrastructure/dashboard/server.ts'
import { ConfigStore } from './infrastructure/config-store.ts'
import { LLMConfigStore } from './infrastructure/llm-config-store.ts'
import { ArchiveRepository } from './infrastructure/archive/repository.ts'
import { ArchiveService } from './infrastructure/archive/service.ts'
import { ScreenerService } from './strategies/copy-trading/screener/index.ts'

export async function startBot() {
  const config = loadConfig()
  const configStore = new ConfigStore()
  const llmConfigStore = new LLMConfigStore()
  const persisted = configStore.load()
  if (persisted) {
    config.copyTrading = { ...config.copyTrading, ...persisted }
    console.log('[transBoot] Loaded copy-trading config from JSON file')
  } else {
    console.log('[transBoot] No persisted copy-trading config found, using env defaults')
  }
  const persistedLlm = llmConfigStore.load()
  if (persistedLlm) {
    config.llm = { ...config.llm, ...persistedLlm }
    console.log('[transBoot] Loaded LLM config from JSON file')
  }
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
    new CopyTradingStrategy(config.copyTrading),
  ]
  const copyTradingStrategy = strategies[4] as CopyTradingStrategy
  const archiveRepo = new ArchiveRepository(db)
  const archiveService = new ArchiveService(
    archiveRepo,
    copyTradingStrategy,
    () => config.copyTrading.archive,
  )
  archiveService.start()
  const screenerService = config.llm.apiKey
    ? new ScreenerService(config.llm.apiKey, config.llm.model, config.llm.baseUrl)
    : null
  if (screenerService) {
    screenerService.start()
    console.log('[transBoot] Wallet screener initialized')
  }
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
  createDashboard({ positionTracker, riskManager, strategyEngine, orderRepo, signalRepo, getBalance: () => polyClient.getBalance(), config, copyTradingStrategy, configStore, archiveService, archiveRepo, screenerService: screenerService ?? undefined, llmConfigStore }, config.dashboard.port)

  // Main loop
  console.log('[transBoot] Bot loop starting...')

  function getIntervalMs() {
    return Math.max(1000, (config.copyTrading.pollIntervalSeconds ?? 30) * 1000)
  }

  let ticking = false
  async function tick() {
    if (ticking) {
      console.log('[tick] Previous tick still running, skipping')
      return
    }
    ticking = true
    try {
      // Copy trading runs independently - does not need market data
      if (copyTradingStrategy.enabled) {
        try {
          const intent = await copyTradingStrategy.evaluate({} as any, {} as any)
          if (intent) {
            console.log(`[tick] Copy trade intent: ${intent.side} $${intent.size.toFixed(2)} on ${intent.marketId.slice(0, 12)}...`)
            const exposure = positionTracker.getTotalExposure()
            const stratExposure = positionTracker.getStrategyExposure(intent.strategyId)
            const check = riskManager.check({ strategyId: intent.strategyId, size: intent.size, price: intent.price, volume24h: 0, currentExposure: exposure, strategyExposure: stratExposure })
            if (check.allowed) {
              await orderManager.execute(intent)
            } else {
              console.log(`[tick] Copy trade rejected by risk manager: ${check.reason}`)
              orderManager.reject(intent, check.reason!)
            }
          }
        } catch (err) {
          console.error('[tick] Copy trading error:', err)
        }
      }

      const markets = await polyClient.getMarkets()
      console.log(`[tick] Fetched ${markets.length} markets`)
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
    } finally {
      ticking = false
    }
  }

  // Run first tick immediately, then schedule next with dynamic interval
  await tick()
  function scheduleNext() {
    const ms = getIntervalMs()
    setTimeout(async () => {
      await tick()
      scheduleNext()
    }, ms)
  }
  scheduleNext()
  console.log(`[transBoot] Running. Poll interval: ${getIntervalMs() / 1000}s (configurable)`)
}

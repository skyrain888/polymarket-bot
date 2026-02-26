# Polymarket 自动化交易机器人 设计文档

**日期：** 2026-02-27
**技术栈：** Bun + TypeScript
**架构：** 模块化单体（方案 B）

---

## 一、项目目标

构建一个支持 Polymarket 平台的自动化交易机器人，具备：
- 多策略并行运行，动态资金分配
- LLM 定性分析 + 统计模型定量信号双轨 AI 分析
- 完整风险管理体系
- Web Dashboard 实时监控 + 消息通知

---

## 二、整体架构

### 分层结构

```
┌─────────────────────────────────────┐
│  Strategy Layer                     │
│  [MM] [Arb] [Trend] [Fundamental]   │
├─────────────────────────────────────┤
│  Signal Layer                       │
│  [LLMAnalyzer] [QuantEngine]        │
├─────────────────────────────────────┤
│  Core Layer                         │
│  [RiskManager] [OrderManager]       │
│  [PositionTracker] [EventBus]       │
├─────────────────────────────────────┤
│  Infrastructure Layer               │
│  [PolymarketClient] [Storage]       │
│  [Dashboard] [Notifier]             │
└─────────────────────────────────────┘
```

### 项目目录结构

```
transBoot/
├── src/
│   ├── strategies/
│   │   ├── base.strategy.ts
│   │   ├── market-maker/
│   │   ├── arbitrage/
│   │   ├── momentum/
│   │   └── fundamental/
│   ├── signals/
│   │   ├── llm/
│   │   │   ├── provider.interface.ts
│   │   │   ├── claude.provider.ts
│   │   │   ├── openai.provider.ts
│   │   │   ├── gemini.provider.ts
│   │   │   └── ollama.provider.ts
│   │   └── quant/
│   ├── core/
│   │   ├── event-bus.ts
│   │   ├── risk-manager.ts
│   │   ├── order-manager.ts
│   │   └── position-tracker.ts
│   ├── infrastructure/
│   │   ├── polymarket/
│   │   ├── storage/
│   │   ├── dashboard/
│   │   └── notifier/
│   ├── backtest/
│   └── config/
├── docs/plans/
├── tests/
└── package.json
```

### 技术选型

| 层 | 技术 | 理由 |
|---|---|---|
| 运行时 | Bun | 高性能、原生 TS、内置测试 |
| Polymarket 交互 | `@polymarket/clob-client` | 官方 SDK |
| Web Dashboard | Hono + HTMX | 轻量、无需前端构建 |
| 数据库 | SQLite (bun:sqlite) | 零配置、本地持久化 |
| LLM 抽象层 | 自定义 Provider 接口 | 支持 Claude/OpenAI/Gemini/Ollama 热切换 |
| 通知 | node-telegram-bot-api | Telegram 优先 |

---

## 三、策略引擎

### 策略接口

```ts
interface Strategy {
  id: string
  name: string
  enabled: boolean
  evaluate(market: Market, signals: SignalBundle): Promise<TradeIntent | null>
  getWeight(): number
}
```

### 内置策略

| 策略 | 描述 |
|---|---|
| MarketMakerStrategy | 在买卖价差中挂单，自动调整报价 |
| ArbitrageStrategy | 扫描相关市场价格偏差，捕捉套利机会 |
| MomentumStrategy | 检测价格/成交量动量信号，顺势入场 |
| FundamentalStrategy | 结合 LLM 分析事件概率，发现价格偏离 |

---

## 四、信号系统

### 信号流程

```
市场数据流
    ↓
[QuantEngine]        → 技术指标、价格偏差、流动性评分
[LLMAnalyzer]        → 事件解读、情绪评估、概率估计
    ↓
[SignalAggregator]   → 合并信号，生成 SignalBundle
    ↓
各策略 evaluate()
```

### SignalBundle 结构

```ts
interface SignalBundle {
  marketId: string
  timestamp: Date
  quant: {
    priceDeviation: number
    liquidityScore: number
    momentum: number
  }
  llm: {
    sentiment: 'bullish' | 'bearish' | 'neutral'
    confidence: number
    summary: string
  }
}
```

### LLM Provider 接口

```ts
interface LLMProvider {
  analyze(prompt: string, context: MarketContext): Promise<AnalysisResult>
}
```

通过 `config.llm.provider` 配置切换，支持：`claude` | `openai` | `gemini` | `ollama`

---

## 五、风险管理体系

### 三层风险控制

**第一层：仓位管理（每笔交易前）**
- 单笔最大亏损：账户的 1%（可配置）
- 单策略最大仓位：账户的 20%（可配置）
- 总敞口上限：账户的 60%（可配置）
- 下单金额 = 账户总资金 × 单策略最大占比 × Kelly 系数调整

**第二层：策略熔断（实时监控）**

```ts
interface CircuitBreaker {
  maxConsecutiveLosses: number   // 连续亏损 N 次暂停策略
  maxDailyLoss: number           // 日亏损超过 X% 暂停策略
  cooldownMinutes: number        // 冷却时间后自动恢复
}
```

**第三层：流动性保护（下单时）**
- 单笔订单不超过该市场 24h 成交量的 5%
- 价格滑点超过阈值自动取消

### 风险检查流

```
TradeIntent 到达
    ↓
[PositionChecker]  → 检查仓位上限
    ↓
[LiquidityChecker] → 检查市场深度
    ↓
[CircuitBreaker]   → 检查策略熔断状态
    ↓
通过 → OrderManager 执行
拒绝 → 记录原因，通知推送
```

---

## 六、Dashboard 与通知

### Web Dashboard 路由

| 路由 | 内容 |
|---|---|
| `/` | 总览：账户余额、今日PnL、活跃策略数 |
| `/strategies` | 策略状态、开关、熔断状态、历史收益 |
| `/positions` | 当前持仓、盈亏、市场到期时间 |
| `/orders` | 订单历史、成交记录、拒绝原因 |
| `/signals` | AI 信号日志、LLM 分析摘要 |
| `/config` | 运行时配置、风控参数调整（无需重启） |

实时更新：SSE 推送，每 5 秒刷新关键数据

### 通知规则

| 事件 | 级别 | 默认推送 |
|---|---|---|
| 成功下单 | info | 可选 |
| 策略熔断触发 | warning | 总是 |
| 日亏损超限 | critical | 总是 + 自动暂停 |
| LLM 发现高置信机会 | info | 可选 |

支持渠道：Telegram（优先）、Discord Webhook、Email（备用）

---

## 七、数据存储

### SQLite 数据模型

```sql
-- 市场数据快照
markets (id, title, category, end_date, yes_price, no_price, volume, snapshot_at)

-- 订单记录
orders (id, strategy_id, market_id, side, size, price, status, reason, created_at)

-- 仓位追踪
positions (id, market_id, strategy_id, size, avg_price, unrealized_pnl, updated_at)

-- AI 信号历史
signals (id, market_id, provider, sentiment, confidence, summary, raw_response, created_at)

-- 账户快照（每日）
account_snapshots (id, balance, total_pnl, snapshot_date)
```

---

## 八、回测模块

```
历史数据 CSV/JSON
    ↓
[BacktestEngine]   → 模拟事件总线，回放历史价格
    ↓
策略 evaluate()    → 与实盘相同代码路径
    ↓
[BacktestReporter] → 收益率、最大回撤、夏普比率、策略对比
```

回测与实盘共用策略代码，通过 `mode: 'backtest' | 'live'` 切换。

---

## 九、配置结构（示例）

```ts
interface BotConfig {
  mode: 'backtest' | 'paper' | 'live'
  polymarket: {
    apiKey: string
    privateKey: string
  }
  llm: {
    provider: 'claude' | 'openai' | 'gemini' | 'ollama'
    apiKey: string
    model: string
  }
  risk: {
    maxPositionPct: number       // 默认 0.20
    maxTotalExposurePct: number  // 默认 0.60
    maxDailyLossPct: number      // 默认 0.05
  }
  strategies: {
    marketMaker: { enabled: boolean; weight: number }
    arbitrage:   { enabled: boolean; weight: number }
    momentum:    { enabled: boolean; weight: number }
    fundamental: { enabled: boolean; weight: number }
  }
  notify: {
    telegram: { token: string; chatId: string }
    discord:  { webhookUrl: string }
  }
}
```

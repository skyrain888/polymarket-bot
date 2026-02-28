# 智能复盘系统 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Polymarket Bot 增加 4-Agent 智能复盘系统，支持自动/手动触发，分析所有交易数据并生成可执行改进建议。

**Architecture:** ReviewService 协调 4 个 Agent（DataCollector → PnLAnalyzer + StrategyAnalyzer 并行 → Coordinator 汇总）。数据存储在 SQLite `review_reports` 表，Dashboard 新增 `/review` 页面展示报告和建议应用，通知推送摘要。

**Tech Stack:** Bun, SQLite (bun:sqlite), Hono (dashboard), HTMX, Anthropic SDK (LLM)

---

### Task 1: Types 定义

**Files:**
- Create: `src/strategies/review/types.ts`

**Step 1: 创建类型文件**

```typescript
// src/strategies/review/types.ts

// ===== DataCollector 输出 =====

export interface CopyTradeSummary {
  walletAddress: string;
  label: string;
  totalTrades: number;
  totalCopiedSize: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  trades: CopyTradeRecord[];
}

export interface CopyTradeRecord {
  marketId: string;
  title: string;
  outcome: string;
  side: string;
  copiedSize: number;
  price: number;
  currentPrice?: number;
  pnl?: number;
  settled?: boolean;
  timestamp: number;
}

export interface OrderSummary {
  strategyId: string;
  totalOrders: number;
  executedCount: number;
  rejectedCount: number;
  orders: OrderRecord[];
}

export interface OrderRecord {
  marketId: string;
  side: string;
  size: number;
  price: number;
  status: string;
  reason?: string;
  createdAt: string;
}

export interface SignalSummary {
  totalSignals: number;
  byProvider: Record<string, { count: number; avgConfidence: number }>;
  signals: SignalRecord[];
}

export interface SignalRecord {
  marketId: string;
  provider: string;
  sentiment: string;
  confidence: number;
  summary: string;
  createdAt: string;
}

export interface AccountSnapshot {
  balance: number;
  totalPnl: number;
  snapshotDate: string;
}

export interface ReviewDataSummary {
  periodStart: string;
  periodEnd: string;
  copyTrades: CopyTradeSummary[];
  orders: OrderSummary[];
  signals: SignalSummary;
  accountSnapshots: AccountSnapshot[];
  overview: {
    totalPnl: number;
    totalTrades: number;
    winRate: number;
    bestWallet: { label: string; pnl: number } | null;
    worstWallet: { label: string; pnl: number } | null;
  };
}

// ===== PnLAnalyzer 输出 =====

export interface PnLReport {
  overallScore: number; // 0-100
  totalPnl: number;
  winRate: number;
  maxDrawdown: number;
  sharpeEstimate: number;
  profitAttribution: string;
  riskExposure: string;
  drawdownAnalysis: string;
  stabilityAnalysis: string;
  summary: string;
}

// ===== StrategyAnalyzer 输出 =====

export interface WalletScore {
  address: string;
  label: string;
  score: number;
  pnl: number;
  winRate: number;
  assessment: string;
}

export interface StrategyReport {
  overallScore: number;
  walletScores: WalletScore[];
  walletComparison: string;
  signalAccuracy: string;
  marketPreference: string;
  timingAnalysis: string;
  parameterAssessment: string;
  summary: string;
}

// ===== Coordinator 输出 =====

export type SuggestionType =
  | 'adjust_ratio'
  | 'pause_wallet'
  | 'resume_wallet'
  | 'adjust_risk_limit'
  | 'adjust_poll_interval'
  | 'system_improvement';

export interface Suggestion {
  type: SuggestionType;
  description: string;
  target?: string;
  currentValue?: string | number;
  suggestedValue?: string | number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface ReviewReport {
  overallScore: number;
  keyFindings: string[];
  comprehensiveAssessment: string;
  suggestions: Suggestion[];
}

// ===== ReviewService 状态 =====

export type ReviewStatus = 'idle' | 'collecting' | 'analyzing_pnl' | 'analyzing_strategy' | 'coordinating' | 'completed' | 'failed';

export interface ReviewProgress {
  status: ReviewStatus;
  currentReportId?: number;
  error?: string;
}

export interface ReviewConfig {
  enabled: boolean;
  autoReviewTime: string; // HH:mm
  timezone: string;
}

// ===== DB Row =====

export interface ReviewReportRow {
  id: number;
  period_start: string;
  period_end: string;
  trigger_type: string;
  status: string;
  data_summary: string | null;
  pnl_analysis: string | null;
  strategy_analysis: string | null;
  report: string | null;
  suggestions: string | null;
  error: string | null;
  created_at: string;
}
```

**Step 2: Commit**

```bash
git add src/strategies/review/types.ts
git commit -m "feat(review): add type definitions for review system"
```

---

### Task 2: ReviewRepository + DB Schema

**Files:**
- Create: `src/strategies/review/repository.ts`
- Modify: `src/infrastructure/storage/schema.ts`

**Step 1: 添加 review_reports 表到 schema.ts**

在 `schema.ts` 的 `SCHEMA` 数组末尾添加：

```typescript
// 在最后一个 CREATE TABLE 之后添加
`CREATE TABLE IF NOT EXISTS review_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  data_summary TEXT,
  pnl_analysis TEXT,
  strategy_analysis TEXT,
  report TEXT,
  suggestions TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`,
```

**Step 2: 创建 ReviewRepository**

```typescript
// src/strategies/review/repository.ts
import { Database } from 'bun:sqlite';
import type { ReviewReportRow } from './types';

export class ReviewRepository {
  constructor(private db: Database) {}

  create(periodStart: string, periodEnd: string, triggerType: string): number {
    const stmt = this.db.prepare(
      `INSERT INTO review_reports (period_start, period_end, trigger_type, status)
       VALUES ($periodStart, $periodEnd, $triggerType, 'running')`
    );
    stmt.run({ $periodStart: periodStart, $periodEnd: periodEnd, $triggerType: triggerType });
    const row = this.db.query('SELECT last_insert_rowid() as id').get() as { id: number };
    return row.id;
  }

  updateDataSummary(id: number, dataSummary: string): void {
    this.db.prepare('UPDATE review_reports SET data_summary = $data WHERE id = $id')
      .run({ $data: dataSummary, $id: id });
  }

  updatePnlAnalysis(id: number, pnlAnalysis: string): void {
    this.db.prepare('UPDATE review_reports SET pnl_analysis = $data WHERE id = $id')
      .run({ $data: pnlAnalysis, $id: id });
  }

  updateStrategyAnalysis(id: number, strategyAnalysis: string): void {
    this.db.prepare('UPDATE review_reports SET strategy_analysis = $data WHERE id = $id')
      .run({ $data: strategyAnalysis, $id: id });
  }

  updateReport(id: number, report: string, suggestions: string): void {
    this.db.prepare(
      `UPDATE review_reports SET report = $report, suggestions = $suggestions, status = 'completed' WHERE id = $id`
    ).run({ $report: report, $suggestions: suggestions, $id: id });
  }

  updateError(id: number, error: string): void {
    this.db.prepare(`UPDATE review_reports SET status = 'failed', error = $error WHERE id = $id`)
      .run({ $error: error, $id: id });
  }

  findById(id: number): ReviewReportRow | null {
    return this.db.prepare('SELECT * FROM review_reports WHERE id = $id')
      .get({ $id: id }) as ReviewReportRow | null;
  }

  findAll(limit = 20, offset = 0): ReviewReportRow[] {
    return this.db.prepare(
      'SELECT * FROM review_reports ORDER BY created_at DESC LIMIT $limit OFFSET $offset'
    ).all({ $limit: limit, $offset: offset }) as ReviewReportRow[];
  }

  countAll(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM review_reports').get() as { count: number };
    return row.count;
  }
}
```

**Step 3: Commit**

```bash
git add src/strategies/review/repository.ts src/infrastructure/storage/schema.ts
git commit -m "feat(review): add review_reports table and repository"
```

---

### Task 3: DataCollector Agent

**Files:**
- Create: `src/strategies/review/agents/data-collector.ts`

**Step 1: 创建 DataCollector**

DataCollector 从各数据源收集指定周期的数据并计算基础指标。

依赖：
- `ArchiveRepository` — 查询归档跟单交易
- `CopyTradingStrategy` — 获取活跃跟单交易 + PnL
- `OrderRepository` — 查询订单
- `SignalRepository` — 查询信号
- `Database` — 直接查询 account_snapshots

输入：`{ periodStart: string, periodEnd: string }` (ISO date strings)

实现要点：
- 从 `CopyTradingStrategy.getRecentCopiesWithPnl()` 获取活跃交易，按时间过滤
- 从 `ArchiveRepository.findAll()` 获取归档交易，按时间过滤
- 合并两个来源的跟单交易，按钱包分组汇总
- 从 `OrderRepository` 查询周期内订单（需新增 `findByDateRange` 方法）
- 从 `SignalRepository` 查询周期内信号（需新增 `findByDateRange` 方法）
- 从 `account_snapshots` 查询余额快照
- 计算 overview 指标

需要在 `repositories.ts` 中为 `OrderRepository` 和 `SignalRepository` 各添加一个 `findByDateRange(start, end)` 方法：

```typescript
// OrderRepository 新增
findByDateRange(start: string, end: string): OrderRow[] {
  return this.db.prepare(
    'SELECT * FROM orders WHERE created_at >= $start AND created_at <= $end ORDER BY created_at DESC'
  ).all({ $start: start, $end: end }) as OrderRow[];
}

// SignalRepository 新增
findByDateRange(start: string, end: string): SignalRow[] {
  return this.db.prepare(
    'SELECT * FROM signals WHERE created_at >= $start AND created_at <= $end ORDER BY created_at DESC'
  ).all({ $start: start, $end: end }) as SignalRow[];
}
```

DataCollector 构造函数签名：

```typescript
export class DataCollector {
  constructor(
    private db: Database,
    private archiveRepo: ArchiveRepository,
    private orderRepo: OrderRepository,
    private signalRepo: SignalRepository,
    private getCopyStrategy: () => CopyTradingStrategy
  ) {}

  async collect(periodStart: string, periodEnd: string): Promise<ReviewDataSummary> {
    // 1. 收集跟单交易（活跃 + 归档）
    // 2. 收集订单
    // 3. 收集信号
    // 4. 收集账户快照
    // 5. 计算 overview
    // 返回 ReviewDataSummary
  }
}
```

**Step 2: Commit**

```bash
git add src/strategies/review/agents/data-collector.ts src/infrastructure/storage/repositories.ts
git commit -m "feat(review): add DataCollector agent and repository date range queries"
```

---

### Task 4: PnLAnalyzer Agent

**Files:**
- Create: `src/strategies/review/agents/pnl-analyzer.ts`

**Step 1: 创建 PnLAnalyzer**

参考 `src/strategies/copy-trading/screener/llm-analyzer.ts` 的 LLM 调用模式。

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { ReviewDataSummary, PnLReport } from '../types';

export class PnLAnalyzer {
  constructor(private getLLMConfig: () => { provider: string; apiKey: string; model: string; baseURL?: string })

  async analyze(data: ReviewDataSummary): Promise<PnLReport> {
    const config = this.getLLMConfig();
    const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL });

    const prompt = this.buildPrompt(data);
    const response = await client.messages.create({
      model: config.model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    return this.parseResponse(response);
  }

  private buildPrompt(data: ReviewDataSummary): string {
    // 中文 prompt，聚焦：盈亏归因、风险暴露、回撤分析、收益稳定性
    // 要求返回 JSON 格式的 PnLReport
  }

  private parseResponse(response: any): PnLReport {
    // 从 LLM 响应中提取 JSON
  }
}
```

Prompt 要点（中文）：
- 提供周期内所有交易数据摘要
- 要求分析：盈亏归因、风险暴露、回撤、收益稳定性
- 要求输出 JSON 格式，包含 overallScore, totalPnl, winRate, maxDrawdown, sharpeEstimate 等字段
- 每个分析维度输出一段文字说明

**Step 2: Commit**

```bash
git add src/strategies/review/agents/pnl-analyzer.ts
git commit -m "feat(review): add PnLAnalyzer agent"
```

---

### Task 5: StrategyAnalyzer Agent

**Files:**
- Create: `src/strategies/review/agents/strategy-analyzer.ts`

**Step 1: 创建 StrategyAnalyzer**

结构与 PnLAnalyzer 类似，但 prompt 聚焦不同维度。

```typescript
export class StrategyAnalyzer {
  constructor(private getLLMConfig: () => { provider: string; apiKey: string; model: string; baseURL?: string }) {}

  async analyze(data: ReviewDataSummary): Promise<StrategyReport> {
    // 同 PnLAnalyzer 模式，不同 prompt
  }
}
```

Prompt 要点（中文）：
- 各跟单钱包表现对比（收益率、胜率、活跃度）
- 信号准确率分析
- 市场选择偏好
- 交易时机分析
- 跟单参数合理性评估
- 输出 JSON 格式 StrategyReport

**Step 2: Commit**

```bash
git add src/strategies/review/agents/strategy-analyzer.ts
git commit -m "feat(review): add StrategyAnalyzer agent"
```

---

### Task 6: Coordinator Agent

**Files:**
- Create: `src/strategies/review/agents/coordinator.ts`

**Step 1: 创建 Coordinator**

```typescript
export class Coordinator {
  constructor(private getLLMConfig: () => { provider: string; apiKey: string; model: string; baseURL?: string }) {}

  async coordinate(
    data: ReviewDataSummary,
    pnlReport: PnLReport,
    strategyReport: StrategyReport
  ): Promise<ReviewReport> {
    // 汇总两个分析报告 + 原始数据
    // 生成综合评价 + 可执行建议列表
  }
}
```

Prompt 要点（中文）：
- 输入：数据摘要 + PnL 分析 + 策略分析
- 要求：综合评价、关键发现、可执行建议
- 每条建议必须包含 type, description, target, currentValue, suggestedValue, confidence, reasoning
- 建议类型限定为：adjust_ratio, pause_wallet, resume_wallet, adjust_risk_limit, adjust_poll_interval, system_improvement
- 输出 JSON 格式 ReviewReport

**Step 2: Commit**

```bash
git add src/strategies/review/agents/coordinator.ts
git commit -m "feat(review): add Coordinator agent"
```

---

### Task 7: ReviewService 入口

**Files:**
- Create: `src/strategies/review/index.ts`

**Step 1: 创建 ReviewService**

参考 `ScreenerService` 的模式（状态管理、定时调度、进度追踪）。

```typescript
export class ReviewService {
  private progress: ReviewProgress = { status: 'idle' };
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private repo: ReviewRepository,
    private dataCollector: DataCollector,
    private pnlAnalyzer: PnLAnalyzer,
    private strategyAnalyzer: StrategyAnalyzer,
    private coordinator: Coordinator,
    private notifier: { notify(msg: string): void } | null,
    private getConfig: () => ReviewConfig
  ) {}

  start(): void {
    // 计算到下一个 autoReviewTime 的延迟，设置 setTimeout
    // 触发时调用 runAutoReview()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async runManual(periodStart: string, periodEnd: string): Promise<number> {
    return this.run(periodStart, periodEnd, 'manual');
  }

  private async runAutoReview(): Promise<void> {
    // 计算昨天的时间范围
    // 调用 run(yesterday_start, yesterday_end, 'auto')
    // 重新调度下一次
  }

  private async run(periodStart: string, periodEnd: string, triggerType: string): Promise<number> {
    const reportId = this.repo.create(periodStart, periodEnd, triggerType);
    this.progress = { status: 'collecting', currentReportId: reportId };

    try {
      // 1. DataCollector
      this.progress.status = 'collecting';
      const data = await this.dataCollector.collect(periodStart, periodEnd);
      this.repo.updateDataSummary(reportId, JSON.stringify(data));

      // 2. PnLAnalyzer + StrategyAnalyzer 并行
      this.progress.status = 'analyzing_pnl';
      const [pnlReport, strategyReport] = await Promise.all([
        this.pnlAnalyzer.analyze(data),
        this.strategyAnalyzer.analyze(data),
      ]);
      this.repo.updatePnlAnalysis(reportId, JSON.stringify(pnlReport));
      this.repo.updateStrategyAnalysis(reportId, JSON.stringify(strategyReport));

      // 3. Coordinator
      this.progress.status = 'coordinating';
      const report = await this.coordinator.coordinate(data, pnlReport, strategyReport);
      this.repo.updateReport(reportId, JSON.stringify(report), JSON.stringify(report.suggestions));

      this.progress = { status: 'completed', currentReportId: reportId };

      // 4. 通知推送
      this.sendNotification(data, report);

      return reportId;
    } catch (err: any) {
      this.repo.updateError(reportId, err.message);
      this.progress = { status: 'failed', currentReportId: reportId, error: err.message };
      throw err;
    }
  }

  getProgress(): ReviewProgress { return this.progress; }

  private sendNotification(data: ReviewDataSummary, report: ReviewReport): void {
    if (!this.notifier) return;
    // 构建摘要消息：周期PnL、胜率、最佳/最差钱包、Top 3 建议
  }
}
```

**Step 2: Commit**

```bash
git add src/strategies/review/index.ts
git commit -m "feat(review): add ReviewService with scheduling and agent orchestration"
```

---

### Task 8: Bot 集成

**Files:**
- Modify: `src/bot.ts`
- Modify: `src/infrastructure/dashboard/server.ts` (DashboardDeps 接口)

**Step 1: 在 bot.ts 中创建并注入 ReviewService**

在 `startBot()` 中，ScreenerService 创建之后：

```typescript
// 创建 ReviewService
const reviewRepo = new ReviewRepository(db);
const dataCollector = new DataCollector(db, archiveRepo, orderRepo, signalRepo, () => strategies[4] as CopyTradingStrategy);
const getLLMConfig = () => ({ provider: config.llm.provider, apiKey: config.llm.apiKey, model: config.llm.model, baseURL: config.llm.baseURL });
const pnlAnalyzer = new PnLAnalyzer(getLLMConfig);
const strategyAnalyzer = new StrategyAnalyzer(getLLMConfig);
const coordinator = new Coordinator(getLLMConfig);
const reviewService = new ReviewService(reviewRepo, dataCollector, pnlAnalyzer, strategyAnalyzer, coordinator, notifier, () => config.copyTrading?.review ?? { enabled: false, autoReviewTime: '00:00', timezone: 'UTC' });

if (config.llm.apiKey) {
  reviewService.start();
}
```

将 `reviewService` 添加到 `createDashboard` 的 deps 中。

**Step 2: Commit**

```bash
git add src/bot.ts src/infrastructure/dashboard/server.ts
git commit -m "feat(review): wire ReviewService into bot startup"
```

---

### Task 9: Dashboard 路由

**Files:**
- Modify: `src/infrastructure/dashboard/server.ts`

**Step 1: 添加 /review 相关路由**

新增路由：
- `GET /review` — 复盘主页面
- `POST /review/run` — 手动触发复盘
- `GET /review/progress` — 进度轮询（HTMX）
- `GET /review/report/:id` — 查看报告详情
- `GET /review/history` — 历史报告列表
- `POST /review/config` — 更新自动复盘配置
- `POST /review/apply-suggestion` — 应用建议到配置

页面结构：
- 手动触发区（日期选择 + 快捷按钮 + 开始按钮）
- 自动复盘设置（开关 + 时间）
- 进度展示（4 agent 状态，HTMX 轮询）
- 报告展示（tab 切换：概览/收益/策略/建议）
- 历史报告列表

参考 screener 页面的 HTMX 模式：
- 触发后显示进度区域，`hx-trigger="every 2s"` 轮询 `/review/progress`
- 完成后自动加载报告内容
- 建议的"应用"按钮用 `hx-post="/review/apply-suggestion"` + `hx-confirm`

**Step 2: Commit**

```bash
git add src/infrastructure/dashboard/server.ts
git commit -m "feat(review): add dashboard routes and review page"
```

---

### Task 10: 建议应用逻辑

**Files:**
- Modify: `src/infrastructure/dashboard/server.ts`

**Step 1: 实现 POST /review/apply-suggestion**

根据建议的 `type` 调用对应的配置修改：
- `adjust_ratio` → 修改钱包的 `sizeMultiplier`
- `pause_wallet` → 设置钱包 `enabled: false`（需在 WalletConfig 中支持）
- `resume_wallet` → 设置钱包 `enabled: true`
- `adjust_risk_limit` → 修改 `copyTrading.limits` 中的对应字段
- `adjust_poll_interval` → 修改 `copyTrading.pollIntervalSeconds`
- `system_improvement` → 不支持自动应用，返回提示

复用现有的 `applyConfig()` 函数和 `configStore.save()` 模式。

**Step 2: Commit**

```bash
git add src/infrastructure/dashboard/server.ts
git commit -m "feat(review): add suggestion apply logic"
```

---

### Task 11: 通知推送

**Files:**
- Modify: `src/strategies/review/index.ts`

**Step 1: 实现 sendNotification**

```typescript
private sendNotification(data: ReviewDataSummary, report: ReviewReport): void {
  if (!this.notifier) return;
  const { overview } = data;
  const top3 = report.suggestions.slice(0, 3);
  const msg = [
    `📊 复盘报告 (${data.periodStart} ~ ${data.periodEnd})`,
    `总 PnL: $${overview.totalPnl.toFixed(2)} | 胜率: ${(overview.winRate * 100).toFixed(1)}%`,
    overview.bestWallet ? `最佳钱包: ${overview.bestWallet.label} ($${overview.bestWallet.pnl.toFixed(2)})` : '',
    overview.worstWallet ? `最差钱包: ${overview.worstWallet.label} ($${overview.worstWallet.pnl.toFixed(2)})` : '',
    `\n改进建议:`,
    ...top3.map((s, i) => `${i + 1}. ${s.description}`),
    `\n详情: http://localhost:3000/review`,
  ].filter(Boolean).join('\n');
  this.notifier.notify(msg);
}
```

**Step 2: Commit**

```bash
git add src/strategies/review/index.ts
git commit -m "feat(review): add notification on review completion"
```

---

### Task 12: Config 集成

**Files:**
- Modify: `src/strategies/copy-trading/types.ts` — 在 CopyTradingConfig 中添加 review 字段
- Modify: `src/infrastructure/config-store.ts` — 确保 review 配置持久化

**Step 1: 扩展 CopyTradingConfig**

```typescript
// 在 CopyTradingConfig 中添加
review?: ReviewConfig;
```

其中 `ReviewConfig` 从 `src/strategies/review/types.ts` 导入。

**Step 2: Commit**

```bash
git add src/strategies/copy-trading/types.ts src/infrastructure/config-store.ts
git commit -m "feat(review): integrate review config into copy-trading config"
```

---

### Task 13: 端到端测试

**Step 1: 手动验证**

1. 启动 bot: `bun run src/index.ts`
2. 访问 http://localhost:3000/review
3. 验证页面渲染正常
4. 选择时间范围，点击"开始复盘"
5. 观察进度展示
6. 验证报告展示（4 个 tab）
7. 测试建议"应用"按钮
8. 验证历史报告列表
9. 验证自动复盘配置开关

**Step 2: 最终 Commit**

```bash
git add -A
git commit -m "feat(review): complete review system integration"
```

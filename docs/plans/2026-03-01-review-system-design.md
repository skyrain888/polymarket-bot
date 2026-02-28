# 智能复盘系统设计文档

## 概述

为 Polymarket Bot 增加智能复盘功能，支持自动（每天结束）和手动触发，对选定周期内的所有交易数据进行智能分析，生成改进建议（策略调整 + 系统能力调整），并支持一键应用建议到系统配置。

## 架构

### Agent Team（4 Agent 专业分工）

```
ReviewService (协调入口)
  ├── DataCollector Agent  ──→ 收集+预处理交易数据（纯数据层）
  ├── PnLAnalyzer Agent    ──→ 收益风险分析（LLM）
  ├── StrategyAnalyzer Agent ──→ 策略行为分析（LLM）
  └── Coordinator Agent    ──→ 汇总报告+可执行建议（LLM）
```

### 触发方式

- **自动触发**: 每天 UTC 0:00（Polymarket 日结），分析前一天的交易
- **手动触发**: Dashboard 页面选择时间范围后触发

### 数据源

| 数据源 | 内容 | 用途 |
|--------|------|------|
| `copy-trades.json` | 活跃跟单交易（含实时 PnL） | 跟单表现分析 |
| `copy_trades_archive` 表 | 归档跟单交易 | 历史跟单分析 |
| `orders` 表 | 所有策略订单历史 | 全策略表现分析 |
| `signals` 表 | LLM/量化信号历史 | 信号准确率分析 |
| `account_snapshots` 表 | 账户余额快照 | 资金曲线分析 |

## Agent 详细设计

### DataCollector Agent

纯数据层，不调用 LLM。

- **输入**: `{ periodStart: string, periodEnd: string }`
- **职责**:
  - 查询 `copy-trades.json` + `copy_trades_archive` 中指定周期的跟单交易
  - 调用 `getRecentCopiesWithPnl()` 获取实时 PnL
  - 查询 `orders` 表中指定周期的订单
  - 查询 `signals` 表中指定周期的信号
  - 查询 `account_snapshots` 表中的余额快照
  - 计算基础指标：总 PnL、胜率、交易次数、按钱包/市场/策略汇总
- **输出**: `ReviewDataSummary`（结构化 JSON）

### PnLAnalyzer Agent

LLM 分析，聚焦收益与风险维度。

- **输入**: `ReviewDataSummary`
- **Prompt 聚焦**:
  - 盈亏归因（哪些交易/市场贡献最大盈亏）
  - 风险暴露分析（集中度、最大单笔亏损）
  - 回撤分析（最大回撤、回撤持续时间）
  - 收益稳定性（日收益波动、夏普比率估算）
- **输出**: `PnLReport`（分析文本 + 结构化指标）

### StrategyAnalyzer Agent

LLM 分析，聚焦策略行为维度。

- **输入**: `ReviewDataSummary`
- **Prompt 聚焦**:
  - 各跟单钱包表现对比（收益率、胜率、活跃度）
  - 信号准确率（LLM/量化信号 vs 实际结果）
  - 市场选择偏好分析（哪类市场表现好/差）
  - 交易时机分析（入场/出场时机评估）
  - 跟单参数合理性（比例、限额是否需要调整）
- **输出**: `StrategyReport`（分析文本 + 策略评分）

### Coordinator Agent

LLM 汇总，生成最终报告和可执行建议。

- **输入**: `PnLReport` + `StrategyReport` + `ReviewDataSummary`
- **职责**:
  - 生成综合评价（整体表现评分、关键发现）
  - 生成可执行建议列表，每条建议包含:
    - `type`: 建议类型（`adjust_ratio` | `pause_wallet` | `resume_wallet` | `adjust_risk_limit` | `adjust_poll_interval` | `system_improvement`）
    - `description`: 建议描述
    - `target`: 目标参数路径
    - `currentValue`: 当前值
    - `suggestedValue`: 建议值
    - `confidence`: 置信度（high/medium/low）
    - `reasoning`: 推理依据
- **输出**: `ReviewReport`（最终报告）

## 数据库

新增 `review_reports` 表：

```sql
CREATE TABLE IF NOT EXISTS review_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  trigger_type TEXT NOT NULL,        -- 'auto' | 'manual'
  status TEXT NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'failed'
  data_summary TEXT,                 -- JSON: DataCollector 输出
  pnl_analysis TEXT,                 -- JSON: PnLAnalyzer 输出
  strategy_analysis TEXT,            -- JSON: StrategyAnalyzer 输出
  report TEXT,                       -- JSON: Coordinator 最终报告
  suggestions TEXT,                  -- JSON: 可执行建议列表
  error TEXT,                        -- 失败时的错误信息
  created_at TEXT DEFAULT (datetime('now'))
);
```

## Dashboard 页面

新增 `/review` 路由：

### 手动触发区
- 日期范围选择器（开始日期 + 结束日期）
- "开始复盘" 按钮
- 快捷选项：今天、昨天、最近 7 天、最近 30 天

### 自动复盘设置
- 启用/禁用开关
- 触发时间配置（默认 UTC 0:00）

### 进度展示
- 4 个 agent 的执行状态指示器（待执行/执行中/完成/失败）
- 类似 screener 的轮询进度展示（HTMX hx-trigger="every 2s"）

### 报告展示
- 分 tab 展示：概览 / 收益分析 / 策略分析 / 建议
- 概览 tab：关键指标卡片（总 PnL、胜率、交易次数、最佳钱包、最差钱包）
- 收益分析 tab：PnLAnalyzer 的详细分析内容
- 策略分析 tab：StrategyAnalyzer 的详细分析内容
- 建议 tab：可执行建议列表，每条建议旁有"应用"按钮

### 建议应用
- 点击"应用"按钮后弹出确认，展示当前值 → 建议值
- 确认后调用对应 API 修改配置（复用现有 copy-trading 配置 API）
- `system_improvement` 类型建议仅展示，不提供自动应用

### 历史报告
- 报告列表（时间、触发方式、状态、关键指标摘要）
- 点击查看完整报告

## 通知推送

复盘完成后通过现有 Notifier 推送摘要：
- 周期 PnL、胜率
- 最佳/最差跟单钱包
- Top 3 改进建议
- Dashboard 链接

## 文件结构

```
src/strategies/review/
  ├── index.ts              # ReviewService 入口（调度、定时、状态管理）
  ├── types.ts              # 类型定义
  ├── agents/
  │   ├── data-collector.ts # DataCollector Agent
  │   ├── pnl-analyzer.ts   # PnLAnalyzer Agent（LLM）
  │   ├── strategy-analyzer.ts # StrategyAnalyzer Agent（LLM）
  │   └── coordinator.ts    # Coordinator Agent（LLM）
  └── repository.ts         # ReviewRepository（review_reports CRUD）
```

Dashboard 相关改动：
- `src/infrastructure/dashboard/server.ts` — 新增 /review 相关路由
- `src/infrastructure/dashboard/views.ts` — 新增复盘页面模板

## 配置

复用现有 LLM 配置（`data/llm-config.json`），新增 review 相关配置到 `copy-trading.json`：

```json
{
  "review": {
    "enabled": true,
    "autoReviewTime": "00:00",
    "timezone": "UTC"
  }
}
```

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  end_date TEXT,
  yes_price REAL,
  no_price REAL,
  volume REAL,
  snapshot_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  size REAL NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  size REAL NOT NULL DEFAULT 0,
  avg_price REAL NOT NULL DEFAULT 0,
  unrealized_pnl REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(market_id, strategy_id)
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  sentiment TEXT,
  confidence REAL,
  summary TEXT,
  raw_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  balance REAL NOT NULL,
  total_pnl REAL NOT NULL DEFAULT 0,
  snapshot_date TEXT NOT NULL DEFAULT (date('now')),
  UNIQUE(snapshot_date)
);

CREATE TABLE IF NOT EXISTS copy_trades_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  wallet TEXT NOT NULL,
  label TEXT NOT NULL,
  market_id TEXT NOT NULL,
  traded_at INTEGER NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

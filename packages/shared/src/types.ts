// ─── Tick / Market Data ──────────────────────────────────────────────────────

export interface TickData {
  symbol: string;
  price: number;
  volume: number;
  timestamp: Date;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  change?: number;
  changePercent?: number;
  /** Best bid / ask quote and their sizes. */
  bid?: number;
  ask?: number;
  bidVolume?: number;
  askVolume?: number;
}

export interface OHLCVBar {
  symbol: string;
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Rule Engine ─────────────────────────────────────────────────────────────

export type ConditionType =
  | 'PRICE_ABOVE'
  | 'PRICE_BELOW'
  | 'PRICE_ABOVE_MA'
  | 'PRICE_BELOW_MA'
  | 'MA_CROSS_ABOVE'
  | 'MA_CROSS_BELOW'
  | 'RSI_OVERSOLD'
  | 'RSI_OVERBOUGHT'
  | 'VOLUME_SPIKE'
  | 'PRICE_BREAK_HIGH'
  | 'PRICE_BREAK_LOW'
  | 'BOLLINGER_BREAK_UPPER'
  | 'BOLLINGER_BREAK_LOWER';

export interface Condition {
  type: ConditionType;
  params: Record<string, number | string>;
}

export type ActionType = 'notify' | 'trade';

/** Signals a rule may emit. NOTIFY is an alert-only signal (no trade direction). */
export type Signal = 'BUY' | 'SELL' | 'NOTIFY';

/**
 * A rule's evaluation logic. Two formats are supported:
 *
 * 1. **Code-based (preferred)** — `code` holds an AI-generated JavaScript function
 *    body executed in a secure sandbox. It has access to `get_data`, `get_detail`,
 *    `stock`, and `curr_time`, and must return `{ signal, message }` or `null`.
 * 2. **Declarative (legacy)** — `conditions` + `logic` describe indicator comparisons
 *    evaluated by the built-in rule engine.
 */
export interface RuleConfig {
  /** AI-generated JavaScript rule body. When present, takes precedence over `conditions`. */
  code?: string;
  /** Legacy declarative conditions (used when `code` is absent). */
  conditions?: Condition[];
  /** Legacy combining logic for `conditions`. */
  logic?: 'AND' | 'OR';
  /**
   * Primary signal of the rule. For code rules the runtime signal comes from the
   * returned object; this field is the expected/default signal used by backtests and UI.
   */
  signal: Signal;
  actionType: ActionType;
}

export interface RuleResult {
  triggered: boolean;
  signal?: Signal;
  message?: string;
  /** Suggested order size in shares, for BUY/SELL signals from `actionType: "trade"` rules. AI-generated code sets this explicitly; falls back to a default when absent. */
  quantity?: number;
  data?: Record<string, unknown>;
  /** Populated when code-rule execution failed (syntax/runtime error, timeout, invalid return). */
  error?: string;
}

// ─── API DTOs ─────────────────────────────────────────────────────────────────

export type PoolType = 'FIXED' | 'DYNAMIC';

export interface CreateRuleDto {
  name: string;
  description: string;
  symbols: string[];
  poolType?: PoolType;
  poolFilterCode?: string;
  config: RuleConfig;
  sessionId?: string;
  userId?: string;
}

export interface RuleDto {
  id: string;
  name: string;
  description: string;
  symbols: string[];
  poolType: PoolType;
  poolFilterCode: string | null;
  config: RuleConfig;
  sessionId: string | null;
  isActive: boolean;
  winRate: number | null;
  createdAt: string;
  updatedAt: string;
  triggersCount: number;
}

export interface TriggerDto {
  id: string;
  ruleId: string;
  ruleName: string;
  symbol: string;
  signal: string;
  price: number;
  quantity: number | null;
  message: string;
  triggeredAt: string;
}

export interface UserSettingsDto {
  email: string | null;
  lineToken: string | null;
  discordWebhook: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Broadcast over Socket.IO ('signal' / 'notification' events) when a rule triggers. */
export interface SignalPayloadDto {
  ruleId: string;
  ruleName: string;
  triggerId: string;
  symbol: string;
  signal: Signal;
  price: number;
  /** Suggested order size in shares. Only meaningful for BUY/SELL; null for NOTIFY. */
  quantity: number | null;
  message: string;
  triggeredAt: string;
}

// ─── Trading App Activity ────────────────────────────────────────────────────

export type TradeStatus = 'FILLED' | 'FAILED' | 'SIMULATED' | 'REJECTED';
export type TradeSource = 'LIVE' | 'SIMULATION';

export interface ReportTradeActivityDto {
  ruleId?: string;
  ruleName?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  status: TradeStatus;
  orderId?: string;
  message?: string;
  source: TradeSource;
}

export interface TradeActivityDto {
  id: string;
  ruleId: string | null;
  ruleName: string | null;
  symbol: string;
  side: string;
  quantity: number;
  price: number | null;
  status: string;
  orderId: string | null;
  message: string | null;
  source: string;
  createdAt: string;
}

// ─── Subscription Plans ──────────────────────────────────────────────────────

export type PlanId = 'FREE' | 'PLAN_399' | 'PLAN_799';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: number;
  dailyRuleLimit: number | null;
  dailyChatLimit: number | null;
  canDownloadTradingApp: boolean;
  features: string[];
}

export interface PlanStatus {
  plans: PlanDefinition[];
  current: {
    planId: PlanId;
    planName: string;
    canDownloadTradingApp: boolean;
    usage: {
      rulesToday: number;
      rulesLimit: number | null;
      chatToday: number;
      chatLimit: number | null;
    };
  };
}

export interface BacktestResult {
  totalSignals: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  signals: {
    date: string;
    symbol: string;
    signal: Signal;
    price: number;
    triggered: boolean;
    profitPercent?: number;
  }[];
}

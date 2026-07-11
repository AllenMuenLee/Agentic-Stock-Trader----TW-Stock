import type { TaiwanMarketType, TaiwanPriceType, TaiwanTimeInForce } from './market-session';

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
  /**
   * Suggested order size in shares, for BUY/SELL signals from `actionType: "trade"` rules.
   * AI-generated code sets this explicitly; falls back to a default when absent.
   * `'ALL'` means "sell my entire position" (SELL) or "spend all available cash" (BUY) —
   * the API server never resolves this itself (it doesn't know real account numbers);
   * only the trading-app does, right before sending the order to Fubon.
   */
  quantity?: number | 'ALL';
  /**
   * Optional hints for order routing on BUY/SELL trade signals — never required.
   * When omitted, the server derives sensible defaults via `resolveOrderRouting()`
   * (market.ts) based on the current Taiwan trading session and quantity. These
   * are overridden/corrected automatically whenever the resolved market segment
   * has a non-negotiable rule (e.g. 零股 must be 限價 ROD) — see `resolveOrderRouting`.
   */
  priceType?: TaiwanPriceType;
  timeInForce?: TaiwanTimeInForce;
  /** Desired limit price when `priceType` is `'Limit'`. Defaults to the latest reference price if omitted. */
  limitPrice?: number;
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
  /** Realized return % (not win rate) from the most recent backtest run. */
  returnRate: number | null;
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
  /** `'ALL'` when the rule returned the "all position / all cash" sentinel — `quantity` is null in that case since the real number isn't known until the trading-app resolves it. */
  quantitySpec: string | null;
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
  /**
   * Suggested order size in shares. Only meaningful for BUY/SELL; null for NOTIFY.
   * `'ALL'` is an unresolved sentinel — the trading-app resolves it against its own
   * live account cache right before sending the order.
   */
  quantity: number | 'ALL' | null;
  /**
   * Resolved Taiwan order routing (market segment / price type / time-in-force /
   * limit price), computed by `resolveOrderRouting()`. Null on all four fields
   * when `quantity === 'ALL'` — routing can't be resolved until the trading-app
   * knows the real account numbers, so it resolves this itself right before
   * sending the order (`orderAllowed` stays `true` in that deferred case).
   * `orderAllowed: false` means a concrete-quantity signal was already rejected
   * here (e.g. outside trading hours) — `orderNote` holds `OrderRouting.reason`
   * in that case, or `OrderRouting.note` (an auto-correction explanation, e.g.
   * "零股交易僅允許限價 ROD") when `orderAllowed` is `true`.
   */
  marketType: TaiwanMarketType | null;
  priceType: TaiwanPriceType | null;
  timeInForce: TaiwanTimeInForce | null;
  limitPrice: number | null;
  orderAllowed: boolean;
  orderNote: string | null;
  message: string;
  triggeredAt: string;
}

// ─── Account Snapshot (trading-app → API, cached for rule evaluation) ────────

export interface AccountPosition {
  symbol: string;
  quantity: number;
}

/** Reported periodically by the trading-app from its own live Fubon session — never contains credentials. */
export interface ReportAccountSnapshotDto {
  cash: number;
  positions: AccountPosition[];
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
  /** Milliseconds from signal-triggered to order-sent (includes user confirmation time). Absent for REJECTED — no order was ever sent. */
  latencyMs?: number;
  /** Resolved Taiwan order routing actually used for this order. Absent for REJECTED (no order was ever routed/sent). */
  marketType?: TaiwanMarketType;
  priceType?: TaiwanPriceType;
  timeInForce?: TaiwanTimeInForce;
  limitPrice?: number;
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
  latencyMs: number | null;
  marketType: string | null;
  priceType: string | null;
  timeInForce: string | null;
  limitPrice: number | null;
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
  /**
   * Realized return over the whole backtest window, as a % of `totalInvested`.
   * Simulated as a real position (BUY adds shares at cost, SELL closes at most
   * as many shares as are held, no shorting) rather than assuming every signal
   * is exited on the very next bar — the rule itself never specifies an exit.
   */
  returnRate: number;
  /**
   * Mark-to-market return of whatever position is still open (bought but never
   * sold) as of the last bar, as a % of `openPositionCost`. `null` when nothing
   * was left open at the end of the backtest.
   */
  unrealizedReturnRate: number | null;
  /** Total $ profit/loss actually realized from completed (bought-then-sold) shares. */
  realizedPnL: number;
  /** Total $ deployed across every BUY signal — the denominator for `returnRate`. */
  totalInvested: number;
  /** Mark-to-market $ gain/loss on the still-open position, if any. */
  unrealizedPnL: number;
  /** Cost basis of the still-open position, if any — the denominator for `unrealizedReturnRate`. */
  openPositionCost: number;
  signals: {
    date: string;
    symbol: string;
    signal: Signal;
    price: number;
    quantity: number | null;
    triggered: boolean;
    /** Resolved Taiwan order routing for this simulated fill. Null when the signal didn't actually execute (e.g. insufficient cash/shares, or outside trading hours). */
    marketType: TaiwanMarketType | null;
    priceType: TaiwanPriceType | null;
    timeInForce: TaiwanTimeInForce | null;
    limitPrice: number | null;
  }[];
}

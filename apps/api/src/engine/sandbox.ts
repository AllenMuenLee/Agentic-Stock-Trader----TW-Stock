import vm from 'vm';
import type { Signal, TaiwanPriceType, TaiwanTimeInForce } from '@stock-notifier/shared';
import type { DataContext } from './data-context';

const VALID_PRICE_TYPES: readonly TaiwanPriceType[] = ['Limit', 'Market'];
const VALID_TIME_IN_FORCE: readonly TaiwanTimeInForce[] = ['ROD', 'IOC', 'FOK'];

/** Successful, triggered result returned by a rule's code. */
export interface RuleCodeResult {
  signal: Signal;
  message: string;
  /**
   * Suggested order size in shares for BUY/SELL signals. Undefined when the code
   * didn't specify one. `'ALL'` means "entire position" (SELL) or "all available
   * cash" (BUY) — resolved later by the trading-app, not here.
   */
  quantity?: number | 'ALL';
  /**
   * Optional order-routing hints — never required. `marketType` is deliberately
   * NOT accepted here: it's always mechanically derived server-side from quantity
   * + the current Taiwan trading session (see `resolveOrderRouting` in
   * `@stock-notifier/shared`), never trusted from rule code.
   */
  priceType?: TaiwanPriceType;
  timeInForce?: TaiwanTimeInForce;
  limitPrice?: number;
}

export interface SandboxOutcome {
  /** The triggered result, or null when the rule did not fire. */
  result: RuleCodeResult | null;
  /** Populated when the code failed validation, threw, or timed out. */
  error?: string;
}

const VALID_SIGNALS: readonly Signal[] = ['BUY', 'SELL', 'NOTIFY'];

/** Max wall-clock time a rule body may run, in milliseconds. */
const EXECUTION_TIMEOUT_MS = 250;

/**
 * Identifiers that could be leveraged to escape the sandbox or reach the host.
 * Rejected before execution as a defense-in-depth layer on top of the restricted
 * vm context. Deliberately narrow — only true escape/host vectors — so it never
 * gets in the way of legitimate market logic (loops, math, derived metrics, etc.).
 */
const FORBIDDEN_PATTERN =
  /\b(require|process|module|exports|globalThis|eval|Function|constructor|__proto__|__defineGetter__|__defineSetter__|Reflect|Proxy|WebAssembly|import|fetch|XMLHttpRequest|child_process|setTimeout|setInterval|setImmediate)\b/;

function staticCheck(code: string): string | null {
  const match = code.match(FORBIDDEN_PATTERN);
  return match ? `Rule code uses forbidden identifier "${match[0]}"` : null;
}

function validateResult(value: unknown): SandboxOutcome {
  if (value === null || value === undefined) return { result: null };

  if (typeof value !== 'object') {
    return { result: null, error: 'Rule must return an object or null' };
  }

  const obj = value as Record<string, unknown>;
  const signal = obj.signal;

  if (typeof signal !== 'string' || !VALID_SIGNALS.includes(signal as Signal)) {
    return {
      result: null,
      error: `Rule returned invalid signal "${String(signal)}" (expected BUY, SELL, or NOTIFY)`,
    };
  }

  const message =
    typeof obj.message === 'string' && obj.message.trim().length > 0
      ? obj.message
      : `${signal} signal triggered`;

  // Rule code commonly spreads a whole `resolve_order_type()` result (e.g.
  // `{ ...routing, signal, message }`) into its return object, which carries
  // explicit `null`s for fields that don't apply (e.g. `limitPrice: null` for a
  // Market order) — treat null the same as "not specified", not as invalid.
  let priceType: TaiwanPriceType | undefined;
  if (obj.priceType != null) {
    if (typeof obj.priceType !== 'string' || !VALID_PRICE_TYPES.includes(obj.priceType as TaiwanPriceType)) {
      return { result: null, error: `Rule returned invalid priceType "${String(obj.priceType)}" (expected "Limit" or "Market")` };
    }
    priceType = obj.priceType as TaiwanPriceType;
  }

  let timeInForce: TaiwanTimeInForce | undefined;
  if (obj.timeInForce != null) {
    if (typeof obj.timeInForce !== 'string' || !VALID_TIME_IN_FORCE.includes(obj.timeInForce as TaiwanTimeInForce)) {
      return { result: null, error: `Rule returned invalid timeInForce "${String(obj.timeInForce)}" (expected "ROD", "IOC", or "FOK")` };
    }
    timeInForce = obj.timeInForce as TaiwanTimeInForce;
  }

  let limitPrice: number | undefined;
  if (obj.limitPrice != null) {
    if (typeof obj.limitPrice !== 'number' || !Number.isFinite(obj.limitPrice) || obj.limitPrice <= 0) {
      return { result: null, error: `Rule returned invalid limitPrice "${String(obj.limitPrice)}" (expected a positive number)` };
    }
    limitPrice = obj.limitPrice;
  }

  const orderHints = { priceType, timeInForce, limitPrice };

  if (obj.quantity !== undefined) {
    if (obj.quantity === 'ALL') {
      return { result: { signal: signal as Signal, message, quantity: 'ALL', ...orderHints } };
    }
    if (typeof obj.quantity !== 'number' || !Number.isFinite(obj.quantity) || obj.quantity <= 0) {
      return { result: null, error: `Rule returned invalid quantity "${String(obj.quantity)}" (expected a positive number or "ALL")` };
    }
    return { result: { signal: signal as Signal, message, quantity: obj.quantity, ...orderHints } };
  }

  return { result: { signal: signal as Signal, message, ...orderHints } };
}

// Cache compiled pool filter scripts so we don't pay vm.Script compilation
// cost for every symbol when a DYNAMIC pool has thousands of candidates.
const poolFilterCache = new Map<string, { script: vm.Script; ctx: vm.Context; sandbox: Record<string, unknown> }>();

// Cache compiled rule scripts for the same reason — a backtest evaluates the
// same rule code across hundreds of symbols × thousands of bars, so compiling
// once and reusing the context (with per-call sandbox updates) is a large win.
const ruleScriptCache = new Map<string, { script: vm.Script; ctx: vm.Context; sandbox: Record<string, unknown> }>();

/**
 * Evaluates a pool filter code body to decide if a symbol belongs in a dynamic pool.
 *
 * The body receives `stock` and `get_meta` and must return a boolean (truthy/falsy).
 * Example: `return get_meta(stock, 'sector') === 'Semiconductors';`
 *
 * The Script is compiled once per unique filterCode and the context is reused
 * across symbol evaluations — stock/get_meta are swapped per call.
 */
export function runPoolFilter(
  filterCode: string,
  stock: string,
  getMeta: (key: string) => unknown,
): boolean {
  const forbidden = staticCheck(filterCode);
  if (forbidden) return false;

  let entry = poolFilterCache.get(filterCode);
  if (!entry) {
    const sandbox: Record<string, unknown> = Object.create(null);
    sandbox.Math = Math;
    sandbox.String = String;
    sandbox.Boolean = Boolean;
    sandbox.Number = Number;
    const wrapped = `(function() {\n"use strict";\n${filterCode}\n})()`;
    try {
      const script = new vm.Script(wrapped, { filename: 'pool-filter.js' });
      const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
      entry = { script, ctx, sandbox };
      poolFilterCache.set(filterCode, entry);
    } catch {
      return false;
    }
  }

  entry.sandbox.stock = stock;
  entry.sandbox.get_meta = (_s: string, key: string) => getMeta(key);

  try {
    const value = entry.script.runInContext(entry.ctx, { timeout: 100, breakOnSigint: true });
    return Boolean(value);
  } catch {
    return false;
  }
}

/**
 * Executes an AI-generated rule body inside a restricted Node `vm` context.
 *
 * Only the data-fetching API (`get_data`, `get_detail`) and the read-only
 * context variables (`stock`, `curr_time`) plus a handful of pure built-ins are
 * exposed. There is no access to `process`, `require`, the filesystem, the
 * network, or timers, and execution is bounded by a hard timeout.
 *
 * The body is run as a function so it may use `return` to emit its result.
 */
export function runRuleCode(code: string, context: DataContext): SandboxOutcome {
  const forbidden = staticCheck(code);
  if (forbidden) return { result: null, error: forbidden };

  let entry = ruleScriptCache.get(code);
  if (!entry) {
    const sandbox: Record<string, unknown> = Object.create(null);
    sandbox.Math = Math;
    sandbox.Number = Number;
    sandbox.JSON = JSON;
    sandbox.console = { log: () => {}, error: () => {}, warn: () => {} };
    // Placeholders — overwritten per call below before execution
    sandbox.get_data = null; sandbox.get_detail = null; sandbox.get_price = null;
    sandbox.get_indicator = null; sandbox.get_meta = null;
    sandbox.get_bars = null; sandbox.get_candle = null;
    sandbox.get_position = null; sandbox.get_cash = null;
    sandbox.get_market_session = null; sandbox.resolve_order_type = null;
    sandbox.stock = null; sandbox.curr_time = null;

    const wrapped = `(function() {\n"use strict";\n${code}\n})()`;
    try {
      const script = new vm.Script(wrapped, { filename: 'rule.js' });
      const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
      entry = { script, ctx, sandbox };
      ruleScriptCache.set(code, entry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { result: null, error: `Rule syntax error: ${msg}` };
    }
  }

  // Bind this call's DataContext into the cached sandbox before running
  entry.sandbox.get_data = (stock: string, feature: string, start: number, end: number) =>
    context.get_data(stock, feature, start, end);
  entry.sandbox.get_detail = (stock: string, feature: string) => context.get_detail(stock, feature);
  entry.sandbox.get_price = (stock: string) => context.get_price(stock);
  entry.sandbox.get_indicator = (stock: string, name: string, params?: Record<string, number>) =>
    context.get_indicator(stock, name, params);
  entry.sandbox.get_meta = (stock: string, key: string) => context.get_meta(stock, key);
  entry.sandbox.get_bars = (stock: string, interval: string, count: number) =>
    context.get_bars(stock, interval, count);
  entry.sandbox.get_candle = (stock: string, interval: string, offset?: number) =>
    context.get_candle(stock, interval, offset);
  entry.sandbox.get_position = (stock: string) => context.get_position(stock);
  entry.sandbox.get_cash = () => context.get_cash();
  entry.sandbox.get_market_session = () => context.get_market_session();
  entry.sandbox.resolve_order_type = (quantity: number) => context.resolve_order_type(quantity);
  entry.sandbox.stock = context.stock;
  entry.sandbox.curr_time = context.curr_time;

  try {
    const value = entry.script.runInContext(entry.ctx, {
      timeout: EXECUTION_TIMEOUT_MS,
      breakOnSigint: true,
    });
    return validateResult(value);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { result: null, error: `Rule execution failed: ${msg}` };
  }
}

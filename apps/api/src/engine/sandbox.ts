import vm from 'vm';
import type { Signal } from '@stock-notifier/shared';
import type { DataContext } from './data-context';

/** Successful, triggered result returned by a rule's code. */
export interface RuleCodeResult {
  signal: Signal;
  message: string;
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

  return { result: { signal: signal as Signal, message } };
}

/**
 * Evaluates a pool filter code body to decide if a symbol belongs in a dynamic pool.
 *
 * The body receives `stock` and `get_meta` and must return a boolean (truthy/falsy).
 * Example: `return get_meta(stock, 'sector') === 'Semiconductors';`
 */
export function runPoolFilter(
  filterCode: string,
  stock: string,
  getMeta: (key: string) => unknown,
): boolean {
  const forbidden = staticCheck(filterCode);
  if (forbidden) return false;

  const sandbox: Record<string, unknown> = Object.create(null);
  sandbox.stock = stock;
  sandbox.get_meta = (_s: string, key: string) => getMeta(key);
  sandbox.Math = Math;
  sandbox.String = String;
  sandbox.Boolean = Boolean;
  sandbox.Number = Number;

  const wrapped = `(function() {\n"use strict";\n${filterCode}\n})()`;

  try {
    const script = new vm.Script(wrapped, { filename: 'pool-filter.js' });
    const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    const value = script.runInContext(ctx, { timeout: 100, breakOnSigint: true });
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

  // Minimal, frozen global surface. No prototype chain to host objects.
  const sandbox: Record<string, unknown> = Object.create(null);
  sandbox.get_data = (stock: string, feature: string, start: number, end: number) =>
    context.get_data(stock, feature, start, end);
  sandbox.get_detail = (stock: string, feature: string) => context.get_detail(stock, feature);
  sandbox.get_price = (stock: string) => context.get_price(stock);
  sandbox.get_indicator = (stock: string, name: string, params?: Record<string, number>) =>
    context.get_indicator(stock, name, params);
  sandbox.get_meta = (stock: string, key: string) => context.get_meta(stock, key);
  sandbox.get_bars = (stock: string, interval: string, count: number) =>
    context.get_bars(stock, interval, count);
  sandbox.get_candle = (stock: string, interval: string, offset?: number) =>
    context.get_candle(stock, interval, offset);
  sandbox.stock = context.stock;
  sandbox.curr_time = context.curr_time;
  sandbox.Math = Math;
  sandbox.Number = Number;
  sandbox.JSON = JSON;
  sandbox.console = { log: () => {}, error: () => {}, warn: () => {} };

  const wrapped = `(function() {\n"use strict";\n${code}\n})()`;

  try {
    const script = new vm.Script(wrapped, { filename: 'rule.js' });
    const ctx = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    const value = script.runInContext(ctx, {
      timeout: EXECUTION_TIMEOUT_MS,
      breakOnSigint: true,
    });
    return validateResult(value);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { result: null, error: `Rule execution failed: ${msg}` };
  }
}

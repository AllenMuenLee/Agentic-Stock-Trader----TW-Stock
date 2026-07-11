import type { PrismaClient } from '@prisma/client';
import type { OHLCVBar } from '../types/rule';
import type { RedisService, Sample } from '../services/redis.service';
import * as indicators from './indicators';
import { getMarketSession, resolveOrderRouting, type MarketSessionInfo, type OrderRouting } from '@stock-notifier/shared';

export type { Sample } from '../services/redis.service';

// ─── CandleBar — the common OHLCV object exposed to rule code ─────────────────

export interface CandleBar {
  /** Bar open time as a Unix timestamp in seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Numeric tick features ────────────────────────────────────────────────────

const NUMERIC_FEATURES = [
  'price', 'volume', 'open', 'high', 'low', 'close',
  'change', 'changePercent', 'bid', 'ask', 'bidVolume', 'askVolume',
] as const;

type NumericFeature = (typeof NUMERIC_FEATURES)[number];

function isNumericFeature(feature: string): feature is NumericFeature {
  return (NUMERIC_FEATURES as readonly string[]).includes(feature);
}

// ─── DataContext interface ────────────────────────────────────────────────────

export interface DataContext {
  stock: string;
  curr_time: number;
  /**
   * Array of a tick-level feature's values over [startTime, endTime] (Unix seconds).
   * Good for raw tick streams. For proper K-line analysis use get_bars() instead.
   */
  get_data: (stock: string, feature: string, startTime: number, endTime: number) => number[];
  /** Latest value of a single tick feature, or undefined. */
  get_detail: (stock: string, feature: string) => number | undefined;
  /** Shorthand for the latest price. */
  get_price: (stock: string) => number | undefined;
  /**
   * A technical indicator computed over the stock's daily history.
   * Supported: 'sma'|'ema' {period}, 'rsi' {period=14},
   * 'bollinger_upper'|'bollinger_middle'|'bollinger_lower' {period=20,stdMult=2},
   * 'highest_high'|'lowest_low'|'avg_volume' {period}.
   */
  get_indicator: (stock: string, name: string, params?: Record<string, number>) => number | null;
  /** Non-market metadata: 'name', 'dayTradeable', 'sector'. */
  get_meta: (stock: string, key: string) => unknown;
  /**
   * Last `count` completed OHLCV bars at the given interval, oldest first.
   * Intervals: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w'
   *
   * Live: 1m bars are built from Redis ticks; longer intervals are aggregated.
   * Backtest: '1d'/'1w' use SQL daily bars; '5m'/'15m'/'30m'/'1h' use Yahoo Finance
   * intraday data (available for up to 60 days back). '1m' is available for ~7 days back.
   * Returns [] when data for that interval isn't loaded.
   *
   * Each bar: { time, open, high, low, close, volume }
   * Taiwan: 紅K (open < close), 綠K (open > close)
   */
  get_bars: (stock: string, interval: string, count: number) => CandleBar[];
  /**
   * A single bar by offset from the most recent completed bar.
   * offset=0 → latest completed bar, offset=1 → the one before, etc.
   */
  get_candle: (stock: string, interval: string, offset?: number) => CandleBar | undefined;
  /**
   * Currently held shares of `stock` in the user's real Fubon account (live) or
   * the backtest's own simulated position (backtest). 0 when none held or when
   * no account data has been reported yet.
   *
   * Live: sourced from the latest `AccountSnapshot` the trading-app pushed —
   * this context object itself is shared across every rule evaluated on a tick,
   * so the caller (index.ts) rebinds this per-rule to the evaluating rule's own
   * userId before running the sandbox; it is NOT baked in here.
   */
  get_position: (stock: string) => number;
  /**
   * Available cash. Live: the user's real Fubon account (`undefined` when no
   * account snapshot has been reported yet). Backtest: the backtest's own
   * simulated remaining 本金 (principal), which rises/falls with each simulated
   * BUY/SELL — mirrors how `get_position` reflects the simulated share count.
   */
  get_cash: () => number | undefined;
  /** Which Taiwan trading session is currently open (整股/零股 intraday, 盤後定價/零股, or closed). */
  get_market_session: () => MarketSessionInfo;
  /**
   * Resolves the exact order routing (market segment / price type / time-in-force /
   * limit price) a BUY/SELL signal for `quantity` shares should use right now.
   * Optional rule-code return fields `priceType`/`timeInForce`/`limitPrice` are only
   * honored when the resolved market segment allows a choice (盤中整股) — 零股/盤後定價
   * force their own non-negotiable combination regardless of what's passed in.
   * Call this and fold the result into your final `return { signal, quantity, ... }`
   * — or omit it entirely and the server derives the same routing automatically.
   */
  resolve_order_type: (quantity: number) => OrderRouting;
}

// ─── Low-level helpers ────────────────────────────────────────────────────────

function barsToSamples(bars: OHLCVBar[]): Sample[] {
  return bars.map((bar, i) => {
    const prevClose = i > 0 ? bars[i - 1].close : bar.open || bar.close;
    const change = bar.close - prevClose;
    const changePercent = prevClose ? (change / prevClose) * 100 : 0;
    return {
      t: Math.floor(bar.date.getTime() / 1000),
      price: bar.close,
      volume: bar.volume,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      change,
      changePercent,
      bid: bar.close,
      ask: bar.close,
      bidVolume: 0,
      askVolume: 0,
    };
  });
}

function rangeValues(
  samples: Sample[],
  feature: string,
  startTime: number,
  endTime: number,
): number[] {
  if (!isNumericFeature(feature)) return [];
  const lo = Math.min(startTime, endTime);
  const hi = Math.max(startTime, endTime);
  const out: number[] = [];
  for (const s of samples) {
    if (s.t >= lo && s.t <= hi) out.push(s[feature]);
  }
  return out;
}

function latestValue(samples: Sample[], feature: string): number | undefined {
  if (!isNumericFeature(feature) || samples.length === 0) return undefined;
  return samples[samples.length - 1][feature];
}

function computeIndicator(
  bars: OHLCVBar[],
  name: string,
  params: Record<string, number> = {},
): number | null {
  switch (name) {
    case 'sma': return indicators.sma(bars, params.period ?? 20);
    case 'ema': return indicators.ema(bars, params.period ?? 20);
    case 'rsi': return indicators.rsi(bars, params.period ?? 14);
    case 'bollinger_upper':
      return indicators.bollingerBands(bars, params.period ?? 20, params.stdMult ?? 2)?.upper ?? null;
    case 'bollinger_middle':
      return indicators.bollingerBands(bars, params.period ?? 20, params.stdMult ?? 2)?.middle ?? null;
    case 'bollinger_lower':
      return indicators.bollingerBands(bars, params.period ?? 20, params.stdMult ?? 2)?.lower ?? null;
    case 'highest_high': return indicators.nDayHigh(bars, params.period ?? 20);
    case 'lowest_low': return indicators.nDayLow(bars, params.period ?? 20);
    case 'avg_volume': return indicators.avgVolume(bars, params.period ?? 20);
    default: return null;
  }
}

// ─── Bar builders ─────────────────────────────────────────────────────────────

export function ohlcvToCandleBars(bars: OHLCVBar[]): CandleBar[] {
  return bars.map((b) => ({
    time: Math.floor(b.date.getTime() / 1000),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

/** Aggregate tick samples into completed 1-minute OHLCV bars. */
export function ticksToMinuteBars(samples: Sample[], currTimeSec: number): CandleBar[] {
  const currentMinuteStart = Math.floor(currTimeSec / 60) * 60;
  const byMinute = new Map<number, Sample[]>();
  for (const s of samples) {
    const ms = Math.floor(s.t / 60) * 60;
    if (ms >= currentMinuteStart) continue; // skip the forming bar
    if (!byMinute.has(ms)) byMinute.set(ms, []);
    byMinute.get(ms)!.push(s);
  }
  return [...byMinute.entries()]
    .sort(([a], [b]) => a - b)
    .map(([minuteStart, ticks]) => ({
      time: minuteStart,
      open: ticks[0].price,
      high: Math.max(...ticks.map((t) => t.price)),
      low: Math.min(...ticks.map((t) => t.price)),
      close: ticks[ticks.length - 1].price,
      volume: ticks.reduce((s, t) => s + (t.volume ?? 0), 0),
    }));
}

/** Aggregate 1-minute bars into N-minute bars (5m, 15m, 30m, 60m…). */
export function aggregateToBars(minuteBars: CandleBar[], intervalMinutes: number): CandleBar[] {
  if (minuteBars.length === 0) return [];
  const intervalSec = intervalMinutes * 60;
  const byPeriod = new Map<number, CandleBar[]>();
  for (const bar of minuteBars) {
    const ps = Math.floor(bar.time / intervalSec) * intervalSec;
    if (!byPeriod.has(ps)) byPeriod.set(ps, []);
    byPeriod.get(ps)!.push(bar);
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => a - b)
    .map(([periodStart, bars]) => ({
      time: periodStart,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
    }));
}

/** Aggregate daily CandleBars into weekly bars (week starts Monday). */
function dailyToWeeklyBars(dailyBars: CandleBar[]): CandleBar[] {
  const byWeek = new Map<number, CandleBar[]>();
  for (const bar of dailyBars) {
    const d = new Date(bar.time * 1000);
    const day = d.getUTCDay(); // 0=Sun
    const daysToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setUTCDate(mon.getUTCDate() + daysToMon);
    mon.setUTCHours(0, 0, 0, 0);
    const ws = Math.floor(mon.getTime() / 1000);
    if (!byWeek.has(ws)) byWeek.set(ws, []);
    byWeek.get(ws)!.push(bar);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekStart, bars]) => ({
      time: weekStart,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
    }));
}

// ─── Context builders ─────────────────────────────────────────────────────────

function mergeSamples(history: Sample[], hot: Sample[]): Sample[] {
  if (history.length === 0) return hot;
  if (hot.length === 0) return history;
  const earliestHot = hot[0].t;
  return [...history.filter((s) => s.t < earliestHot), ...hot];
}

function rowsToBars(
  rows: {
    symbol: string;
    date: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[],
): OHLCVBar[] {
  return rows.map((r) => ({
    symbol: r.symbol,
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

/**
 * Loads a live data context. Hot/recent ticks + metadata come from Redis;
 * longer-range daily history comes from SQL StockPrice. No external API is
 * touched here. 1m bars are built from Redis ticks; 3m–1h by aggregation;
 * 1d/1w from SQL daily bars.
 */
export async function loadDataContext(opts: {
  redis: RedisService;
  prisma: PrismaClient;
  symbols: string[];
  primarySymbol: string;
  currTimeSec: number;
  recentWindowSec?: number;
  historyDays?: number;
}): Promise<DataContext> {
  const {
    redis, prisma, symbols, primarySymbol, currTimeSec,
    recentWindowSec = 60 * 60,
    historyDays = 60,
  } = opts;

  const uniqueSymbols = Array.from(new Set(symbols.length ? symbols : [primarySymbol]));
  const historySince = new Date((currTimeSec - historyDays * 86400) * 1000);

  const samplesBySymbol = new Map<string, Sample[]>();
  const dailyBarsBySymbol = new Map<string, OHLCVBar[]>();
  const metaBySymbol = new Map<string, Record<string, unknown>>();
  const barsByIntervalBySymbol = new Map<string, Map<string, CandleBar[]>>();

  await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      const [hot, historyRows, meta] = await Promise.all([
        redis.getRange(symbol, currTimeSec - recentWindowSec, currTimeSec),
        prisma.stockPrice.findMany({
          where: { symbol, date: { gte: historySince } },
          orderBy: { date: 'asc' },
        }),
        redis.getMeta(symbol),
      ]);

      const sqlBars = rowsToBars(historyRows);
      dailyBarsBySymbol.set(symbol, sqlBars);
      samplesBySymbol.set(symbol, mergeSamples(barsToSamples(sqlBars), hot));
      metaBySymbol.set(symbol, meta);

      const minuteBars = ticksToMinuteBars(hot, currTimeSec);
      const dailyCandles = ohlcvToCandleBars(sqlBars);

      barsByIntervalBySymbol.set(symbol, new Map([
        ['1m',  minuteBars],
        ['3m',  aggregateToBars(minuteBars, 3)],
        ['5m',  aggregateToBars(minuteBars, 5)],
        ['15m', aggregateToBars(minuteBars, 15)],
        ['30m', aggregateToBars(minuteBars, 30)],
        ['1h',  aggregateToBars(minuteBars, 60)],
        ['1d',  dailyCandles],
        ['1w',  dailyToWeeklyBars(dailyCandles)],
      ]));
    }),
  );

  const samplesOf = (s: string) => samplesBySymbol.get(s) ?? [];
  const barsOf    = (s: string) => barsByIntervalBySymbol.get(s) ?? new Map<string, CandleBar[]>();

  return {
    stock: primarySymbol,
    curr_time: currTimeSec,
    get_data:      (s, f, t0, t1) => rangeValues(samplesOf(s), f, t0, t1),
    get_detail:    (s, f)         => latestValue(samplesOf(s), f),
    get_price:     (s)            => latestValue(samplesOf(s), 'price'),
    get_indicator: (s, name, p)   => computeIndicator(dailyBarsBySymbol.get(s) ?? [], name, p),
    get_meta:      (s, key)       => metaBySymbol.get(s)?.[key],
    get_bars: (s, interval, count) => {
      const b = barsOf(s).get(interval) ?? [];
      return b.slice(-Math.max(0, count));
    },
    get_candle: (s, interval, offset = 0) => {
      const b = barsOf(s).get(interval) ?? [];
      const idx = b.length - 1 - offset;
      return idx >= 0 ? b[idx] : undefined;
    },
    // Placeholders — this context is shared across every rule evaluated on a
    // tick regardless of owning user, so the real per-user values are bound by
    // the caller (index.ts's per-rule loop) right before evaluation.
    get_position: () => 0,
    get_cash: () => undefined,
    get_market_session: () => getMarketSession(currTimeSec),
    resolve_order_type: (quantity) => resolveOrderRouting(quantity, currTimeSec, latestValue(samplesOf(primarySymbol), 'price')),
  };
}

/**
 * For daily-bar contexts (`buildBarContext`), there's no real intraday timestamp —
 * each bar just marks a calendar day. Synthesizes a representative instant inside
 * the regular 整股 session (09:01 Taipei) on that day so session-aware helpers
 * (`get_market_session`/`resolve_order_type`) return sensible results instead of
 * always reading as "market closed" against a literal midnight bar timestamp.
 */
function taipeiTradingInstant(date: Date): number {
  const taipeiDateStr = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  return Math.floor(new Date(`${taipeiDateStr}T09:01:00+08:00`).getTime() / 1000);
}

// Intraday intervals in preference order (finest first) for get_data sample selection
const INTRADAY_PRIORITY = ['1m', '5m', '15m', '30m', '1h'] as const;

/**
 * Builds a backtest context for intraday-bar iteration.
 *
 * Called once per intraday bar when runBacktest iterates over 1m/5m/15m/30m/1h bars.
 * - Indicators use daily bars up to (and including) the current bar's date.
 * - get_bars / get_candle filter each interval to bars whose open time ≤ currentTimeSec.
 * - get_data / get_detail use the finest available intraday series (or daily if none).
 */
export function buildIntradayBarContext(
  symbol: string,
  allDailyBars: OHLCVBar[],
  intradayBars: Map<string, CandleBar[]>,
  currentTimeSec: number,
  currentShares = 0,
  currentCash?: number,
): DataContext {
  // Daily bars whose date falls on or before the current bar's calendar day
  const cutoffMs = new Date(currentTimeSec * 1000);
  cutoffMs.setHours(23, 59, 59, 999);
  const dailySlice = allDailyBars.filter((b) => b.date <= cutoffMs);
  const dailyCandles = ohlcvToCandleBars(dailySlice);

  // Precompute previous-trading-day close for each date so intraday bars
  // can report an accurate daily changePercent (gain from prev day close).
  // Key = YYYY-MM-DD (Asia/Taipei), value = previous bar's close (or open of
  // the first bar when there's no prior day in the loaded range).
  const prevCloseByDate = new Map<string, number>();
  for (let i = 0; i < allDailyBars.length; i++) {
    const dateKey = allDailyBars[i].date.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    prevCloseByDate.set(dateKey, i > 0 ? allDailyBars[i - 1].close : allDailyBars[i].open);
  }

  // Binary search: find the last index in `bars` with time ≤ cutoff.
  // O(log N) instead of O(N) filter — critical for large 1m bar arrays.
  const bisectRight = (bars: CandleBar[], cutoff: number): number => {
    let lo = 0, hi = bars.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].time <= cutoff) { idx = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return idx;
  };

  const filteredBarsOf = (interval: string): CandleBar[] => {
    if (interval === '1d') return dailyCandles;
    if (interval === '1w') return dailyToWeeklyBars(dailyCandles);
    const all = intradayBars.get(interval) ?? [];
    const cutoffIdx = bisectRight(all, currentTimeSec);
    return cutoffIdx >= 0 ? all.slice(0, cutoffIdx + 1) : [];
  };

  // Build a single-element sample for the CURRENT bar only (O(log N) binary search).
  // get_detail/get_data only need the latest value — returning the full historical
  // array (O(N) per call × N iterations = O(N²)) killed backtest performance.
  // get_bars/get_candle use filteredBarsOf() directly and are not affected.
  const buildSamples = (): Sample[] => {
    for (const iv of INTRADAY_PRIORITY) {
      const allBars = intradayBars.get(iv) ?? [];
      if (!allBars.length) continue;
      // Binary search: find the rightmost bar whose time ≤ currentTimeSec
      let lo = 0, hi = allBars.length - 1, idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (allBars[mid].time <= currentTimeSec) { idx = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (idx < 0) continue;
      const b = allBars[idx];
      const dateKey = new Date(b.time * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
      const prevClose = prevCloseByDate.get(dateKey) ?? b.open;
      const change = b.close - prevClose;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
      return [{
        t: b.time, price: b.close, volume: b.volume, open: b.open,
        high: b.high, low: b.low, close: b.close, change, changePercent,
        bid: b.close, ask: b.close, bidVolume: 0, askVolume: 0,
      }];
    }
    const last = barsToSamples(dailySlice).pop();
    return last ? [last] : [];
  };

  const samples = buildSamples();
  const samplesFor = (s: string) => (s === symbol ? samples : []);

  return {
    stock: symbol,
    curr_time: currentTimeSec,
    get_data:      (s, f, t0, t1) => rangeValues(samplesFor(s), f, t0, t1),
    get_detail:    (s, f)         => latestValue(samplesFor(s), f),
    get_price:     (s)            => latestValue(samplesFor(s), 'price'),
    get_indicator: (s, name, p)   => computeIndicator(s === symbol ? dailySlice : [], name, p),
    get_meta:      ()             => undefined,
    get_bars: (s, interval, count) => {
      if (s !== symbol) return [];
      if (interval === '1d') return dailyCandles.slice(-Math.max(0, count));
      if (interval === '1w') return dailyToWeeklyBars(dailyCandles).slice(-Math.max(0, count));
      const all = intradayBars.get(interval) ?? [];
      const cutoffIdx = bisectRight(all, currentTimeSec);
      if (cutoffIdx < 0) return [];
      const startIdx = Math.max(0, cutoffIdx + 1 - Math.max(0, count));
      return all.slice(startIdx, cutoffIdx + 1);
    },
    get_candle: (s, interval, offset = 0) => {
      if (s !== symbol) return undefined;
      if (interval === '1d') { const b = dailyCandles; return b[b.length - 1 - offset]; }
      if (interval === '1w') { const w = dailyToWeeklyBars(dailyCandles); return w[w.length - 1 - offset]; }
      const all = intradayBars.get(interval) ?? [];
      const cutoffIdx = bisectRight(all, currentTimeSec);
      const idx = cutoffIdx - offset;
      return idx >= 0 ? all[idx] : undefined;
    },
    // No real account in backtest — get_position/get_cash mirror the backtest's
    // own simulated running position/本金 (both tracked by the caller, runBacktest).
    get_position: (s) => (s === symbol ? currentShares : 0),
    get_cash: () => currentCash,
    get_market_session: () => getMarketSession(currentTimeSec),
    resolve_order_type: (quantity) => resolveOrderRouting(quantity, currentTimeSec, latestValue(samples, 'price')),
  };
}

/**
 * Builds a backtest context from historical daily bars up to `uptoIndex`.
 *
 * get_bars / get_candle behaviour:
 *   '1d' / '1w'  → derived from the daily SQL bars (always available)
 *   '5m' / '15m' / '30m' / '1h' / '1m' → from `intradayBars`, filtered to
 *   bars whose open time falls before the end of the current backtest day.
 *   Returns [] when intradayBars is not supplied or the interval is absent.
 */
export function buildBarContext(
  symbol: string,
  bars: OHLCVBar[],
  uptoIndex: number,
  intradayBars?: Map<string, CandleBar[]>,
  currentShares = 0,
  currentCash?: number,
): DataContext {
  const slice = bars.slice(0, uptoIndex + 1);
  const samples = barsToSamples(slice);
  const currBar = slice[slice.length - 1];
  const currTimeSec = currBar
    ? taipeiTradingInstant(currBar.date)
    : Math.floor(Date.now() / 1000);
  // Include bars that opened before midnight of the *next* day
  const currDayEndSec = currTimeSec + 86400;

  const dailyCandles  = ohlcvToCandleBars(slice);
  const weeklyCandles = dailyToWeeklyBars(dailyCandles);

  const samplesFor = (s: string) => (s === symbol ? samples : []);

  const allBarsFor = (interval: string): CandleBar[] => {
    if (interval === '1d') return dailyCandles;
    if (interval === '1w') return weeklyCandles;
    if (!intradayBars) return [];
    const all = intradayBars.get(interval) ?? [];
    return all.filter((b) => b.time < currDayEndSec);
  };

  return {
    stock: symbol,
    curr_time: currTimeSec,
    get_data:      (s, f, t0, t1) => rangeValues(samplesFor(s), f, t0, t1),
    get_detail:    (s, f)         => latestValue(samplesFor(s), f),
    get_price:     (s)            => latestValue(samplesFor(s), 'price'),
    get_indicator: (s, name, p)   => computeIndicator(s === symbol ? slice : [], name, p),
    get_meta:      ()             => undefined,
    get_bars: (s, interval, count) => {
      if (s !== symbol) return [];
      return allBarsFor(interval).slice(-Math.max(0, count));
    },
    get_candle: (s, interval, offset = 0) => {
      if (s !== symbol) return undefined;
      const b = allBarsFor(interval);
      const idx = b.length - 1 - offset;
      return idx >= 0 ? b[idx] : undefined;
    },
    get_position: (s) => (s === symbol ? currentShares : 0),
    get_cash: () => currentCash,
    get_market_session: () => getMarketSession(currTimeSec),
    resolve_order_type: (quantity) => resolveOrderRouting(quantity, currTimeSec, latestValue(samples, 'price')),
  };
}

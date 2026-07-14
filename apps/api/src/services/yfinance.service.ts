import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import type { OHLCVBar } from '../types/rule.js';
import type { CandleBar, DataContext } from '../engine/data-context.js';
import { resolveOrderRouting, type OrderRouting } from '@stock-notifier/shared';

const prisma = new PrismaClient();

const YF_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Only 1m bars are persisted to SQL. Daily bars are aggregated from 1m on demand. */
const INTRADAY_INTERVALS: ReadonlyArray<{ interval: string; maxDays: number }> = [
  { interval: '1m', maxDays: 7 },
];

interface YFChartResult {
  chart: {
    result: {
      timestamp: number[];
      indicators: {
        quote: {
          open: number[];
          high: number[];
          low: number[];
          close: number[];
          volume: number[];
        }[];
      };
    }[];
    error: null | { code: string; description: string };
  };
}

interface YFQuoteResult {
  quoteResponse: {
    result: {
      regularMarketPrice: number;
      longName?: string;
      shortName?: string;
      symbol: string;
    }[];
    error: null | { code: string; description: string };
  };
}

export class YFinanceService {
  /**
   * Per symbol:interval queue so overlapping seed calls (startup loop,
   * SubscriptionManager's fire-and-forget seeding, refreshAllBars) can't
   * interleave their delete+insert in fetchAndCacheIntradayToSQL and trip
   * the (symbol, date, interval) unique constraint.
   */
  private inFlightFetches: Map<string, Promise<void>> = new Map();

  // ─── Public accessors ────────────────────────────────────────────────────────

  /**
   * Returns daily OHLCV bars for `symbol` by aggregating 1h SQL bars (coarsest available).
   * Falls back to fetching 1h from Yahoo Finance if SQL is empty.
   * Daily bars are synthesised: open=first bar, high=max, low=min, close=last, volume=sum.
   */
  async getHistoricalBars(symbol: string, days = 30): Promise<OHLCVBar[]> {
    const since = new Date(Date.now() - days * 86400000);
    // Use coarsest available interval for max historical coverage
    for (const { interval } of [...INTRADAY_INTERVALS].reverse()) {
      const rows = await prisma.stockPrice.findMany({
        where: { symbol, interval, date: { gte: since } },
        orderBy: { date: 'asc' },
      });
      if (rows.length >= 5) return aggregateIntradayToDaily(symbol, rows.map(rowToCandleBar));
    }
    // Nothing in SQL — fetch 1m (up to 7 days) and aggregate
    await this.fetchAndCacheIntradayToSQL(symbol, '1m', 7);
    const rows = await prisma.stockPrice.findMany({
      where: { symbol, interval: '1m', date: { gte: since } },
      orderBy: { date: 'asc' },
    });
    return aggregateIntradayToDaily(symbol, rows.map(rowToCandleBar));
  }

  /** Derives daily bars in [startDate, endDate] from the finest available intraday SQL data. */
  async getSqlBarsByRange(symbol: string, startDate: Date, endDate: Date): Promise<OHLCVBar[]> {
    const end = toEndOfDay(endDate);
    for (const { interval } of [...INTRADAY_INTERVALS].reverse()) {
      const rows = await prisma.stockPrice.findMany({
        where: { symbol, interval, date: { gte: startDate, lte: end } },
        orderBy: { date: 'asc' },
      });
      if (rows.length >= 5) return aggregateIntradayToDaily(symbol, rows.map(rowToCandleBar));
    }
    return [];
  }

  /** Returns the date range available for backtesting, based on intraday SQL data (1h preferred). */
  async getAvailableDateRange(symbol: string): Promise<{ minDate: string; maxDate: string } | null> {
    for (const { interval } of [...INTRADAY_INTERVALS].reverse()) {
      const agg = await prisma.stockPrice.aggregate({
        where: { symbol, interval },
        _min: { date: true },
        _max: { date: true },
      });
      if (agg._min.date && agg._max.date) {
        return {
          minDate: toTaiwanDate(agg._min.date),
          maxDate: toTaiwanDate(agg._max.date),
        };
      }
    }
    return null;
  }

  /**
   * Returns the union date range across a list of symbols — a single aggregate query
   * instead of one per symbol. Used by the available-dates endpoint so it stays fast
   * even when the pool contains thousands of symbols.
   */
  async getAvailableDateRangeForSymbols(symbols: string[]): Promise<{ minDate: string; maxDate: string } | null> {
    if (!symbols.length) return null;
    for (const { interval } of [...INTRADAY_INTERVALS].reverse()) {
      const agg = await prisma.stockPrice.aggregate({
        where: { symbol: { in: symbols }, interval },
        _min: { date: true },
        _max: { date: true },
      });
      if (agg._min.date && agg._max.date) {
        return {
          minDate: toTaiwanDate(agg._min.date),
          maxDate: toTaiwanDate(agg._max.date),
        };
      }
    }
    return null;
  }

  /** Returns all intraday SQL bars for a symbol in the date range, keyed by interval. */
  async getAllIntradayBarsFromSQL(
    symbol: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Map<string, CandleBar[]>> {
    const end = toEndOfDay(endDate);
    const rows = await prisma.stockPrice.findMany({
      where: { symbol, interval: { not: '1d' }, date: { gte: startDate, lte: end } },
      orderBy: { date: 'asc' },
    });
    const result = new Map<string, CandleBar[]>();
    for (const row of rows) {
      const list = result.get(row.interval) ?? [];
      list.push({
        time: Math.floor(row.date.getTime() / 1000),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      });
      result.set(row.interval, list);
    }
    return result;
  }

  /**
   * Seeds historical bars for a symbol, per interval. Skips any interval that
   * already has data within the fetch window so restarts and duplicate calls
   * are cheap. Call this from startup, SubscriptionManager, and on-demand
   * backtest seeding — it is safe to call multiple times.
   */
  async seedAllIntervals(symbol: string): Promise<void> {
    for (const { interval, maxDays } of INTRADAY_INTERVALS) {
      const since = new Date(Date.now() - maxDays * 86400000);
      const existing = await prisma.stockPrice.count({
        where: { symbol, interval, date: { gte: since } },
      });
      if (existing > 0) {
        console.log(`[YFinance] ${symbol} ${interval}: ${existing} bars already cached — skip`);
        continue;
      }
      await this.fetchAndCacheIntradayToSQL(symbol, interval, maxDays);
    }
    // Register in SymbolMeta (don't overwrite richer data written at startup)
    await prisma.symbolMeta.upsert({
      where: { symbol },
      create: { symbol, data: '{}' },
      update: {},
    });
  }

  /**
   * Fetches every symbol listed on TWSE (上市) and TPEx (上櫃) from their public APIs.
   * On non-trading days STOCK_DAY_ALL may return an empty array — callers must handle that.
   */
  async fetchTaiwanStockList(): Promise<string[]> {
    const symbols = new Set<string>();

    // TWSE listed stocks
    try {
      const { data } = await axios.get<Array<Record<string, string>>>(
        'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
        { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } },
      );
      if (Array.isArray(data)) {
        for (const s of data) {
          const code = s.Code ?? '';
          if (/^\d{4,6}$/.test(code)) symbols.add(code);
        }
      }
    } catch (err) {
      console.warn('[TW] TWSE API unavailable:', err instanceof Error ? err.message : err);
    }

    // TPEx OTC stocks
    try {
      const { data } = await axios.get<Array<Record<string, string>>>(
        'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes',
        { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } },
      );
      if (Array.isArray(data)) {
        for (const s of data) {
          const code = s.SecuritiesCompanyCode ?? s.CompanyCode ?? s.Code ?? '';
          if (/^\d{4,6}$/.test(code)) symbols.add(code);
        }
      }
    } catch (err) {
      console.warn('[TW] TPEx API unavailable:', err instanceof Error ? err.message : err);
    }

    const list = [...symbols];
    console.log(`[TW] Stock list fetched: ${list.length} symbols (TWSE + TPEx)`);
    return list;
  }

  /**
   * Seeds 100 days of daily bars for every Taiwan stock from TWSE/TPEx public APIs.
   * Skips symbols that already have bars from the last 7 days so re-runs are fast.
   * Call non-blocking at startup — this can take 15–30 minutes on first run.
   */
  async seedAllTaiwanDailyBars(): Promise<void> {
    const allSymbols = await this.fetchTaiwanStockList();
    if (!allSymbols.length) {
      console.log('[TW Seed] No symbols returned (market may be closed today — will retry next restart)');
      return;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    let seeded = 0, skipped = 0, notFound = 0, failed = 0;
    console.log(`[TW Seed] Seeding 1m bars (7d) for ${allSymbols.length} Taiwan stocks...`);

    for (const symbol of allSymbols) {
      try {
        const recent = await prisma.stockPrice.count({
          where: { symbol, interval: '1m', date: { gte: sevenDaysAgo } },
        });
        if (recent > 0) { skipped++; continue; }

        await this.fetchAndCacheIntradayToSQL(symbol, '1m', 7);

        const saved = await prisma.stockPrice.count({
          where: { symbol, interval: '1m', date: { gte: sevenDaysAgo } },
        });
        if (saved > 0) {
          seeded++;
          if (seeded % 100 === 0) {
            console.log(`[TW Seed] Progress: ${seeded} seeded, ${skipped} skipped, ${notFound} not on YF, ${failed} errors — of ${allSymbols.length} total`);
          }
        } else {
          notFound++; // 404 or empty — bond, warrant, preferred share, etc.
        }
      } catch {
        failed++;
      }
      // Brief pause to avoid Yahoo Finance rate limiting (~100ms keeps us ~600 req/min)
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`[TW Seed] Done — seeded: ${seeded}, skipped (cached): ${skipped}, not on YF: ${notFound}, errors: ${failed}`);
  }

  /**
   * Daily refresh: re-fetches the last 3 days for every symbol + interval,
   * then purges bars older than 100 days.
   * Sequential writes keep SQLite contention-free.
   */
  async refreshAllBars(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      for (const { interval } of INTRADAY_INTERVALS) {
        await this.fetchAndCacheIntradayToSQL(symbol, interval, 3);
      }
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 100);
    await prisma.stockPrice.deleteMany({ where: { date: { lt: cutoff } } });
    console.log(
      `[YFinance] Daily refresh done for ${symbols.length} symbols; purged before ${cutoff.toISOString().slice(0, 10)}`,
    );
  }

  async getQuote(symbol: string): Promise<{ price: number; name: string } | null> {
    const yfSymbol = toYFSymbol(symbol);
    try {
      const { data } = await axios.get<YFQuoteResult>(
        'https://query1.finance.yahoo.com/v7/finance/quote',
        {
          params: { symbols: yfSymbol },
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000,
        },
      );
      const r = data.quoteResponse?.result?.[0];
      if (!r) return null;
      return { price: r.regularMarketPrice, name: r.longName ?? r.shortName ?? symbol };
    } catch {
      return null;
    }
  }

  /**
   * Fetches intraday OHLCV bars from Yahoo Finance (does NOT persist to SQL).
   * Used internally and by live-context loading in data-context.ts.
   */
  async getIntradayBars(symbol: string, interval: string, days: number): Promise<CandleBar[]> {
    const yfSymbol = toYFSymbol(symbol);
    const yfInterval = interval === '1h' ? '60m' : interval;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      const { data } = await axios.get<YFChartResult>(
        `${YF_CHART_URL}/${encodeURIComponent(yfSymbol)}`,
        {
          params: {
            period1: Math.floor(startDate.getTime() / 1000),
            period2: Math.floor(endDate.getTime() / 1000),
            interval: yfInterval,
            events: '',
          },
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 20000,
        },
      );
      if (data.chart.error || !data.chart.result?.length) return [];

      const result = data.chart.result[0];
      const { timestamp, indicators } = result;
      const quote = indicators.quote[0];

      return timestamp
        .map((ts, i) => ({
          time: ts,
          open: quote.open[i] ?? 0,
          high: quote.high[i] ?? 0,
          low: quote.low[i] ?? 0,
          close: quote.close[i] ?? 0,
          volume: quote.volume[i] ?? 0,
        }))
        .filter((b) => b.close > 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('status code 404')) {
        console.warn(`[YFinance] Intraday fetch failed (${symbol} ${interval} ${days}d): ${msg}`);
      }
      return [];
    }
  }

  /**
   * Loads backtest data for all symbols in one bulk SQL query, then partitions
   * the results in memory. Avoids N×2 sequential queries (old: 400 for 200 symbols).
   */
  async getBacktestDataBulk(
    symbols: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<Map<string, { dailyBars: OHLCVBar[]; intradayBars: Map<string, CandleBar[]> }>> {
    if (!symbols.length) return new Map();
    const end = toEndOfDay(endDate);

    const rows = await prisma.stockPrice.findMany({
      where: { symbol: { in: symbols }, date: { gte: startDate, lte: end } },
      orderBy: [{ symbol: 'asc' }, { interval: 'asc' }, { date: 'asc' }],
    });

    const result = new Map<string, { dailyBars: OHLCVBar[]; intradayBars: Map<string, CandleBar[]> }>();

    for (const row of rows) {
      if (!result.has(row.symbol)) {
        result.set(row.symbol, { dailyBars: [], intradayBars: new Map() });
      }
      const entry = result.get(row.symbol)!;
      if (row.interval !== '1d') {
        const bar: CandleBar = {
          time: Math.floor(row.date.getTime() / 1000),
          open: row.open, high: row.high, low: row.low,
          close: row.close, volume: row.volume,
        };
        const list = entry.intradayBars.get(row.interval) ?? [];
        list.push(bar);
        entry.intradayBars.set(row.interval, list);
      }
    }

    // Derive daily bars from finest intraday data for each symbol
    for (const [symbol, entry] of result) {
      for (const { interval } of [...INTRADAY_INTERVALS].reverse()) {
        const bars = entry.intradayBars.get(interval);
        if (bars && bars.length >= 5) {
          entry.dailyBars = aggregateIntradayToDaily(symbol, bars);
          break;
        }
      }
    }

    return result;
  }

  async runBacktest(
    config: import('../types/rule.js').RuleConfig,
    symbols: string[],
    options: number | { startDate: Date; endDate: Date } = 30,
    /**
     * Starting capital (本金, NT$) — applied independently to EACH symbol (symbols
     * are simulated on separate timelines, not a shared interleaved pool), mirroring
     * how `totalInvested` already accumulates per-symbol cost below. A BUY that would
     * cost more than the currently-available cash, or a SELL for more shares than are
     * currently held, is simply not executed (quantity comes back `null` in `signals`)
     * rather than being clamped/faked — same "don't exceed what you have" rule the
     * live trading-app enforces against the real account.
     */
    principal = 1_000_000,
  ): Promise<import('@stock-notifier/shared').BacktestResult> {
    const { RuleEngine } = await import('../engine/rule-engine.js');
    const {
      buildBarContext,
      buildIntradayBarContext,
      ohlcvToCandleBars,
    } = await import('../engine/data-context.js');
    const engine = new RuleEngine();

    const endDate = typeof options === 'number' ? new Date() : (() => {
      const d = new Date(options.endDate);
      d.setUTCHours(23, 59, 59, 999);
      return d;
    })();
    const startDate =
      typeof options === 'number'
        ? new Date(endDate.getTime() - options * 86400000)
        : new Date(options.startDate);

    // ── Single bulk query for all symbols — avoids N×2 sequential DB round-trips
    console.log(`[Backtest] Loading data for ${symbols.length} symbols...`);
    const bulkData = await this.getBacktestDataBulk(symbols, startDate, endDate);
    console.log(`[Backtest] Loaded ${bulkData.size} symbols with data`);

    // Fallback order size (shares) for BUY/SELL signals whose rule code doesn't
    // specify a quantity — mirrors DEFAULT_TRADE_QUANTITY in apps/api/src/index.ts.
    const FALLBACK_QUANTITY = 1000; // 1 張

    // Standard Taiwan stock trading costs — applied to both realized sells and
    // the hypothetical "close it now" mark-to-market of unrealized positions,
    // so returns reflect what you'd actually net, not a frictionless gross price move.
    const COMMISSION_RATE = 0.001425; // 券商手續費，買賣雙邊各收一次（未計入折讓）
    const TRANSACTION_TAX_RATE = 0.003; // 證券交易稅，僅賣出收取
    const MIN_COMMISSION = 20; // 券商手續費最低收取金額（新台幣），對小額/零股交易影響較大
    const commissionFor = (gross: number): number => Math.max(gross * COMMISSION_RATE, MIN_COMMISSION);

    let totalSignals = 0;
    let totalInvested = 0;
    let realizedPnL = 0;
    let unrealizedPnL = 0;
    let openPositionCost = 0;
    const signals: import('@stock-notifier/shared').BacktestResult['signals'] = [];
    const loggedErrors = new Set<string>();

    for (const symbol of symbols) {
      const data = bulkData.get(symbol);
      if (!data || data.dailyBars.length < 5) continue;

      const { dailyBars, intradayBars: intradaySQLBars } = data;

      // ── Choose primary series: finest interval with enough bars ──────────────
      const best = INTRADAY_INTERVALS.find(
        ({ interval }) => (intradaySQLBars.get(interval)?.length ?? 0) >= 10,
      );
      const primaryInterval = best?.interval ?? '1d';
      const primaryBars: CandleBar[] = best
        ? (intradaySQLBars.get(best.interval) ?? [])
        : ohlcvToCandleBars(dailyBars);

      const startIdx = 10;
      if (primaryBars.length <= startIdx) continue;

      // Simulated position for this symbol, carried across bars — a rule never
      // specifies when to exit, so instead of scoring each signal against the
      // very next bar, we actually hold shares from BUY through to a matching
      // SELL and mark whatever's left at the end of the window to the last
      // close as unrealized. Starts from the user-provided 本金 (principal) —
      // a BUY that would cost more than `cash`, or a SELL for more than
      // `shares`, is skipped entirely rather than clamped (see runBacktest's
      // `principal` doc comment).
      let shares = 0;
      let costBasis = 0;
      let cash = principal;

      // ── Evaluate rule on each bar ─────────────────────────────────────────────
      for (let i = startIdx; i < primaryBars.length; i++) {
        const currentBar = primaryBars[i];
        const tick = {
          symbol,
          price: currentBar.close,
          volume: currentBar.volume,
          timestamp: new Date(currentBar.time * 1000),
          open: currentBar.open,
          high: currentBar.high,
          low: currentBar.low,
          close: currentBar.close,
        };

        const dataContext =
          primaryInterval === '1d'
            ? buildBarContext(symbol, dailyBars, i, intradaySQLBars, shares, cash)
            : buildIntradayBarContext(symbol, dailyBars, intradaySQLBars, currentBar.time, shares, cash);

        const result = engine.evaluate(config, tick, dailyBars, dataContext);

        if (result.error) {
          const key = `${symbol}:${result.error}`;
          if (!loggedErrors.has(key)) {
            loggedErrors.add(key);
            console.error(`[Backtest] Rule code failed on ${symbol}: ${result.error}`);
          }
          continue;
        }

        if (!result.triggered) continue;

        const signal = result.signal ?? config.signal;
        totalSignals++;

        let quantity: number | null = null;
        // Only set when a trade actually executes this bar — carries the resolved
        // Taiwan market segment / price type / time-in-force / limit price used.
        let executedRouting: OrderRouting | null = null;

        if (signal === 'BUY') {
          // 'ALL' = spend all currently-available simulated cash (respecting the
          // NT$20 minimum commission), down to whole shares rather than forcing
          // whole 張/1000-share lots — resolveOrderRouting below then clamps that
          // down further to a valid lot size for the current simulated trading
          // session, which can only ever reduce the quantity, so it stays affordable.
          let requested: number;
          if (result.quantity === 'ALL') {
            requested = Math.max(0, Math.floor(cash / (currentBar.close * (1 + COMMISSION_RATE))));
            while (requested > 0 && requested * currentBar.close + commissionFor(requested * currentBar.close) > cash) {
              requested--;
            }
          } else {
            requested = result.quantity ?? FALLBACK_QUANTITY;
          }

          const routing = resolveOrderRouting(requested, currentBar.time, currentBar.close, {
            priceType: result.priceType,
            timeInForce: result.timeInForce,
            limitPrice: result.limitPrice,
          });

          if (!routing.allowed) {
            const key = `${symbol}:buy-not-allowed`;
            if (!loggedErrors.has(key)) {
              loggedErrors.add(key);
              console.warn(`[Backtest] BUY skipped for ${symbol} — ${routing.reason}`);
            }
          } else {
            const clamped = routing.quantity;
            const gross = clamped * currentBar.close;
            const cost = gross + commissionFor(gross); // commission on the buy side is part of cost basis

            if (clamped <= 0 || cost > cash) {
              const key = `${symbol}:buy-insufficient-cash`;
              if (!loggedErrors.has(key)) {
                loggedErrors.add(key);
                console.warn(`[Backtest] BUY skipped for ${symbol} — insufficient simulated cash (have NT$${Math.round(cash)}, need NT$${Math.round(cost)})`);
              }
            } else {
              quantity = clamped;
              executedRouting = routing;
              shares += clamped;
              costBasis += cost;
              cash -= cost;
              totalInvested += cost;
            }
          }
        } else if (signal === 'SELL') {
          const requested = result.quantity === 'ALL' ? shares : (result.quantity ?? FALLBACK_QUANTITY);

          if (requested <= 0 || requested > shares) {
            const key = `${symbol}:sell-insufficient-shares`;
            if (!loggedErrors.has(key)) {
              loggedErrors.add(key);
              console.warn(`[Backtest] SELL skipped for ${symbol} — insufficient simulated position (hold ${shares}, requested ${requested})`);
            }
          } else {
            const routing = resolveOrderRouting(requested, currentBar.time, currentBar.close, {
              priceType: result.priceType,
              timeInForce: result.timeInForce,
              limitPrice: result.limitPrice,
            });

            if (!routing.allowed) {
              const key = `${symbol}:sell-not-allowed`;
              if (!loggedErrors.has(key)) {
                loggedErrors.add(key);
                console.warn(`[Backtest] SELL skipped for ${symbol} — ${routing.reason}`);
              }
            } else {
              const clamped = routing.quantity;
              quantity = clamped;
              executedRouting = routing;
              const avgCost = costBasis / shares;
              const costOfSold = clamped * avgCost;
              const gross = clamped * currentBar.close;
              const netProceeds = gross - commissionFor(gross) - gross * TRANSACTION_TAX_RATE;
              realizedPnL += netProceeds - costOfSold;
              shares -= clamped;
              costBasis -= costOfSold;
              cash += netProceeds;
            }
          }
        }

        signals.push({
          date: new Date(currentBar.time * 1000).toISOString(),
          symbol,
          signal,
          price: currentBar.close,
          quantity,
          triggered: true,
          marketType: executedRouting?.marketType ?? null,
          priceType: executedRouting?.priceType ?? null,
          timeInForce: executedRouting?.timeInForce ?? null,
          limitPrice: executedRouting?.limitPrice ?? null,
        });
      }

      // Whatever's still held at the end of this symbol's window is unrealized,
      // marked to its last close price as if closed out right now (so it's
      // net of the same commission + tax a real exit would incur).
      if (shares > 0) {
        const lastClose = primaryBars[primaryBars.length - 1].close;
        const grossValue = shares * lastClose;
        const netValue = grossValue - commissionFor(grossValue) - grossValue * TRANSACTION_TAX_RATE;
        unrealizedPnL += netValue - costBasis;
        openPositionCost += costBasis;
      }
    }

    return {
      totalSignals,
      returnRate: totalInvested > 0 ? (realizedPnL / totalInvested) * 100 : 0,
      unrealizedReturnRate: openPositionCost > 0 ? (unrealizedPnL / openPositionCost) * 100 : null,
      realizedPnL,
      totalInvested,
      unrealizedPnL,
      openPositionCost,
      signals,
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /** Fetches intraday bars from Yahoo Finance and upserts them into SQL. */
  private fetchAndCacheIntradayToSQL(
    symbol: string,
    interval: string,
    days: number,
  ): Promise<void> {
    const key = `${symbol}:${interval}`;
    const prior = this.inFlightFetches.get(key) ?? Promise.resolve();
    const run = prior.then(() => this.doFetchAndCacheIntradayToSQL(symbol, interval, days));
    // Chain future callers off this one even if it rejects — only the
    // caller's own `run` promise should surface the error.
    this.inFlightFetches.set(key, run.catch(() => {}));
    return run;
  }

  private async doFetchAndCacheIntradayToSQL(
    symbol: string,
    interval: string,
    days: number,
  ): Promise<void> {
    const bars = await this.getIntradayBars(symbol, interval, days);
    if (!bars.length) return;

    // Yahoo occasionally repeats a timestamp within one response — keep the
    // last occurrence so createMany's own batch doesn't self-collide on the
    // (symbol, date, interval) unique constraint.
    const byTime = new Map<number, (typeof bars)[number]>();
    for (const bar of bars) byTime.set(bar.time, bar);
    const dedupedBars = [...byTime.values()];

    const minDate = new Date(Math.min(...dedupedBars.map((b) => b.time)) * 1000);
    const maxDate = new Date(Math.max(...dedupedBars.map((b) => b.time)) * 1000);

    // Two separate awaits instead of a single $transaction so SQLite releases
    // the write lock between the delete and the insert (shorter lock windows,
    // no timeout under sequential seeding). Safe from cross-call interleaving
    // because fetchAndCacheIntradayToSQL() serializes calls per symbol:interval.
    await prisma.stockPrice.deleteMany({
      where: { symbol, interval, date: { gte: minDate, lte: maxDate } },
    });
    await prisma.stockPrice.createMany({
      data: dedupedBars.map((bar) => ({
        symbol,
        date: new Date(bar.time * 1000),
        interval,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })),
    });
  }
}

// ─── Module-level helpers ────────────────────────────────────────────────────

function toYFSymbol(symbol: string): string {
  return symbol.includes('.') ? symbol : `${symbol}.TW`;
}

/** Converts a UTC Date to YYYY-MM-DD in Asia/Taipei local time (en-CA gives ISO date format). */
function toTaiwanDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

/** Returns a copy of the date set to 23:59:59.999 UTC, so lte comparisons include all bars on that date. */
function toEndOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

function rowToCandleBar(r: { date: Date; open: number; high: number; low: number; close: number; volume: number }): CandleBar {
  return { time: Math.floor(r.date.getTime() / 1000), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume };
}

/**
 * Aggregates intraday CandleBar[] into daily OHLCVBar[] keyed by Asia/Taipei calendar date.
 * open=first bar, high=max, low=min, close=last bar, volume=sum.
 */
function aggregateIntradayToDaily(symbol: string, bars: CandleBar[]): OHLCVBar[] {
  const dayMap = new Map<string, OHLCVBar>();
  for (const bar of bars) {
    const dateKey = new Date(bar.time * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    const existing = dayMap.get(dateKey);
    if (!existing) {
      dayMap.set(dateKey, {
        symbol,
        date: new Date(dateKey + 'T00:00:00Z'),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    } else {
      if (bar.high > existing.high) existing.high = bar.high;
      if (bar.low < existing.low) existing.low = bar.low;
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }
  return [...dayMap.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

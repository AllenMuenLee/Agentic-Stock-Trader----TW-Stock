import { EventEmitter } from 'events';
import type { TickData } from '../types/rule.js';
import { getMarketSession } from '@stock-notifier/shared';

type FugleTickHandler = (tick: TickData) => void;

// Interval between REST-polling fetches for symbols that fell back off the
// WebSocket (Fugle plan's real-time subscription cap reached).
const REST_POLL_INTERVAL_MS = 15000;

// How long to wait after sending one symbol's subscribe before assuming it
// succeeded and moving on to the next. Fugle's limit-exceeded error doesn't
// name the symbol it rejected, so subscribing one at a time — with a pause
// to let a rejection arrive — is what makes "the symbol currently pending"
// an unambiguous, reliable way to attribute that error.
const SUBSCRIBE_SETTLE_MS = 400;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// 'aggregates' carries the OHLC/change/bid-ask fields handleFugleMessage()
// parses; 'trades' adds tick-by-tick price/volume between aggregate updates.
// ('quotes' is not a real Fugle channel — trying to subscribe to it was
// silently rejected server-side, which was the previous bug.)
const SUBSCRIBE_CHANNELS = ['aggregates', 'trades'] as const;

export class FugleService extends EventEmitter {
  private apiKey: string;
  private subscribedSymbols: Set<string> = new Set();
  private wsConnections: Map<string, unknown> = new Map();
  private client: unknown = null;
  private restClient: unknown = null;
  private isSimulation = false;
  /** Symbols that exceeded the WebSocket subscription cap — polled via REST instead. */
  private restPolling: Map<string, NodeJS.Timeout> = new Map();
  /**
   * Symbols waiting to be sent to the WebSocket. subscribe() only enqueues —
   * processQueue() drains it one symbol at a time (see SUBSCRIBE_SETTLE_MS)
   * so a burst of subscribe() calls (e.g. resubscribing everything on
   * startup) can't outrun Fugle's error responses.
   */
  private subscribeQueue: string[] = [];
  private queueProcessing = false;
  /** Set (within the settle window) when a limit-exceeded error arrives for the symbol processQueue() is currently subscribing. */
  private pendingLimitError = false;
  /**
   * Fugle's unsubscribe request needs the channel-subscription `id` it handed
   * back in the `subscribed` event — NOT the channel/symbol pair — so this
   * tracks `${symbol}:${channel}` → id for every channel we're subscribed to.
   */
  private subscriptionIds: Map<string, string> = new Map();
  /**
   * Set once Fugle actually reports the real-time subscription cap is
   * exceeded — routes further subscribe() calls straight to REST polling
   * without retrying the WebSocket. Cleared on the next unsubscribe(), since
   * that frees a slot and it's worth trying the WebSocket again.
   */
  private wsLimitReached = false;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    if (!this.apiKey) {
      console.warn('[Fugle] No API key — running in simulation mode');
      this.isSimulation = true;
      this.startSimulation();
      return;
    }

    try {
      const { WebSocketClient, RestClient } = await import('@fugle/marketdata');
      this.client = new WebSocketClient({ apiKey: this.apiKey });
      this.restClient = new RestClient({ apiKey: this.apiKey });

      const wsClient = this.client as any;
      wsClient.stock.on('message', (msg: unknown) => {
        try {
          const parsed = typeof msg === 'string' ? JSON.parse(msg) : msg as Record<string, unknown>;
          if (!parsed || typeof parsed !== 'object') return;

          // Log any error event from Fugle, and flag it if it's the real-time
          // subscription limit — processQueue() attributes it to whichever
          // symbol it's currently waiting on (see SUBSCRIBE_SETTLE_MS).
          if (parsed.event === 'error' || parsed.type === 'error') {
            console.error('[Fugle] Server error event:', JSON.stringify(parsed));
            if (this.isSubscriptionLimitError(parsed)) {
              this.pendingLimitError = true;
            }
            return;
          }

          // Record the channel-subscription id Fugle hands back so
          // sendUnsubscribe() can reference it later — unsubscribe requests
          // take this id, not the original channel/symbol pair.
          if (parsed.event === 'subscribed') {
            const data = parsed.data as Record<string, unknown> | undefined;
            const id = data?.id;
            const channel = data?.channel;
            const symbol = data?.symbol;
            if (typeof id === 'string' && typeof channel === 'string' && typeof symbol === 'string') {
              this.subscriptionIds.set(`${symbol}:${channel}`, id);
            }
            return;
          }

          if (parsed.data && typeof (parsed.data as Record<string, unknown>).symbol === 'string') {
            this.handleFugleMessage((parsed.data as Record<string, unknown>).symbol as string, parsed);
          }
        } catch {}
      });

      wsClient.stock.on('error', (err: unknown) => {
        console.error('[Fugle] WebSocket error:', err);
      });

      wsClient.stock.on('close', (code: number, reason: string) => {
        console.warn(`[Fugle] WebSocket closed — code: ${code}, reason: ${reason || '(none)'}`);
      });

      await wsClient.stock.connect();
      console.log('[Fugle] WebSocketClient connected and ready');
    } catch (error) {
      console.warn('[Fugle] SDK unavailable, using simulation mode:', error);
      this.isSimulation = true;
      this.startSimulation();
    }
  }

  subscribe(symbol: string): void {
    if (this.subscribedSymbols.has(symbol) || this.restPolling.has(symbol) || this.subscribeQueue.includes(symbol)) return;

    // Simulation mode has no real WebSocket capacity to exceed — just track
    // membership for startSimulation()'s mock tick loop, same as before.
    if (!this.client || this.isSimulation) {
      this.subscribedSymbols.add(symbol);
      return;
    }

    if (this.wsLimitReached) {
      console.warn(
        `[Fugle] WebSocket subscription limit previously exceeded — routing ${symbol} straight to REST polling (${REST_POLL_INTERVAL_MS / 1000}s)`,
      );
      this.startRestPolling(symbol);
      return;
    }

    this.subscribeQueue.push(symbol);
    this.processQueue().catch((e) => console.error('[Fugle] Subscribe queue error:', e));
  }

  unsubscribe(symbol: string): void {
    if (this.restPolling.has(symbol)) {
      this.stopRestPolling(symbol);
      console.log(`[Fugle] Stopped REST polling for ${symbol}.`);
      return;
    }

    const queueIdx = this.subscribeQueue.indexOf(symbol);
    if (queueIdx !== -1) this.subscribeQueue.splice(queueIdx, 1);

    if (!this.subscribedSymbols.has(symbol)) return;
    this.subscribedSymbols.delete(symbol);
    console.log(`[Fugle] Unsubscribed from ${symbol}. Current subscriptions: ${Array.from(this.subscribedSymbols).join(', ')}`);
    if (!this.client || this.isSimulation) return;
    // Freed a WebSocket slot — worth letting the next subscribe() try real-time again.
    this.wsLimitReached = false;
    this.sendUnsubscribe(symbol);
  }

  onTick(handler: FugleTickHandler): void {
    this.on('tick', handler);
  }

  /** Current WS-vs-REST split of tracked symbols — used by the admin dashboard. */
  getSubscriptionStatus(): { websocket: string[]; restPolling: string[] } {
    return {
      websocket: [...this.subscribedSymbols],
      restPolling: [...this.restPolling.keys()],
    };
  }

  /**
   * Polls Fugle's REST intraday quote endpoint every REST_POLL_INTERVAL_MS for
   * a symbol that exceeded the WebSocket subscription cap, emitting the same
   * 'tick' event the WebSocket path does — the rest of the pipeline (Redis
   * recording, rule evaluation, Socket.io broadcast) needs no awareness of
   * which transport a given symbol is using.
   */
  private startRestPolling(symbol: string): void {
    const poll = async () => {
      // Skip the fetch (but keep the interval alive) when the market's
      // definitely closed — avoids burning REST quota for no reason. Resumes
      // automatically once resolveOrderRouting's session helper reports open.
      const session = getMarketSession(Math.floor(Date.now() / 1000));
      if (session.session === 'CLOSED') return;

      try {
        const rest = this.restClient as any;
        const quote = await rest.stock.intraday.quote({ symbol });
        const tick = this.quoteToTick(symbol, quote);
        if (tick) this.emit('tick', tick);
      } catch (e) {
        console.error(`[Fugle] REST quote fetch failed for ${symbol}:`, e);
      }
    };

    poll(); // fetch immediately so the fallback isn't stale for up to REST_POLL_INTERVAL_MS
    this.restPolling.set(symbol, setInterval(poll, REST_POLL_INTERVAL_MS));
  }

  private stopRestPolling(symbol: string): void {
    const timer = this.restPolling.get(symbol);
    if (timer) clearInterval(timer);
    this.restPolling.delete(symbol);
  }

  /**
   * Matches Fugle's real-time subscription-limit error. Fugle's exact
   * wording/code isn't pinned down in their SDK types, so this checks for
   * "limit" alongside a term implying it was hit/exceeded rather than a
   * specific code, to stay robust to minor message changes.
   */
  private isSubscriptionLimitError(parsed: Record<string, unknown>): boolean {
    const data = parsed.data as Record<string, unknown> | undefined;
    const message = String(data?.message ?? parsed.message ?? '').toLowerCase();
    return message.includes('limit') && (message.includes('exceed') || message.includes('maximum') || message.includes('subscri'));
  }

  /** Sends a subscribe request for every channel in SUBSCRIBE_CHANNELS. */
  private sendSubscribe(symbol: string): void {
    const wsClient = this.client as any;
    for (const channel of SUBSCRIBE_CHANNELS) {
      wsClient.stock.subscribe({ channel, symbol });
    }
  }

  /**
   * Unsubscribes every channel we hold a recorded subscription id for on
   * this symbol. Fugle's unsubscribe protocol takes `{ ids: [...] }`, not a
   * channel/symbol pair — silently a no-op for channels that never
   * registered a 'subscribed' response (e.g. one rejected by the limit).
   */
  private sendUnsubscribe(symbol: string): void {
    const ids: string[] = [];
    for (const channel of SUBSCRIBE_CHANNELS) {
      const key = `${symbol}:${channel}`;
      const id = this.subscriptionIds.get(key);
      if (id) {
        ids.push(id);
        this.subscriptionIds.delete(key);
      }
    }
    if (!ids.length) return;
    try {
      const wsClient = this.client as any;
      wsClient.stock.unsubscribe({ ids });
    } catch (e) {
      console.error(`[Fugle] Failed to unsubscribe ${symbol}:`, e);
    }
  }

  /**
   * Drains subscribeQueue one symbol at a time. Each symbol is sent to the
   * WebSocket, then we wait SUBSCRIBE_SETTLE_MS for pendingLimitError to be
   * flipped by the message handler before deciding it succeeded — this is
   * what keeps a burst of subscribe() calls (e.g. resubscribing everything
   * on startup) from overrunning Fugle's real subscription cap before any
   * error has a chance to come back.
   */
  private async processQueue(): Promise<void> {
    if (this.queueProcessing) return;
    this.queueProcessing = true;

    try {
      while (this.subscribeQueue.length) {
        if (this.wsLimitReached) {
          // Already know the cap is hit — no point probing the rest one by one.
          const rest = this.subscribeQueue.splice(0);
          for (const symbol of rest) this.startRestPolling(symbol);
          break;
        }

        const symbol = this.subscribeQueue.shift()!;
        if (this.subscribedSymbols.has(symbol) || this.restPolling.has(symbol)) continue;

        this.pendingLimitError = false;
        try {
          this.sendSubscribe(symbol);
        } catch (e) {
          console.error(`[Fugle] Failed to subscribe ${symbol}:`, e);
          continue;
        }

        await sleep(SUBSCRIBE_SETTLE_MS);

        if (this.pendingLimitError) {
          this.wsLimitReached = true;
          // Whichever channels did register before the rejection (e.g.
          // 'aggregates' succeeded, 'trades' didn't) still need cleanup;
          // sendUnsubscribe() only sends ids we actually have on record.
          this.sendUnsubscribe(symbol);
          console.warn(
            `[Fugle] Subscription limit exceeded — falling back to REST polling (${REST_POLL_INTERVAL_MS / 1000}s) for ${symbol}`,
          );
          this.startRestPolling(symbol);
        } else {
          this.subscribedSymbols.add(symbol);
        }
      }
    } finally {
      this.queueProcessing = false;
    }
  }

  /** Converts a Fugle REST intraday quote response into the same TickData shape the WebSocket path emits. */
  private quoteToTick(symbol: string, quote: any): TickData | null {
    if (!quote) return null;
    const price = Number(quote.lastPrice ?? quote.closePrice ?? 0);
    if (!(price > 0)) return null;

    const bid = quote.bids?.[0];
    const ask = quote.asks?.[0];

    return {
      symbol,
      price,
      volume: Number(quote.total?.tradeVolume ?? 0),
      timestamp: new Date(),
      open: Number(quote.openPrice) || undefined,
      high: Number(quote.highPrice) || undefined,
      low: Number(quote.lowPrice) || undefined,
      close: Number(quote.closePrice ?? quote.lastPrice) || undefined,
      change: Number(quote.change) || undefined,
      changePercent: Number(quote.changePercent) || undefined,
      bid: Number(bid?.price) || undefined,
      ask: Number(ask?.price) || undefined,
      bidVolume: Number(bid?.size) || undefined,
      askVolume: Number(ask?.size) || undefined,
    };
  }

  private handleFugleMessage(symbol: string, rawData: unknown): void {
    try {
      const msg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, unknown>;
      
      let data = msg;
      if (msg && typeof msg === 'object' && 'event' in msg && 'data' in msg) {
        data = msg.data as Record<string, unknown>;
      } else if (msg && typeof msg === 'object' && 'data' in msg && 'info' in msg) {
        data = (msg.data as any).quote || msg.data;
      }
      if (!data) return;

      const bids = (data.bids ?? data.bid) as any;
      const asks = (data.asks ?? data.ask) as any;
      
      const priceVal = Number(data.price ?? data.lastPrice ?? data.closePrice ?? 0);
      const volumeVal = Number(data.volume ?? (data.total as any)?.tradeVolume ?? 0);

      const tick: TickData = {
        symbol,
        price: priceVal,
        volume: volumeVal,
        timestamp: new Date(),
        open: Number(data.openPrice) || undefined,
        high: Number(data.highPrice) || undefined,
        low: Number(data.lowPrice) || undefined,
        close: Number(data.closePrice ?? data.lastPrice ?? data.price) || undefined,
        change: Number(data.change) || undefined,
        changePercent: Number(data.changePercent) || undefined,
        bid: Number(Array.isArray(bids) ? bids[0]?.price : bids) || undefined,
        ask: Number(Array.isArray(asks) ? asks[0]?.price : asks) || undefined,
        bidVolume: Number(Array.isArray(bids) ? bids[0]?.size : (data.bidVolume || data.bidSize)) || undefined,
        askVolume: Number(Array.isArray(asks) ? asks[0]?.size : (data.askVolume || data.askSize)) || undefined,
      };

      if (tick.price > 0) this.emit('tick', tick);
    } catch {
      // ignore malformed messages
    }
  }

  private startSimulation(): void {
    console.log('[Fugle] Simulation mode: emitting mock ticks every 5s');

    // Each symbol has a fixed session "open" price. The current changePercent
    // (漲幅) is a random walk relative to that open, so threshold-based rules
    // (e.g. "gain >= 3%") can actually trigger within a couple of minutes.
    const sessionOpen: Record<string, number> = { '2330': 900, '2317': 120, '0050': 150 };
    const changePct: Record<string, number> = {};
    const dayHigh: Record<string, number> = {};
    const dayLow: Record<string, number> = {};

    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    // In simulation mode only tick a capped set of symbols so we don't flood
    // the DB with 1000+ concurrent rule-evaluation queries every 5 seconds.
    const SIM_MAX_SYMBOLS = 20;
    const FIXED_SIM = ['2330', '2317', '0050'];

    setInterval(() => {
      const extras = [...this.subscribedSymbols].filter((s) => !FIXED_SIM.includes(s)).slice(0, SIM_MAX_SYMBOLS - FIXED_SIM.length);
      const allSymbols = new Set([...FIXED_SIM, ...extras]);
      for (const symbol of allSymbols) {
        if (sessionOpen[symbol] === undefined) sessionOpen[symbol] = 100;
        const open = sessionOpen[symbol];

        // Random-walk the daily gain percent (~±1% per tick, bounded to ±10%).
        const prevPct = changePct[symbol] ?? 0;
        const pct = clamp(prevPct + (Math.random() - 0.5) * 2, -10, 10);
        changePct[symbol] = pct;

        const price = parseFloat((open * (1 + pct / 100)).toFixed(2));
        dayHigh[symbol] = Math.max(dayHigh[symbol] ?? price, price);
        dayLow[symbol] = Math.min(dayLow[symbol] ?? price, price);

        // Simulated order book: a tight spread around the last price.
        const bid = parseFloat((price * 0.999).toFixed(2));
        const ask = parseFloat((price * 1.001).toFixed(2));

        const tick: TickData = {
          symbol,
          price,
          volume: Math.floor(Math.random() * 10000) + 1000,
          timestamp: new Date(),
          open,
          high: dayHigh[symbol],
          low: dayLow[symbol],
          close: price,
          change: parseFloat((price - open).toFixed(2)),
          changePercent: parseFloat(pct.toFixed(2)),
          bid,
          ask,
          bidVolume: Math.floor(Math.random() * 500) + 50,
          askVolume: Math.floor(Math.random() * 500) + 50,
        };
        this.emit('tick', tick);
      }
    }, 5000);
  }
}

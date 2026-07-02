import { EventEmitter } from 'events';
import type { TickData } from '../types/rule.js';

type FugleTickHandler = (tick: TickData) => void;

export class FugleService extends EventEmitter {
  private apiKey: string;
  private subscribedSymbols: Set<string> = new Set();
  private wsConnections: Map<string, unknown> = new Map();
  private client: unknown = null;
  private isSimulation = false;

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
      const { WebSocketClient } = await import('@fugle/marketdata');
      this.client = new WebSocketClient({ apiKey: this.apiKey });
      
      const wsClient = this.client as any;
      wsClient.stock.on('message', (msg: unknown) => {
        try {
          const parsed = typeof msg === 'string' ? JSON.parse(msg) : msg as Record<string, unknown>;
          if (!parsed || typeof parsed !== 'object') return;

          // Log any error event from Fugle (e.g. subscription limit exceeded)
          if (parsed.event === 'error' || parsed.type === 'error') {
            console.error('[Fugle] Server error event:', JSON.stringify(parsed));
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
    if (this.subscribedSymbols.has(symbol)) return;
    this.subscribedSymbols.add(symbol);

    if (!this.client || this.isSimulation) return;

    try {
      const wsClient = this.client as any;
      wsClient.stock.subscribe({ channel: 'quotes', symbol });
      wsClient.stock.subscribe({ channel: 'trades', symbol });
    } catch (e) {
      console.error(`[Fugle] Failed to subscribe ${symbol}:`, e);
    }
  }

  unsubscribe(symbol: string): void {
    if (!this.subscribedSymbols.has(symbol)) return;
    this.subscribedSymbols.delete(symbol);
    console.log(`[Fugle] Unsubscribed from ${symbol}. Current subscriptions: ${Array.from(this.subscribedSymbols).join(', ')}`);
    if (!this.client || this.isSimulation) return;
    try {
      const wsClient = this.client as any;
      wsClient.stock.unsubscribe({ channel: 'quotes', symbol });
      wsClient.stock.unsubscribe({ channel: 'trades', symbol });
    } catch {
      // ignore
    }
  }

  onTick(handler: FugleTickHandler): void {
    this.on('tick', handler);
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

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
      const { WebSocketClient } = await import('@fugle/realtime');
      this.client = new WebSocketClient({ apiToken: this.apiKey });
      console.log('[Fugle] WebSocketClient ready');
    } catch (error) {
      console.warn('[Fugle] SDK unavailable, using simulation mode:', error);
      this.isSimulation = true;
      this.startSimulation();
    }
  }

  subscribe(symbol: string): void {
    if (this.subscribedSymbols.has(symbol)) return;
    this.subscribedSymbols.add(symbol);
    console.log(`[Fugle] Subscribed to ${symbol}. Current subscriptions: ${Array.from(this.subscribedSymbols).join(', ')}`);


    if (!this.client || this.isSimulation) return;

    try {
      const fugleClient = this.client as {
        intraday: {
          quote: (p: { symbolId: string }) => {
            on: (event: string, cb: (data: unknown) => void) => void;
          };
        };
      };

      const ws = fugleClient.intraday.quote({ symbolId: symbol });

      ws.on('message', (rawData: unknown) => {
        this.handleFugleMessage(symbol, rawData);
      });

      ws.on('error', (err: unknown) => {
        console.error(`[Fugle] WebSocket error for ${symbol}:`, err);
      });

      this.wsConnections.set(symbol, ws);
      console.log(`[Fugle] Subscribed to ${symbol}`);
    } catch (e) {
      console.error(`[Fugle] Failed to subscribe ${symbol}:`, e);
    }
  }

  unsubscribe(symbol: string): void {
    if (!this.subscribedSymbols.has(symbol)) return;
    this.subscribedSymbols.delete(symbol);
    console.log(`[Fugle] Unsubscribed from ${symbol}. Current subscriptions: ${Array.from(this.subscribedSymbols).join(', ')}`);
    const ws = this.wsConnections.get(symbol);
    if (ws) {
      try {
        (ws as { close?: () => void }).close?.();
      } catch {
        // ignore
      }
      this.wsConnections.delete(symbol);
    }
  }

  onTick(handler: FugleTickHandler): void {
    this.on('tick', handler);
  }

  private handleFugleMessage(symbol: string, rawData: unknown): void {
    try {
      const msg = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as Record<string, unknown>;
      if (!msg?.data) return;

      const data = msg.data as Record<string, unknown>;
      const bids = (data.bids ?? data.bid) as { price?: number; size?: number }[] | undefined;
      const asks = (data.asks ?? data.ask) as { price?: number; size?: number }[] | undefined;
      const tick: TickData = {
        symbol,
        price: Number(data.closePrice ?? data.price ?? 0),
        volume: Number(data.volume ?? 0),
        timestamp: new Date(),
        open: Number(data.openPrice) || undefined,
        high: Number(data.highPrice) || undefined,
        low: Number(data.lowPrice) || undefined,
        close: Number(data.closePrice) || undefined,
        change: Number(data.change) || undefined,
        changePercent: Number(data.changePercent) || undefined,
        bid: Number(bids?.[0]?.price ?? data.bidPrice) || undefined,
        ask: Number(asks?.[0]?.price ?? data.askPrice) || undefined,
        bidVolume: Number(bids?.[0]?.size ?? data.bidVolume) || undefined,
        askVolume: Number(asks?.[0]?.size ?? data.askVolume) || undefined,
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

    setInterval(() => {
      const allSymbols = new Set([...this.subscribedSymbols, '2330', '2317', '0050']);
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

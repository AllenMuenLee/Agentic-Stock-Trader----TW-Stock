import Redis from 'ioredis';
import type { TickData } from '../types/rule';

/**
 * A single point-in-time market sample stored in Redis. Mirrors the fields of a
 * tick so rule code can query any of them.
 */
export interface Sample {
  /** Unix timestamp in seconds. */
  t: number;
  price: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  bid: number;
  ask: number;
  bidVolume: number;
  askVolume: number;
}

/** How long the hot/daily tick data is retained in Redis (seconds). */
const RETENTION_SECONDS = 60 * 60; // 1 hour
/** Per-symbol cap to bound memory in the fallback store. */
const MAX_FALLBACK_SAMPLES = 5000;

const key = (symbol: string) => `ticks:${symbol}`;

function tickToSample(tick: TickData): Sample {
  const price = tick.price;
  return {
    t: Math.floor(tick.timestamp.getTime() / 1000),
    price,
    volume: tick.volume,
    open: tick.open ?? price,
    high: tick.high ?? price,
    low: tick.low ?? price,
    close: tick.close ?? price,
    change: tick.change ?? 0,
    changePercent: tick.changePercent ?? 0,
    bid: tick.bid ?? price,
    ask: tick.ask ?? price,
    bidVolume: tick.bidVolume ?? 0,
    askVolume: tick.askVolume ?? 0,
  };
}

/**
 * Stores and serves the hot/daily market data in Redis. Rule-code helper
 * functions read from here (recent data) and from SQL (history) — never from an
 * external API at evaluation time.
 *
 * If Redis is unavailable, it transparently degrades to an in-memory store so the
 * system stays runnable in development (mirrors the Fugle simulation / OpenRouter
 * mock fallbacks elsewhere in the codebase).
 */
export class RedisService {
  private client: Redis | null = null;
  private fallback = new Map<string, Sample[]>();
  private degraded = false;
  private warned = false;

  constructor(url = process.env.REDIS_URL || 'redis://localhost:6379') {
    try {
      this.client = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => (times > 3 ? null : 200),
      });
      this.client.on('error', () => this.degrade());
      this.client.connect().catch(() => this.degrade());
    } catch {
      this.degrade();
    }
  }

  private degrade(): void {
    if (!this.warned) {
      console.warn('[Redis] Unavailable — using in-memory fallback for hot tick data');
      this.warned = true;
    }
    this.degraded = true;
  }

  private get useFallback(): boolean {
    return this.degraded || !this.client || this.client.status !== 'ready';
  }

  /** Records a tick into the hot store, trimming anything older than the retention window. */
  async recordTick(tick: TickData): Promise<void> {
    const sample = tickToSample(tick);

    if (this.useFallback) {
      this.recordFallback(tick.symbol, sample);
      return;
    }

    try {
      const k = key(tick.symbol);
      await this.client!
        .multi()
        .zadd(k, sample.t, JSON.stringify(sample))
        .zremrangebyscore(k, 0, sample.t - RETENTION_SECONDS)
        .expire(k, RETENTION_SECONDS * 2)
        .exec();
    } catch {
      this.degrade();
      this.recordFallback(tick.symbol, sample);
    }
  }

  private recordFallback(symbol: string, sample: Sample): void {
    const arr = this.fallback.get(symbol) ?? [];
    arr.push(sample);
    const cutoff = sample.t - RETENTION_SECONDS;
    let drop = 0;
    while (drop < arr.length && arr[drop].t < cutoff) drop++;
    if (drop > 0) arr.splice(0, drop);
    if (arr.length > MAX_FALLBACK_SAMPLES) arr.splice(0, arr.length - MAX_FALLBACK_SAMPLES);
    this.fallback.set(symbol, arr);
  }

  /** Returns hot samples for a symbol within [startSec, endSec], in chronological order. */
  async getRange(symbol: string, startSec: number, endSec: number): Promise<Sample[]> {
    const lo = Math.min(startSec, endSec);
    const hi = Math.max(startSec, endSec);

    if (this.useFallback) {
      return (this.fallback.get(symbol) ?? []).filter((s) => s.t >= lo && s.t <= hi);
    }

    try {
      const raw = await this.client!.zrangebyscore(key(symbol), lo, hi);
      return raw.map((r) => JSON.parse(r) as Sample);
    } catch {
      this.degrade();
      return (this.fallback.get(symbol) ?? []).filter((s) => s.t >= lo && s.t <= hi);
    }
  }

  /** Returns all retained hot samples for a symbol, in chronological order. */
  async getAll(symbol: string): Promise<Sample[]> {
    if (this.useFallback) {
      return [...(this.fallback.get(symbol) ?? [])];
    }
    try {
      const raw = await this.client!.zrange(key(symbol), 0, -1);
      return raw.map((r) => JSON.parse(r) as Sample);
    } catch {
      this.degrade();
      return [...(this.fallback.get(symbol) ?? [])];
    }
  }

  // ─── Per-symbol metadata (當沖 eligibility, fundamentals, sector, etc.) ───────
  // Stored as a JSON blob under `meta:<symbol>`. This is the extension point for
  // "all sorts of data" beyond the live market feed — ingest it once (it changes
  // rarely) and rule code reads it synchronously via the preloaded snapshot.

  private metaFallback = new Map<string, Record<string, unknown>>();

  /** Upserts a symbol's metadata (merged with any existing keys). */
  async setMeta(symbol: string, meta: Record<string, unknown>): Promise<void> {
    const merged = { ...(await this.getMeta(symbol)), ...meta };
    if (this.useFallback) {
      this.metaFallback.set(symbol, merged);
      return;
    }
    try {
      await this.client!.set(`meta:${symbol}`, JSON.stringify(merged));
    } catch {
      this.degrade();
      this.metaFallback.set(symbol, merged);
    }
  }

  /** Returns a symbol's metadata object (empty object if none). */
  async getMeta(symbol: string): Promise<Record<string, unknown>> {
    if (this.useFallback) {
      return this.metaFallback.get(symbol) ?? {};
    }
    try {
      const raw = await this.client!.get(`meta:${symbol}`);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      this.degrade();
      return this.metaFallback.get(symbol) ?? {};
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client?.quit();
    } catch {
      // ignore
    }
  }
}

import type { PrismaClient } from '@prisma/client';
import type { FugleService } from './services/fugle.service';
import type { RedisService } from './services/redis.service';
import type { YFinanceService } from './services/yfinance.service';
import { runPoolFilter } from './engine/sandbox';

const SEEDED_SYMBOLS = ['2330', '2317', '0050'];

class SubscriptionManager {
  /** symbol → set of active rule IDs that require it */
  private symbolWatchers = new Map<string, Set<string>>();

  constructor(
    private prisma: PrismaClient,
    private fugle: FugleService,
    private redis: RedisService,
    private yfinance: YFinanceService,
  ) {}

  /**
   * Recomputes the full set of symbols that active rules need, then diffs
   * against the current subscription list:
   *   • subscribe + seed history for symbols that are newly needed
   *   • unsubscribe from symbols no rule watches any more
   *
   * For FIXED rules the symbol list is taken directly from the rule.
   * For DYNAMIC rules, poolFilterCode is evaluated against the "universe"
   * (all FIXED-rule symbols + the 3 seeded defaults) using Redis metadata.
   */
  async refresh(): Promise<void> {
    const rules = await this.prisma.rule.findMany({ where: { isActive: true } });

    // Universe = seeded defaults + all FIXED-rule symbols + every symbol
    // registered in SymbolMeta. SymbolMeta is a small table (one row per known
    // symbol) that is backfilled from StockPrice on startup and updated by
    // seedAllIntervals() so it never requires a slow SELECT DISTINCT.
    const [prismaMetaRows] = await Promise.all([
      this.prisma.symbolMeta.findMany({ select: { symbol: true, data: true } }),
    ]);

    const universe = new Set<string>(SEEDED_SYMBOLS);
    for (const rule of rules) {
      if ((rule.poolType ?? 'FIXED') === 'FIXED') {
        for (const s of JSON.parse(rule.symbols) as string[]) universe.add(s);
      }
    }
    const prismaMetaMap = new Map(
      prismaMetaRows.map((r) => [r.symbol, JSON.parse(r.data) as Record<string, unknown>]),
    );
    for (const { symbol } of prismaMetaRows) universe.add(symbol);

    const metaBySymbol = new Map<string, Record<string, unknown>>();
    for (const s of universe) {
      metaBySymbol.set(s, prismaMetaMap.get(s) ?? {});
    }

    // Build next watcher map
    const nextWatchers = new Map<string, Set<string>>();
    const addWatcher = (symbol: string, ruleId: string) => {
      if (!nextWatchers.has(symbol)) nextWatchers.set(symbol, new Set());
      nextWatchers.get(symbol)!.add(ruleId);
    };

    for (const rule of rules) {
      if ((rule.poolType ?? 'FIXED') === 'FIXED') {
        for (const s of JSON.parse(rule.symbols) as string[]) addWatcher(s, rule.id);
      } else if (rule.poolFilterCode) {
        for (const symbol of universe) {
          const meta = metaBySymbol.get(symbol) ?? {};
          if (runPoolFilter(rule.poolFilterCode, symbol, (key) => meta[key])) {
            addWatcher(symbol, rule.id);
          }
        }
      }
    }

    // Diff against current state
    const current = new Set(this.symbolWatchers.keys());
    const next    = new Set(nextWatchers.keys());

    const added: string[]   = [];
    const removed: string[] = [];

    for (const s of next)    if (!current.has(s)) { this.fugle.subscribe(s);   added.push(s); }
    for (const s of current) if (!next.has(s))    { this.fugle.unsubscribe(s); removed.push(s); }

    // Log watcher-count changes for symbols that stayed but had rule count change
    for (const s of next) {
      if (!current.has(s)) continue;
      const prev = this.symbolWatchers.get(s)?.size ?? 0;
      const nxt  = nextWatchers.get(s)?.size ?? 0;
      if (prev !== nxt) console.log(`[Subscriptions] ~ ${s}: ${prev} → ${nxt} rule(s)`);
    }

    this.symbolWatchers = nextWatchers;

    if (added.length)   console.log(`[Subscriptions] + subscribed:   ${added.join(', ')}`);
    if (removed.length) console.log(`[Subscriptions] - unsubscribed: ${removed.join(', ')}`);
    console.log(`[Subscriptions] Tracking: ${[...next].join(', ') || '(none)'}`);

    // Seed historical data for newly-subscribed symbols. seedAllIntervals()
    // skips any interval that already has recent data, so this is safe to
    // call even if the symbol was already tracked. Sequential to keep SQLite
    // contention-free.
    if (added.length) {
      (async () => {
        for (const s of added) {
          try {
            await this.yfinance.seedAllIntervals(s);
          } catch (err) {
            console.error(`[Subscriptions] Failed to seed history for ${s}:`, err);
          }
        }
      })().catch(console.error);
    }
  }

  /** Currently tracked symbol list (after the most recent refresh). */
  get trackedSymbols(): string[] {
    return [...this.symbolWatchers.keys()];
  }
}

// ── Module-level singleton with deferred init ─────────────────────────────────

let _manager: SubscriptionManager | null = null;

export function initSubscriptionManager(
  prisma: PrismaClient,
  fugle: FugleService,
  redis: RedisService,
  yfinance: YFinanceService,
): void {
  _manager = new SubscriptionManager(prisma, fugle, redis, yfinance);
}

/**
 * Refresh subscriptions based on current DB rule state.
 * Safe to call before init (logs a warning and no-ops).
 */
export async function refreshSubscriptions(): Promise<void> {
  if (!_manager) {
    console.warn('[Subscriptions] Manager not initialised — call initSubscriptionManager first');
    return;
  }
  await _manager.refresh();
}

/** Currently tracked symbols (empty before first refresh). */
export function getTrackedSubscriptions(): string[] {
  return _manager?.trackedSymbols ?? [];
}

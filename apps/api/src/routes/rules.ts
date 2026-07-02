import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import type { CreateRuleDto, RuleConfig, PoolType } from '@stock-notifier/shared';
import { runPoolFilter } from '../engine/sandbox';
import { refreshSubscriptions } from '../subscription-manager';
import { yfinance } from '../singletons';
import { requireAuth } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth);

// Same defaults the SubscriptionManager uses — keep in sync with subscription-manager.ts
const SEEDED_SYMBOLS = ['2330', '2317', '0050'];


/**
 * For a DYNAMIC rule, evaluates poolFilterCode against a broad universe of
 * symbols: the 3 seeded defaults + all FIXED-rule symbols + any symbol already
 * in StockPrice. Matched symbols with no historical data are seeded on-demand
 * so the backtest can proceed immediately.
 */
async function resolveDynamicSymbols(poolFilterCode: string): Promise<string[]> {
  // Build universe from SymbolMeta (small table, fast) + FIXED-rule symbols.
  // SymbolMeta is backfilled from StockPrice on startup and updated by seedAllIntervals
  // so it always reflects the full set of known symbols without a slow DISTINCT scan.
  const [fixedRules, metaRows] = await Promise.all([
    prisma.rule.findMany({ where: { poolType: 'FIXED' }, select: { symbols: true } }),
    prisma.symbolMeta.findMany({ select: { symbol: true, data: true } }),
  ]);

  const universe = new Set<string>(SEEDED_SYMBOLS);
  for (const r of fixedRules) {
    for (const s of JSON.parse(r.symbols) as string[]) universe.add(s);
  }
  const metaBySymbol = new Map<string, Record<string, unknown>>(
    metaRows.map((r): [string, Record<string, unknown>] => [r.symbol, JSON.parse(r.data) as Record<string, unknown>]),
  );
  for (const r of metaRows) universe.add(r.symbol);

  const matched: string[] = [];
  for (const symbol of universe) {
    const meta = metaBySymbol.get(symbol) ?? ({} as Record<string, unknown>);
    if (runPoolFilter(poolFilterCode, symbol, (key) => meta[key])) {
      matched.push(symbol);
    }
  }

  return matched;
}

// GET /api/rules
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rules = await prisma.rule.findMany({
      where: { userId: req.user!.id },
      include: { triggers: { orderBy: { triggeredAt: 'desc' }, take: 10 } },
      orderBy: { createdAt: 'desc' },
    });

    res.json(
      rules.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        symbols: JSON.parse(r.symbols) as string[],
        poolType: (r.poolType ?? 'FIXED') as PoolType,
        poolFilterCode: r.poolFilterCode ?? null,
        config: JSON.parse(r.config) as RuleConfig,
        sessionId: r.sessionId,
        isActive: r.isActive,
        winRate: r.winRate,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        triggersCount: r.triggers.length,
        recentTriggers: r.triggers.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          signal: t.signal,
          price: t.price,
          message: t.message,
          triggeredAt: t.triggeredAt.toISOString(),
        })),
      })),
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/rules
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as CreateRuleDto;

    const poolType = dto.poolType ?? 'FIXED';
    if (!dto.name || !dto.config) {
      res.status(400).json({ error: 'name and config are required' });
      return;
    }
    if (poolType === 'FIXED' && !dto.symbols?.length) {
      res.status(400).json({ error: 'symbols required for FIXED pool type' });
      return;
    }

    const rule = await prisma.rule.create({
      data: {
        name: dto.name,
        description: dto.description || '',
        config: JSON.stringify(dto.config),
        symbols: JSON.stringify(dto.symbols ?? []),
        poolType,
        poolFilterCode: dto.poolFilterCode ?? null,
        sessionId: dto.sessionId || null,
        userId: req.user!.id,
      },
    });

    refreshSubscriptions().catch(console.error);
    res.status(201).json({ id: rule.id, name: rule.name });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/rules/:id/toggle
router.patch('/:id/toggle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await prisma.rule.findUnique({ where: { id: req.params.id } });
    if (!rule) { res.status(404).json({ error: 'Rule not found' }); return; }

    const updated = await prisma.rule.update({
      where: { id: req.params.id },
      data: { isActive: !rule.isActive },
    });

    refreshSubscriptions().catch(console.error);
    res.json({ isActive: updated.isActive });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/rules/:id — update rule code, pool type, and pool filter code
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await prisma.rule.findUnique({ where: { id: req.params.id } });
    if (!rule) { res.status(404).json({ error: 'Rule not found' }); return; }

    const { code, poolType, poolFilterCode, symbols } = req.body as {
      code?: string;
      poolType?: PoolType;
      poolFilterCode?: string | null;
      symbols?: string[];
    };

    const updatedConfig = JSON.parse(rule.config) as RuleConfig;
    if (typeof code === 'string') updatedConfig.code = code;

    const updated = await prisma.rule.update({
      where: { id: req.params.id },
      data: {
        config: JSON.stringify(updatedConfig),
        ...(poolType !== undefined && { poolType }),
        ...(poolFilterCode !== undefined && { poolFilterCode: poolFilterCode ?? null }),
        ...(symbols !== undefined && { symbols: JSON.stringify(symbols) }),
      },
    });

    refreshSubscriptions().catch(console.error);
    res.json({
      id: updated.id,
      poolType: updated.poolType,
      poolFilterCode: updated.poolFilterCode ?? null,
      config: JSON.parse(updated.config) as RuleConfig,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/rules/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.rule.delete({ where: { id: req.params.id } });
    refreshSubscriptions().catch(console.error);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/rules/:id/available-dates — returns the SQL date range available for backtesting
router.get('/:id/available-dates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await prisma.rule.findUnique({ where: { id: req.params.id } });
    if (!rule) { res.status(404).json({ error: 'Rule not found' }); return; }

    let symbols: string[];
    if ((rule.poolType ?? 'FIXED') === 'DYNAMIC' && rule.poolFilterCode) {
      symbols = await resolveDynamicSymbols(rule.poolFilterCode);
    } else {
      symbols = JSON.parse(rule.symbols) as string[];
    }

    // Single aggregate query (union) — far faster than one query per symbol
    const range = await yfinance.getAvailableDateRangeForSymbols(symbols);
    if (!range) {
      res.json({ minDate: null, maxDate: null });
      return;
    }

    let { minDate, maxDate } = range;

    // Hard cap: at most 100 days back
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 100);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    if (minDate < cutoffStr) minDate = cutoffStr;

    if (minDate > maxDate) {
      res.json({ minDate: null, maxDate: null });
      return;
    }

    res.json({ minDate, maxDate });
  } catch (err) {
    next(err);
  }
});

// POST /api/rules/:id/backtest
router.post('/:id/backtest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await prisma.rule.findUnique({ where: { id: req.params.id } });
    if (!rule) { res.status(404).json({ error: 'Rule not found' }); return; }

    const config = JSON.parse(rule.config) as RuleConfig;
    const DYNAMIC_BACKTEST_CAP = 200;
    let symbols: string[];
    if ((rule.poolType ?? 'FIXED') === 'DYNAMIC' && rule.poolFilterCode) {
      const all = await resolveDynamicSymbols(rule.poolFilterCode);
      if (!all.length) {
        res.status(400).json({ error: 'No symbols matched the dynamic pool filter. Check that stock metadata (sector, name, etc.) has been seeded.' });
        return;
      }
      if (all.length > DYNAMIC_BACKTEST_CAP) {
        console.warn(`[Backtest] DYNAMIC pool has ${all.length} symbols — capping to first ${DYNAMIC_BACKTEST_CAP}`);
      }
      symbols = all.slice(0, DYNAMIC_BACKTEST_CAP);
    } else {
      symbols = JSON.parse(rule.symbols) as string[];
    }

    const { startDate: rawStart, endDate: rawEnd, days: rawDays } = req.body as {
      startDate?: string;
      endDate?: string;
      days?: number;
    };

    let backtestOptions: number | { startDate: Date; endDate: Date };

    if (rawStart && rawEnd) {
      const MAX_DAYS = 100;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - MAX_DAYS);

      const start = new Date(rawStart);
      // Extend end to 23:59:59.999 UTC so all intraday bars on that date are included
      // (e.g. Taiwan 1m bars land at 01:00–05:30 UTC, not at UTC midnight).
      const end = new Date(rawEnd);
      end.setUTCHours(23, 59, 59, 999);
      if (start < cutoff) start.setTime(cutoff.getTime());
      if (end > new Date()) end.setTime(Date.now());

      backtestOptions = { startDate: start, endDate: end };
    } else {
      backtestOptions = Math.min(Number(rawDays) || 30, 100);
    }

    const result = await yfinance.runBacktest(config, symbols, backtestOptions);

    await prisma.rule.update({
      where: { id: rule.id },
      data: { winRate: result.winRate },
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/rules/:id/triggers
router.get('/:id/triggers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const triggers = await prisma.trigger.findMany({
      where: { ruleId: req.params.id },
      orderBy: { triggeredAt: 'desc' },
      take: 100,
    });

    res.json(
      triggers.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        signal: t.signal,
        price: t.price,
        message: t.message,
        triggeredAt: t.triggeredAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

export default router;

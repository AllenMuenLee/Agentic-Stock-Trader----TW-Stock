import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { PrismaClient } from '@prisma/client';

import chatRouter from './routes/chat';
import rulesRouter from './routes/rules';
import settingsRouter from './routes/settings';
import stocksRouter from './routes/stocks';

import { FugleService } from './services/fugle.service';
import { NotificationService } from './services/notification.service';
import { RuleEngine } from './engine/rule-engine';
import { loadDataContext } from './engine/data-context';
import { runPoolFilter } from './engine/sandbox';
import { RedisService } from './services/redis.service';
import { YFinanceService } from './services/yfinance.service';
import type { RuleConfig, TickData } from './types/rule';

const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true },
});

const prisma = new PrismaClient();
const fugle = new FugleService(process.env.FUGLE_API_KEY || '');
const notifier = new NotificationService();
const ruleEngine = new RuleEngine();
const yfinance = new YFinanceService();
const redis = new RedisService();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/chat', chatRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/stocks', stocksRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Global error handler (must be 4-arg to be recognised by Express) ─────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[API] Unhandled error:', message);
  if (!res.headersSent) {
    res.status(500).json({ error: message });
  }
});

// ─── Socket.IO real-time feed ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.on('subscribe', (symbols: string[]) => {
    symbols.forEach((s) => fugle.subscribe(s));
    socket.join(symbols.map((s) => `tick:${s}`));
  });

  socket.on('unsubscribe', (symbols: string[]) => {
    symbols.forEach((s) => socket.leave(`tick:${s}`));
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// ─── Rule evaluation loop ─────────────────────────────────────────────────────
fugle.onTick(async (tick: TickData) => {
  // Persist the tick into Redis (hot/daily data) so code-rule helpers can read it
  await redis.recordTick(tick);

  // Broadcast tick to subscribed clients
  io.to(`tick:${tick.symbol}`).emit('tick', tick);

  // Evaluate active rules for this symbol
  try {
    const rules = await prisma.rule.findMany({
      where: { isActive: true },
      include: { user: true },
    });

    // Split rules: FIXED rules must explicitly list tick.symbol; DYNAMIC rules
    // run their poolFilterCode to decide. Dynamic rules are pooled at the end.
    const fixedMatching = rules.filter((r) => {
      if ((r.poolType ?? 'FIXED') !== 'FIXED') return false;
      return (JSON.parse(r.symbols) as string[]).includes(tick.symbol);
    });
    const dynamicRules = rules.filter((r) => (r.poolType ?? 'FIXED') === 'DYNAMIC');

    if (fixedMatching.length === 0 && dynamicRules.length === 0) return;

    const history = await yfinance.getHistoricalBars(tick.symbol, 60);
    const currTimeSec = Math.floor(tick.timestamp.getTime() / 1000);

    // Preload every symbol referenced by FIXED rules + tick.symbol.
    const ruleSymbols = new Set<string>([tick.symbol]);
    for (const r of fixedMatching) {
      for (const s of JSON.parse(r.symbols) as string[]) ruleSymbols.add(s);
    }
    const dataContext = await loadDataContext({
      redis,
      prisma,
      symbols: [...ruleSymbols],
      primarySymbol: tick.symbol,
      currTimeSec,
    });

    // Evaluate DYNAMIC rules: run poolFilterCode to check if tick.symbol is in the pool.
    const dynamicMatching = dynamicRules.filter((r) => {
      if (!r.poolFilterCode) return false;
      return runPoolFilter(
        r.poolFilterCode,
        tick.symbol,
        (key) => dataContext.get_meta(tick.symbol, key),
      );
    });

    const matchingRules = [...fixedMatching, ...dynamicMatching];
    if (matchingRules.length === 0) return;

    for (const rule of matchingRules) {
      const config = JSON.parse(rule.config) as RuleConfig;
      const result = ruleEngine.evaluate(config, tick, history, dataContext);

      // Log any bug in the user's rule code (syntax/runtime error, timeout, invalid return)
      if (result.error) {
        console.error(
          `[RuleEngine] Rule "${rule.name}" (id=${rule.id}) failed on ${tick.symbol} ` +
            `@ ${tick.timestamp.toISOString()}: ${result.error}`,
        );
        continue;
      }

      if (!result.triggered) continue;

      // Save trigger
      const trigger = await prisma.trigger.create({
        data: {
          ruleId: rule.id,
          symbol: tick.symbol,
          signal: result.signal!,
          price: tick.price,
          message: result.message!,
        },
      });

      // Emit to connected clients
      io.emit('signal', {
        ruleId: rule.id,
        ruleName: rule.name,
        triggerId: trigger.id,
        symbol: tick.symbol,
        signal: result.signal,
        price: tick.price,
        message: result.message,
        triggeredAt: trigger.triggeredAt.toISOString(),
      });

      // Send notifications
      const payload = {
        title: `${result.signal} Signal: ${tick.symbol}`,
        message: result.message!,
        symbol: tick.symbol,
        signal: result.signal,
        price: tick.price,
      };

      if (rule.user.email) {
        notifier.sendEmail(rule.user.email, payload).catch(console.error);
      }
      if (rule.user.lineToken) {
        notifier.sendLine(rule.user.lineToken, payload).catch(console.error);
      }
      if (rule.user.discordWebhook) {
        notifier.sendDiscord(rule.user.discordWebhook, payload).catch(console.error);
      }

      console.log(`[Engine] Rule "${rule.name}" triggered: ${result.message}`);
    }
  } catch (error) {
    console.error('[Engine] Error evaluating rules:', error);
  }
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Returns every symbol referenced in any FIXED rule plus the 3 seeded defaults. */
async function getTrackedSymbols(): Promise<string[]> {
  const base = ['2330', '2317', '0050'];
  const rules = await prisma.rule.findMany();
  for (const rule of rules) {
    if ((rule.poolType ?? 'FIXED') === 'FIXED') {
      base.push(...(JSON.parse(rule.symbols) as string[]));
    }
  }
  return [...new Set(base)];
}

/**
 * Seeds 100 days of daily + all intraday intervals for every tracked symbol.
 * Runs sequentially per symbol so SQLite is never overwhelmed.
 */
async function seedHistoricalData(): Promise<void> {
  const symbols = await getTrackedSymbols();
  console.log('[Startup] Seeding all intervals for:', symbols.join(', '));
  for (const symbol of symbols) {
    try {
      await yfinance.seedAllIntervals(symbol);
      console.log(`[Startup] Seeded ${symbol}`);
    } catch (err) {
      console.error(`[Startup] Failed to seed ${symbol}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log('[Startup] Historical data seed complete');
}

/**
 * Schedules a daily job at midnight that:
 *  1. Fetches the latest bars from Yahoo Finance and upserts to SQL
 *  2. Purges bars older than 100 days from SQL
 */
function scheduleDailyRefresh(): void {
  const run = async () => {
    try {
      const symbols = await getTrackedSymbols();
      console.log('[Daily] Refreshing all bar intervals for:', symbols.join(', '));
      await yfinance.refreshAllBars(symbols);
    } catch (err) {
      console.error('[Daily] Refresh failed:', err);
    }
  };

  const msUntilMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  };

  const schedule = () => setTimeout(async () => { await run(); schedule(); }, msUntilMidnight());
  schedule();
}

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001;

httpServer.listen(PORT, async () => {
  console.log(`[API] Server running on http://localhost:${PORT}`);

  // Seed per-symbol metadata (當沖 eligibility, names) so get_meta() works out of
  // the box. In production this would be ingested from a reference data source.
  const seedMeta: Record<string, Record<string, unknown>> = {
    '2330': { name: '台積電', dayTradeable: true, sector: 'Semiconductors' },
    '2317': { name: '鴻海', dayTradeable: true, sector: 'Electronics' },
    '0050': { name: '元大台灣50', dayTradeable: false, sector: 'ETF' },
  };
  await Promise.all(Object.entries(seedMeta).map(([sym, m]) => redis.setMeta(sym, m)));

  // Seed 100 days of daily + all intraday intervals for all tracked (rule) symbols
  seedHistoricalData().catch((err) => console.error('[Startup] Seed failed:', err));

  // Schedule daily SQL refresh + cleanup at midnight
  scheduleDailyRefresh();

  await fugle.connect();

  // Auto-subscribe to all actively tracked symbols for background rules
  const symbolsToTrack = await getTrackedSymbols();
  console.log(`[Startup] Auto-subscribing to ${symbolsToTrack.length} tracked symbols...`);
  symbolsToTrack.forEach((s) => fugle.subscribe(s));
});

process.on('SIGINT', async () => {
  await redis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection (server kept alive):', reason);
});

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

import chatRouter from './routes/chat';
import rulesRouter from './routes/rules';
import settingsRouter from './routes/settings';
import stocksRouter from './routes/stocks';
import authRouter from './routes/auth';
import bindRouter from './routes/bind';
import webhooksRouter from './routes/webhooks';

const JWT_SECRET = process.env.JWT_SECRET || 'stock-notifier-secret-key';

import { FugleService } from './services/fugle.service';
import { NotificationService } from './services/notification.service';
import { RuleEngine } from './engine/rule-engine';
import { loadDataContext } from './engine/data-context';
import { runPoolFilter } from './engine/sandbox';
import { initSubscriptionManager, refreshSubscriptions, getTrackedSubscriptions } from './subscription-manager';
import { redis, yfinance } from './singletons';
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

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/chat', chatRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/stocks', stocksRouter);
app.use('/api/bind', bindRouter);
app.use('/api/webhooks', webhooksRouter);

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

// ─── Socket.IO auth middleware (optional — unauthenticated sockets still receive tick data)
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (token) {
    try {
      const raw = token.startsWith('Bearer ') ? token.slice(7) : token;
      const payload = jwt.verify(raw, JWT_SECRET) as { id: string; username: string };
      socket.data.userId = payload.id;
    } catch { /* unauthenticated — tick feed still works */ }
  }
  next();
});

// ─── Socket.IO real-time feed ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Join user-specific room for signal notifications
  if (socket.data.userId) {
    socket.join(`user:${socket.data.userId as string}`);
  }

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

      const signalPayload = {
        ruleId: rule.id,
        ruleName: rule.name,
        triggerId: trigger.id,
        symbol: tick.symbol,
        signal: result.signal,
        price: tick.price,
        message: result.message,
        triggeredAt: trigger.triggeredAt.toISOString(),
      };

      // Broadcast to all dashboard clients + authenticated user's room
      io.emit('signal', signalPayload);
      io.to(`user:${rule.userId}`).emit('notification', signalPayload);

      // Send push notifications
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
      if (rule.user.lineUserId) {
        notifier.sendLine(rule.user.lineUserId, payload).catch(console.error);
      }
      if (rule.user.discordUserId) {
        notifier.sendDiscordDM(rule.user.discordUserId, payload).catch(console.error);
      }

      console.log(`[Engine] Rule "${rule.name}" triggered: ${result.message}`);
    }
  } catch (error) {
    console.error('[Engine] Error evaluating rules:', error);
  }
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Seeds 100 days of daily + all intraday intervals for every tracked symbol.
 * Called after refreshSubscriptions() so getTrackedSubscriptions() is populated.
 * Runs sequentially per symbol so SQLite is never overwhelmed.
 */
async function seedHistoricalData(): Promise<void> {
  const symbols = getTrackedSubscriptions();
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
      // Re-evaluate subscriptions first so any overnight rule changes are picked up.
      await refreshSubscriptions();
      const symbols = getTrackedSubscriptions();
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
  // the box. Written to both Redis (live rule evaluation) and Prisma (backtest).
  const seedMeta: Record<string, Record<string, unknown>> = {
    '2330': { name: '台積電', dayTradeable: true, sector: 'Semiconductors' },
    '2317': { name: '鴻海', dayTradeable: true, sector: 'Electronics' },
    '0050': { name: '元大台灣50', dayTradeable: false, sector: 'ETF' },
  };
  await Promise.all(
    Object.entries(seedMeta).map(([sym, m]) =>
      Promise.all([
        redis.setMeta(sym, m),
        prisma.symbolMeta.upsert({
          where: { symbol: sym },
          create: { symbol: sym, data: JSON.stringify(m) },
          update: { data: JSON.stringify(m) },
        }),
      ]),
    ),
  );

  // Backfill SymbolMeta from StockPrice so pool filters can look up all known symbols
  // without running a slow SELECT DISTINCT over 994K rows every request.
  // Skip if already populated (count check is O(1) — avoids blocking restarts).
  const metaCount = await prisma.symbolMeta.count();
  if (metaCount < 10) {
    await prisma.$executeRaw`
      INSERT OR IGNORE INTO "SymbolMeta" (symbol, data, updatedAt)
      SELECT DISTINCT symbol, '{}', datetime('now') FROM "StockPrice"
    `;
    console.log('[Startup] SymbolMeta registry synced from StockPrice');
  } else {
    console.log(`[Startup] SymbolMeta already has ${metaCount} entries — skipping backfill`);
  }

  // 2. Connect Fugle WebSocket (or start simulation).
  await fugle.connect();

  // 3. Init subscription manager and subscribe to all symbols needed by active rules.
  //    DYNAMIC pool filters are evaluated against the seeded universe so Fugle
  //    receives the correct symbol list before the first tick arrives.
  initSubscriptionManager(prisma, fugle, redis, yfinance);
  await refreshSubscriptions();

  // 4. Seed 100 days of historical data for every currently-tracked symbol.
  //    Must run after refreshSubscriptions() so getTrackedSubscriptions() is populated.
  seedHistoricalData().catch((err) => console.error('[Startup] Seed failed:', err));

  // 5. Schedule daily SQL refresh + subscription re-evaluation at midnight.
  scheduleDailyRefresh();
});

process.on('SIGINT', async () => {
  await redis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection (server kept alive):', reason);
});

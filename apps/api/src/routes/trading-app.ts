import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import archiver from 'archiver';
import { requireAuth } from '../middleware/auth';
import { getPlan } from '../config/plans';
import type { ReportTradeActivityDto, TradeActivityDto } from '@stock-notifier/shared';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth);

// POST /api/trading-app/activity — reported by the local CLI after every order
// attempt (live or simulated). Exempted from originGuard in index.ts since this
// is a script call, not a browser call — the JWT bearer token is the real gate.
router.post('/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as ReportTradeActivityDto;
    if (!dto.symbol || !dto.side || !dto.quantity || !dto.status || !dto.source) {
      res.status(400).json({ error: 'symbol, side, quantity, status and source are required' });
      return;
    }

    const activity = await prisma.tradeActivity.create({
      data: {
        userId: req.user!.id,
        ruleId: dto.ruleId ?? null,
        ruleName: dto.ruleName ?? null,
        symbol: dto.symbol,
        side: dto.side,
        quantity: dto.quantity,
        price: dto.price ?? null,
        status: dto.status,
        orderId: dto.orderId ?? null,
        message: dto.message ?? null,
        source: dto.source,
      },
    });

    res.status(201).json({ id: activity.id });
  } catch (err) {
    next(err);
  }
});

// GET /api/trading-app/activity — recent trade activity for the dashboard
router.get('/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const activities = await prisma.tradeActivity.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const dtos: TradeActivityDto[] = activities.map((a) => ({
      id: a.id,
      ruleId: a.ruleId,
      ruleName: a.ruleName,
      symbol: a.symbol,
      side: a.side,
      quantity: a.quantity,
      price: a.price,
      status: a.status,
      orderId: a.orderId,
      message: a.message,
      source: a.source,
      createdAt: a.createdAt.toISOString(),
    }));

    res.json(dtos);
  } catch (err) {
    next(err);
  }
});

// Source lives at repo-root/apps/trading-app — this file runs from apps/api/{src,dist}/routes,
// so it's three levels up either way.
const TRADING_APP_DIR = path.resolve(__dirname, '..', '..', '..', 'trading-app');

// GET /api/trading-app/download — zips the trading-app source for 399/799 plan users
router.get('/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) { res.status(404).json({ error: '找不到使用者' }); return; }

    const plan = getPlan(user.plan);
    if (!plan.canDownloadTradingApp) {
      res.status(403).json({ error: '此方案不提供交易應用程式下載，請升級至 399 或 799 方案', code: 'PLAN_REQUIRED' });
      return;
    }

    res.attachment('stock-notifier-trading-app.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => next(err));
    archive.pipe(res);

    const SKIP = new Set(['node_modules', 'dist', '.env']);
    archive.directory(TRADING_APP_DIR, 'stock-notifier-trading-app', (entry) => {
      const topLevel = entry.name.split('/')[0];
      return SKIP.has(topLevel) ? false : entry;
    });

    await archive.finalize();
  } catch (err) {
    next(err);
  }
});

export default router;

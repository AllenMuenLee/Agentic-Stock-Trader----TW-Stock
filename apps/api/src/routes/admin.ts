import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { signAdminToken, requireAdmin } from '../middleware/auth';
import { getTrackedSubscriptions } from '../subscription-manager';
import { fugle } from '../singletons';

const router = Router();
const prisma = new PrismaClient();

// POST /api/admin/login — single shared password (ADMIN_PASSWORD env var), no per-admin accounts.
router.post('/login', (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: '伺服器未設定管理員密碼' });
    return;
  }
  if (password !== expected) {
    res.status(401).json({ error: '密碼錯誤' });
    return;
  }
  res.json({ token: signAdminToken() });
});

router.use(requireAdmin);

// GET /api/admin/stats — total users, per-plan pre-registration counts, and live monitored-stock breakdown.
router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [totalUsers, preRegistrations] = await Promise.all([
      prisma.user.count(),
      prisma.preRegistration.groupBy({ by: ['planId'], _count: { planId: true } }),
    ]);

    const preRegistered = { PLAN_399: 0, PLAN_799: 0 };
    for (const row of preRegistrations) {
      if (row.planId === 'PLAN_399' || row.planId === 'PLAN_799') {
        preRegistered[row.planId] = row._count.planId;
      }
    }

    res.json({
      totalUsers,
      preRegistered,
      monitoredStocks: getTrackedSubscriptions(),
      subscriptionBreakdown: fugle.getSubscriptionStatus(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;

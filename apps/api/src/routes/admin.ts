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

// GET /api/admin/users — every user's email/verification status, for account management.
router.get('/users', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, username: true, emailVerified: true, plan: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        emailVerified: u.emailVerified,
        plan: u.plan,
        createdAt: u.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:id — removes the user and every row that references it
// (no cascading FK is defined on these relations, so dependents must go first).
router.delete('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ error: '找不到使用者' });
      return;
    }

    await prisma.trigger.deleteMany({ where: { rule: { userId: id } } });
    await prisma.rule.deleteMany({ where: { userId: id } });
    await prisma.tradeActivity.deleteMany({ where: { userId: id } });
    await prisma.accountSnapshot.deleteMany({ where: { userId: id } });
    await prisma.preRegistration.deleteMany({ where: { userId: id } });
    await prisma.chatMessage.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;

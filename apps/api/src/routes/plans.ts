import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { UsageService } from '../services/usage.service';
import { PLANS, getPlan, isValidPlanId } from '../config/plans';

const router = Router();
const prisma = new PrismaClient();
const usage = new UsageService(prisma);

router.use(requireAuth);

async function serializeStatus(user: { id: string; plan: string; rulesToday: number; chatToday: number }) {
  const plan = getPlan(user.plan);
  const preRegistration = await prisma.preRegistration.findUnique({ where: { userId: user.id } });
  return {
    plans: Object.values(PLANS).filter(p => p.id !== 'UNLIMITED'),
    current: {
      planId: plan.id,
      planName: plan.name,
      canDownloadTradingApp: plan.canDownloadTradingApp,
      canUseDynamicPool: plan.canUseDynamicPool,
      preRegisteredPlanId: preRegistration?.planId ?? null,
      preRegisteredAt: preRegistration?.createdAt.toISOString() ?? null,
      usage: {
        rulesToday: user.rulesToday,
        rulesLimit: plan.dailyRuleLimit,
        chatToday: user.chatToday,
        chatLimit: plan.dailyChatLimit,
      },
    },
  };
}

// GET /api/plans/me — plan catalogue + this user's current plan, today's usage, and pre-registration state
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await usage.ensureFreshUsage(req.user!.id);
    res.json(await serializeStatus(user));
  } catch (err) {
    next(err);
  }
});

// POST /api/plans/switch — dev-stage instant switch. Paid tiers (399/799) are no longer
// instantly self-assignable now that real payment doesn't exist yet — see /pre-register.
router.post('/switch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { planId } = req.body as { planId?: string };
    if (!planId || !isValidPlanId(planId)) {
      res.status(400).json({ error: '無效的方案代碼' });
      return;
    }
    if (planId !== 'FREE') {
      res.status(400).json({
        error: '399 / 799 方案尚未開放直接切換，請先在方案頁面預約，開放付款後將優先通知您',
        code: 'PRE_REGISTER_REQUIRED',
      });
      return;
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { plan: planId },
    });
    res.json(await serializeStatus(user));
  } catch (err) {
    next(err);
  }
});

// POST /api/plans/pre-register — record (or update) the logged-in user's interest in a paid plan.
router.post('/pre-register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { planId } = req.body as { planId?: string };
    if (planId !== 'PLAN_399' && planId !== 'PLAN_799') {
      res.status(400).json({ error: '僅能預約 399 或 799 方案' });
      return;
    }

    await prisma.preRegistration.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, planId },
      update: { planId, createdAt: new Date() },
    });

    const user = await usage.ensureFreshUsage(req.user!.id);
    res.json(await serializeStatus(user));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/plans/pre-register — cancel the logged-in user's pre-registration.
router.delete('/pre-register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.preRegistration.deleteMany({ where: { userId: req.user!.id } });
    const user = await usage.ensureFreshUsage(req.user!.id);
    res.json(await serializeStatus(user));
  } catch (err) {
    next(err);
  }
});

export default router;

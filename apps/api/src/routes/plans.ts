import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { UsageService } from '../services/usage.service';
import { PLANS, getPlan, isValidPlanId } from '../config/plans';

const router = Router();
const prisma = new PrismaClient();
const usage = new UsageService(prisma);

router.use(requireAuth);

function serializeStatus(user: { plan: string; rulesToday: number; chatToday: number }) {
  const plan = getPlan(user.plan);
  return {
    plans: Object.values(PLANS),
    current: {
      planId: plan.id,
      planName: plan.name,
      canDownloadTradingApp: plan.canDownloadTradingApp,
      canUseDynamicPool: plan.canUseDynamicPool,
      usage: {
        rulesToday: user.rulesToday,
        rulesLimit: plan.dailyRuleLimit,
        chatToday: user.chatToday,
        chatLimit: plan.dailyChatLimit,
      },
    },
  };
}

// GET /api/plans/me — plan catalogue + this user's current plan and today's usage
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await usage.ensureFreshUsage(req.user!.id);
    res.json(serializeStatus(user));
  } catch (err) {
    next(err);
  }
});

// POST /api/plans/switch — dev-stage plan switch, no real payment
router.post('/switch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { planId } = req.body as { planId?: string };
    if (!planId || !isValidPlanId(planId)) {
      res.status(400).json({ error: '無效的方案代碼' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { plan: planId },
    });
    res.json(serializeStatus(user));
  } catch (err) {
    next(err);
  }
});

export default router;

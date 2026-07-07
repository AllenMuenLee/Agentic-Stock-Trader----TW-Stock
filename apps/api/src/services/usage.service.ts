import { PrismaClient, User } from '@prisma/client';
import { getPlan } from '../config/plans';

function isNewDay(resetAt: Date): boolean {
  return new Date().toDateString() !== resetAt.toDateString();
}

export type QuotaKind = 'rule' | 'chat';

export type QuotaResult =
  | { ok: true }
  | { ok: false; limit: number; planName: string; planId: string };

export class UsageService {
  constructor(private prisma: PrismaClient) {}

  /** Resets rulesToday/chatToday when the last reset happened on a previous calendar day. */
  async ensureFreshUsage(userId: string): Promise<User> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!isNewDay(user.usageResetAt)) return user;
    return this.prisma.user.update({
      where: { id: userId },
      data: { rulesToday: 0, chatToday: 0, usageResetAt: new Date() },
    });
  }

  /** Checks the daily quota for `kind` and, if available, increments the matching counter. */
  async consumeQuota(userId: string, kind: QuotaKind): Promise<QuotaResult> {
    const user = await this.ensureFreshUsage(userId);
    const plan = getPlan(user.plan);
    const limit = kind === 'rule' ? plan.dailyRuleLimit : plan.dailyChatLimit;
    const used = kind === 'rule' ? user.rulesToday : user.chatToday;

    if (limit !== null && used >= limit) {
      return { ok: false, limit, planName: plan.name, planId: plan.id };
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: kind === 'rule' ? { rulesToday: { increment: 1 } } : { chatToday: { increment: 1 } },
    });
    return { ok: true };
  }
}

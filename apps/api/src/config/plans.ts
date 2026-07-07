import type { PlanId, PlanDefinition } from '@stock-notifier/shared';

export type { PlanId, PlanDefinition };

export const PLANS: Record<PlanId, PlanDefinition> = {
  FREE: {
    id: 'FREE',
    name: '免費方案',
    price: 0,
    dailyRuleLimit: 2,
    dailyChatLimit: 10,
    canDownloadTradingApp: false,
    features: ['每天最多建立 2 個 AI 規則', '每天最多 10 次對話輸入'],
  },
  PLAN_399: {
    id: 'PLAN_399',
    name: '399 方案',
    price: 399,
    dailyRuleLimit: 7,
    dailyChatLimit: 35,
    canDownloadTradingApp: true,
    features: ['每天最多建立 7 個 AI 規則', '每天最多 35 次對話輸入', '可下載獨立交易應用程式'],
  },
  PLAN_799: {
    id: 'PLAN_799',
    name: '799 方案',
    price: 799,
    dailyRuleLimit: null,
    dailyChatLimit: null,
    canDownloadTradingApp: true,
    features: ['AI 規則數與對話次數無限制', '可下載獨立交易應用程式'],
  },
};

export function getPlan(planId: string): PlanDefinition {
  return PLANS[planId as PlanId] ?? PLANS.FREE;
}

export function isValidPlanId(planId: string): planId is PlanId {
  return planId === 'FREE' || planId === 'PLAN_399' || planId === 'PLAN_799';
}

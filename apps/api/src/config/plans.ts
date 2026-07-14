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
    canUseDynamicPool: false,
    features: ['每天最多建立 2 個 AI 規則', '每天最多 10 次對話輸入'],
  },
  PLAN_399: {
    id: 'PLAN_399',
    name: '399 方案',
    price: 399,
    dailyRuleLimit: 7,
    dailyChatLimit: 35,
    canDownloadTradingApp: true,
    canUseDynamicPool: true,
    features: ['每天最多建立 7 個 AI 規則', '每天最多 35 次對話輸入', '可下載獨立交易應用程式', '可使用動態選股池'],
  },
  PLAN_799: {
    id: 'PLAN_799',
    name: '799 方案',
    price: 799,
    dailyRuleLimit: 15,
    dailyChatLimit: 150,
    canDownloadTradingApp: true,
    canUseDynamicPool: true,
    features: ['每天最多建立 15 個 AI 規則', '每天最多 150 次對話輸入', '可下載獨立交易應用程式', '可使用動態選股池'],
  },
  UNLIMITED: {
    id: 'UNLIMITED',
    name: '無限方案',
    price: 0,
    dailyRuleLimit: null,
    dailyChatLimit: null,
    canDownloadTradingApp: true,
    canUseDynamicPool: true,
    features: ['無限建立 AI 規則', '無限次對話輸入', '可下載獨立交易應用程式', '可使用動態選股池'],
  },
};

export function getPlan(planId: string): PlanDefinition {
  return PLANS[planId as PlanId] ?? PLANS.FREE;
}

export function isValidPlanId(planId: string): planId is PlanId {
  return planId === 'FREE' || planId === 'PLAN_399' || planId === 'PLAN_799' || planId === 'UNLIMITED';
}

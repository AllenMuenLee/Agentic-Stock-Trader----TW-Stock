'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { PlanStatus, PlanDefinition } from '@stock-notifier/shared';
import { Check, Download, RefreshCw, Sparkles, CircleGauge } from 'lucide-react';

function formatLimit(value: number | null): string {
  return value === null ? '無限制' : `${value}`;
}

function usagePercent(used: number, limit: number | null): number {
  if (limit === null || limit === 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export default function PlansPage() {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [preRegistering, setPreRegistering] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.getPlanStatus();
      setStatus(s);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const switchPlan = async (planId: string) => {
    setSwitching(planId);
    try {
      const s = await api.switchPlan(planId);
      setStatus(s);
    } catch (err) {
      alert(err instanceof Error ? err.message : '切換方案失敗');
    } finally {
      setSwitching(null);
    }
  };

  const preRegister = async (planId: string) => {
    setPreRegistering(planId);
    try {
      const s = await api.preRegisterPlan(planId);
      setStatus(s);
    } catch (err) {
      alert(err instanceof Error ? err.message : '預約失敗');
    } finally {
      setPreRegistering(null);
    }
  };

  const cancelPreRegister = async () => {
    setPreRegistering('cancel');
    try {
      const s = await api.cancelPreRegistration();
      setStatus(s);
    } catch (err) {
      alert(err instanceof Error ? err.message : '取消預約失敗');
    } finally {
      setPreRegistering(null);
    }
  };

  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await api.downloadTradingApp();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : '下載失敗');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 text-slate-500 animate-spin" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center text-slate-400 text-sm">
        無法載入方案資訊，請稍後再試。
      </div>
    );
  }

  const { current, plans } = status;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-slate-100 mb-1">訂閱方案</h1>
        <p className="text-sm text-slate-400">
          測試階段開放直接切換方案，尚未串接真實金流。
        </p>
      </div>

      {/* Current usage */}
      <div className="card p-5 mb-8">
        <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <CircleGauge className="w-4 h-4 text-sky-400" />
          目前方案：{current.planName}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>今日建立規則</span>
              <span>{current.usage.rulesToday} / {formatLimit(current.usage.rulesLimit)}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full transition-all"
                style={{ width: `${usagePercent(current.usage.rulesToday, current.usage.rulesLimit)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>今日對話次數</span>
              <span>{current.usage.chatToday} / {formatLimit(current.usage.chatLimit)}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${usagePercent(current.usage.chatToday, current.usage.chatLimit)}%` }}
              />
            </div>
          </div>
        </div>

        {current.canDownloadTradingApp && (
          <div className="mt-5 pt-4 border-t border-slate-800">
            <button
              onClick={download}
              disabled={downloading}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {downloading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              下載獨立交易應用程式
            </button>
            {downloadError && <p className="text-xs text-red-400 mt-2">{downloadError}</p>}
            <p className="text-xs text-slate-500 mt-2">
              下載後請參考壓縮檔內的 README 設定富邦 Neo API 憑證並在本機執行。
            </p>
          </div>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan: PlanDefinition) => {
          const isCurrent = plan.id === current.planId;
          const isPaid = plan.id === 'PLAN_399' || plan.id === 'PLAN_799';
          const isPreRegisteredForThis = current.preRegisteredPlanId === plan.id;
          return (
            <div
              key={plan.id}
              className={`card p-5 flex flex-col ${isCurrent ? 'border-sky-500/50 ring-1 ring-sky-500/30' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-slate-100">{plan.name}</h3>
                {plan.id === 'PLAN_799' && <Sparkles className="w-4 h-4 text-amber-400" />}
              </div>
              <p className="text-2xl font-bold text-slate-100 mb-4">
                {plan.price === 0 ? '免費' : `NT$${plan.price}`}
                {plan.price > 0 && <span className="text-sm font-normal text-slate-500"> /月</span>}
              </p>

              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <button disabled className="btn-ghost text-sm cursor-default">
                  目前方案
                </button>
              ) : isPaid ? (
                isPreRegisteredForThis ? (
                  <div className="space-y-2">
                    <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 flex-shrink-0" />
                      已預約，開放付款後將優先通知您
                    </p>
                    <button
                      onClick={cancelPreRegister}
                      disabled={preRegistering === 'cancel'}
                      className="btn-ghost text-sm w-full flex items-center justify-center"
                    >
                      {preRegistering === 'cancel' ? <RefreshCw className="w-4 h-4 animate-spin" /> : '取消預約'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => preRegister(plan.id)}
                    disabled={preRegistering === plan.id}
                    className="btn-primary text-sm flex items-center justify-center gap-1.5"
                  >
                    {preRegistering === plan.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : '預約此方案'}
                  </button>
                )
              ) : (
                <button
                  onClick={() => switchPlan(plan.id)}
                  disabled={switching === plan.id}
                  className="btn-primary text-sm flex items-center justify-center gap-1.5"
                >
                  {switching === plan.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : '切換至此方案'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

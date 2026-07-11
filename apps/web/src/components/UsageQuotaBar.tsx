'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { PlanStatus } from '@stock-notifier/shared';
import { CircleGauge } from 'lucide-react';

function formatLimit(value: number | null): string {
  return value === null ? '無限制' : `${value}`;
}

function usagePercent(used: number, limit: number | null): number {
  if (limit === null || limit === 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

interface UsageQuotaBarProps {
  /** 'full' shows both metrics as labeled progress bars. 'compact' shows a single inline "used/limit" string — for tight spaces like a chat header. */
  variant?: 'full' | 'compact';
  /** Which metric to show in compact mode (ignored in full mode). */
  metric?: 'rules' | 'chat';
  className?: string;
}

/** Today's AI-rule/chat quota usage for the signed-in user's plan. Polls every 60s so it stays current as the user consumes quota elsewhere (e.g. dashboard open in another tab). */
export default function UsageQuotaBar({ variant = 'full', metric = 'chat', className = '' }: UsageQuotaBarProps) {
  const [status, setStatus] = useState<PlanStatus | null>(null);

  const load = useCallback(() => {
    api.getPlanStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  if (!status) return null;
  const { usage } = status.current;

  if (variant === 'compact') {
    const used = metric === 'rules' ? usage.rulesToday : usage.chatToday;
    const limit = metric === 'rules' ? usage.rulesLimit : usage.chatLimit;
    const label = metric === 'rules' ? '規則' : '對話';
    return (
      <span className={`text-xs text-slate-500 tabular-nums ${className}`} title={`今日${label}用量`}>
        {label} {used}/{formatLimit(limit)}
      </span>
    );
  }

  return (
    <div className={`card p-4 ${className}`}>
      <h2 className="text-xs font-semibold text-slate-400 mb-3 flex items-center gap-1.5">
        <CircleGauge className="w-3.5 h-3.5 text-sky-400" />
        今日用量（{status.current.planName}）
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>今日建立規則</span>
            <span>{usage.rulesToday} / {formatLimit(usage.rulesLimit)}</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500 rounded-full transition-all"
              style={{ width: `${usagePercent(usage.rulesToday, usage.rulesLimit)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>今日對話次數</span>
            <span>{usage.chatToday} / {formatLimit(usage.chatLimit)}</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${usagePercent(usage.chatToday, usage.chatLimit)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { TradeActivityDto } from '@stock-notifier/shared';
import { Landmark, RefreshCw, FlaskConical } from 'lucide-react';

function statusClass(status: string): string {
  if (status === 'FILLED') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
  if (status === 'SIMULATED') return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
  if (status === 'REJECTED') return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  return 'text-red-400 bg-red-500/10 border-red-500/30'; // FAILED
}

/** Formats signal-triggered → order-sent latency as e.g. "1.2s" / "850ms". */
function formatLatency(latencyMs: number): string {
  return latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`;
}

const MARKET_TYPE_LABEL: Record<string, string> = { Common: '整股', Odd: '零股', Fixing: '盤後定價' };
const PRICE_TYPE_LABEL: Record<string, string> = { Limit: '限價', Market: '市價' };

/** Formats resolved Taiwan order routing as e.g. "整股·限價·ROD"; null when not resolved (e.g. REJECTED). */
function formatRouting(marketType: string | null, priceType: string | null, timeInForce: string | null): string | null {
  if (!marketType || !priceType || !timeInForce) return null;
  return [MARKET_TYPE_LABEL[marketType] ?? marketType, PRICE_TYPE_LABEL[priceType] ?? priceType, timeInForce].join('·');
}

/** Trades executed locally by the trading-app CLI, reported back for visibility only — no Fubon credentials ever pass through this. */
export default function TradingActivityPanel() {
  const [activity, setActivity] = useState<TradeActivityDto[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.getTradingActivity();
      setActivity(data);
    } catch {
      setActivity([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) return null;
  if (!activity || activity.length === 0) return null; // no trading-app activity yet — don't clutter the dashboard

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
          <Landmark className="w-4 h-4 text-sky-400" />
          交易應用程式活動
        </h2>
        <button onClick={load} className="btn-ghost text-xs flex items-center gap-1">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {activity.map((a) => (
          <div key={a.id} className="flex items-center gap-3 text-xs text-slate-400 px-2 py-1.5 bg-slate-900/60 rounded">
            <span className={`px-2 py-0.5 rounded-full border font-semibold ${statusClass(a.status)}`}>
              {a.status}
            </span>
            <span className={a.side === 'BUY' ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
              {a.side}
            </span>
            <span className="font-medium text-slate-300">{a.symbol}</span>
            <span>x{a.quantity}</span>
            {formatRouting(a.marketType, a.priceType, a.timeInForce) && (
              <span className="text-slate-500">{formatRouting(a.marketType, a.priceType, a.timeInForce)}</span>
            )}
            {a.ruleName && <span className="text-slate-600 truncate max-w-[10rem]">{a.ruleName}</span>}
            {a.latencyMs != null && (
              <span className="text-slate-500 tabular-nums" title="訊號觸發到送出委託的延遲">
                延遲 {formatLatency(a.latencyMs)}
              </span>
            )}
            {a.source === 'SIMULATION' && (
              <span className="inline-flex items-center gap-1 text-purple-400">
                <FlaskConical className="w-3 h-3" /> 模擬
              </span>
            )}
            <span className="ml-auto text-slate-600 tabular-nums flex-shrink-0">
              {new Date(a.createdAt).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

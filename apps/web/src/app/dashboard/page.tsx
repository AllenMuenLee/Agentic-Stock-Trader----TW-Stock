'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  Play, Pause, Trash2, BarChart2, Clock, TrendingUp, TrendingDown,
  RefreshCw, ChevronDown, ChevronUp, Zap, AlertCircle, MessageSquare,
  Bell, ArrowLeftRight, Pencil, Check, X, Database, Filter,
} from 'lucide-react';
import type { RuleDto, TriggerDto, BacktestResult, PoolType } from '@stock-notifier/shared';
import { JsCode } from '@/components/CodeView';

interface RuleWithExtra extends RuleDto {
  recentTriggers?: TriggerDto[];
}

interface EditState {
  code: string;
  poolType: PoolType;
  poolFilterCode: string;
  symbols: string;
}

function formatSignalDate(isoStr: string): string {
  const d = new Date(isoStr);
  // Daily bars land at midnight UTC; intraday bars have a non-zero time component.
  const isIntraday = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
  if (isIntraday) {
    return d.toLocaleString(undefined, {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function signalBadgeClass(signal: string): string {
  if (signal === 'BUY') return 'badge-buy';
  if (signal === 'SELL') return 'badge-sell';
  // NOTIFY (or anything else) → neutral
  return 'text-xs bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-full font-semibold';
}

function ActionTypeBadge({ type }: { type: string | undefined }) {
  if (type === 'trade') {
    return (
      <span className="inline-flex items-center gap-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full text-xs font-semibold">
        <ArrowLeftRight className="w-3 h-3" />
        交易
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-full text-xs font-semibold">
      <Bell className="w-3 h-3" />
      通知
    </span>
  );
}

interface DateRange { startDate: string; endDate: string }
interface AvailableDates { minDate: string | null; maxDate: string | null }

export default function DashboardPage() {
  const [rules, setRules] = useState<RuleWithExtra[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [backtestResults, setBacktestResults] = useState<Record<string, BacktestResult>>({});
  const [backtestLoading, setBacktestLoading] = useState<string | null>(null);
  const [backtestDates, setBacktestDates] = useState<Record<string, DateRange>>({});
  const [availableDates, setAvailableDates] = useState<Record<string, AvailableDates>>({});
  const [backtestDateRange, setBacktestDateRange] = useState<Record<string, DateRange>>({});

  // Code editor + pool type editor state (per rule id)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ code: '', poolType: 'FIXED', poolFilterCode: '', symbols: '' });
  const [saveLoading, setSaveLoading] = useState(false);

  // Per-rule toggle: show all backtest signals vs. last 10
  const [showAllSignals, setShowAllSignals] = useState<Record<string, boolean>>({});
  // Per-rule toggle: show all live triggers vs. last 5
  const [showAllTriggers, setShowAllTriggers] = useState<Record<string, boolean>>({});

  const loadAvailableDates = async (ruleId: string) => {
    try {
      const range = await api.getRuleAvailableDates(ruleId);
      setAvailableDates((prev) => ({ ...prev, [ruleId]: range }));
      if (range.minDate && range.maxDate) {
        setBacktestDates((prev) => {
          if (prev[ruleId]) return prev;
          return { ...prev, [ruleId]: { startDate: range.minDate!, endDate: range.maxDate! } };
        });
      }
    } catch {
      // ignore — SQL may have no data yet
    }
  };

  const loadRules = async () => {
    try {
      const loaded = await api.getRules() as RuleWithExtra[];
      setRules(loaded);
      // Load available dates for all rules in parallel so date pickers are pre-filled
      await Promise.all(loaded.map((r) => loadAvailableDates(r.id)));
    } catch {
      console.error('Failed to load rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
    const interval = setInterval(loadRules, 30000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh dates when a panel expands so min/max stay current
  useEffect(() => {
    if (expandedId) loadAvailableDates(expandedId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId]);

  const toggleRule = async (id: string) => {
    await api.toggleRule(id);
    await loadRules();
  };

  const deleteRule = async (id: string) => {
    if (!confirm('確定要刪除此規則嗎？')) return;
    await api.deleteRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const startEditing = (rule: RuleWithExtra) => {
    setEditingId(rule.id);
    setEditState({
      code: rule.config.code ?? '',
      poolType: rule.poolType,
      poolFilterCode: rule.poolFilterCode ?? '',
      symbols: rule.symbols.join(', '),
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveEdit = async (id: string) => {
    setSaveLoading(true);
    try {
      const payload: { code?: string; poolType: PoolType; poolFilterCode?: string | null; symbols?: string[] } = {
        poolType: editState.poolType,
      };
      if (editState.code.trim()) payload.code = editState.code;
      if (editState.poolType === 'DYNAMIC') {
        payload.poolFilterCode = editState.poolFilterCode.trim() || null;
        payload.symbols = [];
      } else {
        payload.poolFilterCode = null;
        payload.symbols = editState.symbols.split(',').map((s) => s.trim()).filter(Boolean);
      }
      await api.updateRule(id, payload);
      setEditingId(null);
      await loadRules();
    } catch {
      alert('儲存失敗，請稍後再試');
    } finally {
      setSaveLoading(false);
    }
  };

  const runBacktest = async (id: string) => {
    setBacktestLoading(id);
    try {
      const dates = backtestDates[id];
      const result = await api.backtestRule(id, dates ?? 30) as BacktestResult;
      setBacktestResults((prev) => ({ ...prev, [id]: result }));
      if (dates) setBacktestDateRange((prev) => ({ ...prev, [id]: dates }));
      await loadRules();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '回測失敗';
      alert(msg);
    } finally {
      setBacktestLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 text-slate-500 animate-spin" />
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <AlertCircle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-300 mb-2">尚無監控規則</h2>
        <p className="text-slate-500 text-sm">
          前往 AI 助手對話，建立您的第一條股票監控規則。
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-100">監控儀表板</h1>
        <button onClick={loadRules} className="btn-ghost flex items-center gap-1.5 text-sm">
          <RefreshCw className="w-3.5 h-3.5" />
          重新整理
        </button>
      </div>

      {rules.map((rule) => {
        const isExpanded = expandedId === rule.id;
        const backtest = backtestResults[rule.id];
        const isTrade = rule.config.actionType === 'trade';
        const rangeUsed = backtestDateRange[rule.id];
        const backtestDaysCount = rangeUsed
          ? Math.max(1, Math.ceil((new Date(rangeUsed.endDate).getTime() - new Date(rangeUsed.startDate).getTime()) / 86400000))
          : 30;

        return (
          <div key={rule.id} className="card overflow-hidden">
            {/* Rule Header */}
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${rule.isActive ? 'bg-emerald-400' : 'bg-slate-600'}`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-100">{rule.name}</h3>
                    <ActionTypeBadge type={rule.config.actionType} />
                    <span className={signalBadgeClass(rule.config.signal)}>
                      {rule.config.signal}
                    </span>
                    {!rule.isActive && (
                      <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                        已暫停
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 mt-0.5">{rule.description}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {rule.poolType === 'DYNAMIC' ? (
                      <span className="inline-flex items-center gap-1 text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full">
                        <Filter className="w-3 h-3" />
                        動態選股池
                      </span>
                    ) : (
                      rule.symbols.map((s) => (
                        <span key={s} className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                          {s}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* Stats — backtest and live are labelled separately */}
                <div className="flex gap-4 text-center flex-shrink-0">
                  {isTrade ? (
                    <div>
                      <p className="text-xs text-amber-600/80">回測勝率</p>
                      <p className={`text-lg font-bold ${rule.winRate !== null ? (rule.winRate >= 50 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}`}>
                        {rule.winRate !== null ? `${rule.winRate.toFixed(1)}%` : '—'}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-amber-600/80">回測訊號數</p>
                      <p className="text-lg font-bold text-slate-300">
                        {backtestResults[rule.id] ? backtestResults[rule.id].totalSignals : '—'}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-emerald-600/80">即時觸發</p>
                    <p className="text-lg font-bold text-slate-300">{rule.triggersCount}</p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-800 flex-wrap">
                <button
                  onClick={() => toggleRule(rule.id)}
                  className="btn-ghost text-xs flex items-center gap-1.5"
                >
                  {rule.isActive ? (
                    <><Pause className="w-3.5 h-3.5" /> 暫停</>
                  ) : (
                    <><Play className="w-3.5 h-3.5 text-emerald-400" /> 啟用</>
                  )}
                </button>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => runBacktest(rule.id)}
                    disabled={backtestLoading === rule.id || !availableDates[rule.id]?.maxDate}
                    className="btn-ghost text-xs flex items-center gap-1.5"
                    title={!availableDates[rule.id]?.maxDate ? '資料庫尚無歷史數據' : '執行回測'}
                  >
                    {backtestLoading === rule.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <BarChart2 className="w-3.5 h-3.5" />
                    )}
                    回測
                  </button>
                  <input
                    type="date"
                    value={backtestDates[rule.id]?.startDate ?? ''}
                    min={availableDates[rule.id]?.minDate ?? undefined}
                    max={backtestDates[rule.id]?.endDate ?? availableDates[rule.id]?.maxDate ?? undefined}
                    disabled={!availableDates[rule.id]?.maxDate}
                    onChange={(e) =>
                      setBacktestDates((prev) => ({
                        ...prev,
                        [rule.id]: { ...prev[rule.id], startDate: e.target.value },
                      }))
                    }
                    className="bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 px-1.5 py-0.5 w-[118px] disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                  <span className="text-slate-600 text-xs">–</span>
                  <input
                    type="date"
                    value={backtestDates[rule.id]?.endDate ?? ''}
                    min={backtestDates[rule.id]?.startDate ?? availableDates[rule.id]?.minDate ?? undefined}
                    max={availableDates[rule.id]?.maxDate ?? undefined}
                    disabled={!availableDates[rule.id]?.maxDate}
                    onChange={(e) =>
                      setBacktestDates((prev) => ({
                        ...prev,
                        [rule.id]: { ...prev[rule.id], endDate: e.target.value },
                      }))
                    }
                    className="bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 px-1.5 py-0.5 w-[118px] disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                </div>

                {rule.sessionId && (
                  <Link
                    href={`/chat?session=${rule.sessionId}`}
                    className="btn-ghost text-xs flex items-center gap-1.5 text-sky-400 hover:text-sky-300"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    在 AI 助手中編輯
                  </Link>
                )}

                <button
                  onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                  className="btn-ghost text-xs flex items-center gap-1.5 ml-auto"
                >
                  {isExpanded ? (
                    <><ChevronUp className="w-3.5 h-3.5" /> 收起</>
                  ) : (
                    <><ChevronDown className="w-3.5 h-3.5" /> 詳細</>
                  )}
                </button>

                <button
                  onClick={() => deleteRule(rule.id)}
                  className="btn-ghost text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Expanded Details */}
            {isExpanded && (
              <div className="border-t border-slate-800 bg-slate-950/50 p-4 space-y-4">
                {/* Rule Logic — editable code block */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" /> 規則程式碼
                    </h4>
                    {editingId !== rule.id ? (
                      <button
                        onClick={() => startEditing(rule)}
                        className="btn-ghost text-xs flex items-center gap-1 text-sky-400 hover:text-sky-300"
                      >
                        <Pencil className="w-3 h-3" /> 編輯
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => saveEdit(rule.id)}
                          disabled={saveLoading}
                          className="btn-ghost text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                        >
                          {saveLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          儲存
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="btn-ghost text-xs flex items-center gap-1 text-slate-400"
                        >
                          <X className="w-3 h-3" /> 取消
                        </button>
                      </div>
                    )}
                  </div>

                  {editingId === rule.id ? (
                    <textarea
                      value={editState.code}
                      onChange={(e) => setEditState((s) => ({ ...s, code: e.target.value }))}
                      className="w-full bg-slate-900 text-slate-200 text-xs font-mono rounded px-3 py-2 border border-slate-700 focus:border-sky-500 focus:outline-none resize-y min-h-[120px] leading-relaxed"
                      spellCheck={false}
                    />
                  ) : rule.config.code ? (
                    <div className="bg-slate-900 rounded px-3 py-2">
                      <JsCode code={rule.config.code} />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {(rule.config.conditions ?? []).map((c, i) => (
                        <div key={i} className="text-xs text-slate-400 bg-slate-900 rounded px-3 py-1.5 font-mono">
                          {c.type}({Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join(', ')})
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pool Type Selector (only shown in edit mode) */}
                {editingId === rule.id && (
                  <div className="border border-slate-700 rounded-lg p-3 space-y-3">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5" /> 股票池
                    </h4>

                    {/* Toggle FIXED / DYNAMIC */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditState((s) => ({ ...s, poolType: 'FIXED' }))}
                        className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                          editState.poolType === 'FIXED'
                            ? 'bg-sky-500/20 border-sky-500/50 text-sky-400'
                            : 'border-slate-700 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        固定股票代號
                      </button>
                      <button
                        onClick={() => setEditState((s) => ({ ...s, poolType: 'DYNAMIC' }))}
                        className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                          editState.poolType === 'DYNAMIC'
                            ? 'bg-purple-500/20 border-purple-500/50 text-purple-400'
                            : 'border-slate-700 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        動態選股池
                      </button>
                    </div>

                    {editState.poolType === 'FIXED' ? (
                      <div>
                        <p className="text-xs text-slate-500 mb-1">股票代號（以逗號分隔）</p>
                        <input
                          value={editState.symbols}
                          onChange={(e) => setEditState((s) => ({ ...s, symbols: e.target.value }))}
                          className="w-full bg-slate-900 text-slate-200 text-xs font-mono rounded px-3 py-1.5 border border-slate-700 focus:border-sky-500 focus:outline-none"
                          placeholder="例：2330, 2317, 0050"
                        />
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs text-slate-500 mb-1">
                          篩選程式碼 — 接收 <code className="text-purple-400">stock</code> 與 <code className="text-purple-400">get_meta(stock, key)</code>，需回傳 boolean
                        </p>
                        <textarea
                          value={editState.poolFilterCode}
                          onChange={(e) => setEditState((s) => ({ ...s, poolFilterCode: e.target.value }))}
                          className="w-full bg-slate-900 text-purple-300 text-xs font-mono rounded px-3 py-2 border border-slate-700 focus:border-purple-500 focus:outline-none resize-y min-h-[60px]"
                          spellCheck={false}
                          placeholder={`return get_meta(stock, 'sector') === 'Semiconductors';`}
                        />
                        <p className="text-xs text-slate-600 mt-1">
                          可用的 key：<code>sector</code>、<code>name</code>、<code>dayTradeable</code>
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Pool filter display (read-only, only for DYNAMIC rules not in edit mode) */}
                {editingId !== rule.id && rule.poolType === 'DYNAMIC' && rule.poolFilterCode && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5" /> 股票池篩選條件
                    </h4>
                    <div className="bg-slate-900 rounded px-3 py-2">
                      <pre className="text-xs font-mono text-purple-300 whitespace-pre-wrap">{rule.poolFilterCode}</pre>
                    </div>
                  </div>
                )}

                {/* Backtest Results */}
                {backtest && (
                  <div className="border border-amber-900/30 rounded-lg p-3 bg-amber-950/10">
                    <h4 className="text-xs font-semibold text-amber-600/80 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <BarChart2 className="w-3.5 h-3.5" />
                      {isTrade ? '回測結果' : '信號歷史'}
                      <span className="ml-1 bg-amber-900/40 text-amber-500 px-1.5 py-0.5 rounded text-[10px] normal-case tracking-normal font-medium">BACKTEST</span>
                      {backtestDateRange[rule.id] && (
                        <span className="text-amber-900/60 font-normal normal-case tracking-normal ml-1">
                          {backtestDateRange[rule.id].startDate} – {backtestDateRange[rule.id].endDate}
                        </span>
                      )}
                    </h4>

                    {/* Trade: win/loss grid; Notify: signal count only */}
                    {isTrade ? (
                      <div className="grid grid-cols-4 gap-3 mb-3">
                        {[
                          { label: '總信號數', value: backtest.totalSignals, cls: 'text-slate-300' },
                          { label: '獲利', value: backtest.winCount, cls: 'text-emerald-400' },
                          { label: '虧損', value: backtest.lossCount, cls: 'text-red-400' },
                          {
                            label: '勝率',
                            value: `${backtest.winRate.toFixed(1)}%`,
                            cls: backtest.winRate >= 50 ? 'text-emerald-400' : 'text-red-400',
                          },
                        ].map((stat) => (
                          <div key={stat.label} className="bg-slate-900 rounded-lg p-3 text-center">
                            <p className="text-xs text-slate-500">{stat.label}</p>
                            <p className={`text-xl font-bold ${stat.cls}`}>{stat.value}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex gap-3 mb-3">
                        <div className="bg-slate-900 rounded-lg p-3 text-center flex-1">
                          <p className="text-xs text-slate-500">觸發次數</p>
                          <p className="text-2xl font-bold text-slate-300">{backtest.totalSignals}</p>
                        </div>
                        <div className="bg-slate-900 rounded-lg p-3 text-center flex-1">
                          <p className="text-xs text-slate-500">每週平均</p>
                          <p className="text-2xl font-bold text-slate-300">
                            {(backtest.totalSignals / (backtestDaysCount / 7)).toFixed(1)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Signal list — trade shows P/L, notify shows date + price only */}
                    {backtest.signals.length > 0 && (() => {
                      const isShowAll = showAllSignals[rule.id] ?? false;
                      const allReversed = [...backtest.signals].reverse();
                      const visible = isShowAll ? allReversed : allReversed.slice(0, 10);
                      return (
                        <div>
                          <div className="space-y-1 max-h-96 overflow-y-auto">
                            {visible.map((s, i) => (
                              <div key={i} className="flex items-center gap-3 text-xs text-slate-400 px-2 py-1">
                                <span className="text-slate-600 w-32 flex-shrink-0 tabular-nums">
                                  {formatSignalDate(s.date)}
                                </span>
                                <span className="font-medium text-slate-300 w-12 flex-shrink-0">{s.symbol}</span>
                                <span className={s.signal === 'BUY' ? 'text-emerald-400' : s.signal === 'SELL' ? 'text-red-400' : 'text-sky-400'}>
                                  {s.signal}
                                </span>
                                <span>${s.price.toFixed(2)}</span>
                                {isTrade && s.profitPercent !== undefined && (
                                  <span className={`ml-auto flex items-center gap-0.5 ${s.profitPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {s.profitPercent >= 0 ? (
                                      <TrendingUp className="w-3 h-3" />
                                    ) : (
                                      <TrendingDown className="w-3 h-3" />
                                    )}
                                    {s.profitPercent.toFixed(2)}%
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                          {backtest.signals.length > 10 && (
                            <button
                              onClick={() => setShowAllSignals((prev) => ({ ...prev, [rule.id]: !isShowAll }))}
                              className="mt-1.5 text-xs text-sky-500 hover:text-sky-400 w-full text-center py-1"
                            >
                              {isShowAll
                                ? '顯示較少'
                                : `顯示全部 ${backtest.signals.length} 個信號`}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Recent Live Triggers — entirely separate from backtest signals */}
                {rule.recentTriggers && rule.recentTriggers.length > 0 && (() => {
                  const isShowAllT = showAllTriggers[rule.id] ?? false;
                  const visible = isShowAllT ? rule.recentTriggers : rule.recentTriggers.slice(0, 5);
                  return (
                    <div className="border border-emerald-900/30 rounded-lg p-3 bg-emerald-950/10">
                      <h4 className="text-xs font-semibold text-emerald-600/80 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        即時觸發記錄
                        <span className="ml-1 flex items-center gap-1 bg-emerald-900/40 text-emerald-400 px-1.5 py-0.5 rounded text-[10px] normal-case tracking-normal font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          LIVE
                        </span>
                      </h4>
                      <div className="space-y-1">
                        {visible.map((t) => (
                          <div key={t.id} className="flex items-center gap-3 text-xs text-slate-400 px-2 py-1.5 bg-slate-900/60 rounded">
                            <span className={t.signal === 'BUY' ? 'badge-buy' : t.signal === 'SELL' ? 'badge-sell' : 'text-xs bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-full font-semibold'}>{t.signal}</span>
                            <span className="font-medium text-slate-300">{t.symbol}</span>
                            <span>${t.price}</span>
                            <span className="ml-auto text-slate-600 tabular-nums">
                              {new Date(t.triggeredAt).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                      {rule.recentTriggers.length > 5 && (
                        <button
                          onClick={() => setShowAllTriggers((prev) => ({ ...prev, [rule.id]: !isShowAllT }))}
                          className="mt-1.5 text-xs text-emerald-500 hover:text-emerald-400 w-full text-center py-1"
                        >
                          {isShowAllT
                            ? '顯示較少'
                            : `顯示全部 ${rule.recentTriggers.length} 筆記錄`}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

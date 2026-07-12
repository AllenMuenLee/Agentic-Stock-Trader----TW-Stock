'use client';

import { useState, useEffect, useCallback } from 'react';
import { Lock, Users, Star, Radio, RefreshCw, LogOut, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { adminApi, AdminStats, AdminUser, getAdminToken, setAdminToken, clearAdminToken } from '@/lib/admin-api';

function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setError('');
    setLoading(true);
    try {
      const { token } = await adminApi.login(password);
      setAdminToken(token);
      onSuccess();
    } catch {
      setError('密碼錯誤');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <form onSubmit={handleSubmit} className="w-full max-w-sm card p-6 space-y-4">
        <div className="text-center mb-2">
          <Lock className="w-6 h-6 text-sky-400 mx-auto mb-2" />
          <h1 className="text-lg font-semibold text-slate-200">管理員登入</h1>
        </div>
        <input
          className="input"
          type="password"
          placeholder="管理員密碼"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          disabled={loading}
        />
        {error && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? '驗證中…' : '登入'}
        </button>
      </form>
    </div>
  );
}

function StockBadge({ symbol, transport }: { symbol: string; transport: 'websocket' | 'restPolling' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
        transport === 'websocket'
          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
          : 'text-amber-400 bg-amber-500/10 border-amber-500/30'
      }`}
      title={transport === 'websocket' ? 'WebSocket 即時' : 'REST 輪詢（每 15 秒）'}
    >
      {symbol}
    </span>
  );
}

function UserTable() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await adminApi.getUsers());
    } catch {
      setUsers([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (user: AdminUser) => {
    if (!confirm(`確定要刪除使用者 ${user.email} 嗎？此操作將一併刪除其所有規則與交易紀錄，無法復原。`)) return;
    setDeletingId(user.id);
    try {
      await adminApi.deleteUser(user.id);
      setUsers((prev) => prev?.filter((u) => u.id !== user.id) ?? null);
    } catch {
      alert('刪除失敗，請稍後再試');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5 mb-3">
        <Users className="w-4 h-4 text-sky-400" />
        使用者管理（{users?.length ?? '…'}）
      </h2>
      {users === null ? (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-4 h-4 text-slate-500 animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <p className="text-sm text-slate-500">目前沒有使用者。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                <th className="pb-2 pr-3 font-medium">Email</th>
                <th className="pb-2 pr-3 font-medium">驗證狀態</th>
                <th className="pb-2 pr-3 font-medium">方案</th>
                <th className="pb-2 pr-3 font-medium">註冊時間</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="py-2 pr-3 text-slate-200">{u.email}</td>
                  <td className="py-2 pr-3">
                    {u.emailVerified ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> 已驗證
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                        <XCircle className="w-3.5 h-3.5" /> 未驗證
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{u.plan}</td>
                  <td className="py-2 pr-3 text-slate-500 tabular-nums">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => handleDelete(u)}
                      disabled={deletingId === u.id}
                      className="text-red-400 hover:text-red-300 disabled:opacity-50 inline-flex items-center gap-1 text-xs"
                      title="刪除使用者"
                    >
                      {deletingId === u.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await adminApi.getStats();
      setStats(s);
      setError('');
    } catch {
      setError('讀取失敗，密碼可能已過期');
      clearAdminToken();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const logout = () => {
    clearAdminToken();
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 text-slate-500 animate-spin" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center text-slate-400 text-sm">
        {error || '無法載入資料'}
        <button onClick={() => window.location.reload()} className="btn-ghost text-sm block mx-auto mt-4">
          重試
        </button>
      </div>
    );
  }

  const wsSet = new Set(stats.subscriptionBreakdown.websocket);
  const restSet = new Set(stats.subscriptionBreakdown.restPolling);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">管理後台</h1>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-ghost text-sm flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            重新整理
          </button>
          <button onClick={logout} className="btn-ghost text-sm flex items-center gap-1.5">
            <LogOut className="w-3.5 h-3.5" />
            登出
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <Users className="w-4 h-4" /> 總使用者數
          </div>
          <p className="text-3xl font-bold text-slate-100">{stats.totalUsers}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <Star className="w-4 h-4" /> 預約 399 方案
          </div>
          <p className="text-3xl font-bold text-slate-100">{stats.preRegistered.PLAN_399}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <Star className="w-4 h-4" /> 預約 799 方案
          </div>
          <p className="text-3xl font-bold text-slate-100">{stats.preRegistered.PLAN_799}</p>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
            <Radio className="w-4 h-4 text-sky-400" />
            目前監控股票（{stats.monitoredStocks.length}）
          </h2>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> WebSocket ({wsSet.size})
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400" /> REST 輪詢 ({restSet.size})
            </span>
          </div>
        </div>
        {stats.monitoredStocks.length === 0 ? (
          <p className="text-sm text-slate-500">目前沒有股票在監控中。</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {stats.monitoredStocks.map((symbol) => (
              <StockBadge key={symbol} symbol={symbol} transport={restSet.has(symbol) ? 'restPolling' : 'websocket'} />
            ))}
          </div>
        )}
      </div>

      <UserTable />
    </div>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    setAuthed(!!getAdminToken());
  }, []);

  if (authed === null) return null;
  if (!authed) return <LoginGate onSuccess={() => setAuthed(true)} />;
  return <Dashboard />;
}

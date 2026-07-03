'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrendingUp, UserPlus } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || !confirm) { setError('請填寫所有欄位'); return; }
    if (password !== confirm) { setError('兩次輸入的密碼不一致'); return; }
    setError('');
    setLoading(true);
    try {
      await register(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '註冊失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <TrendingUp className="w-8 h-8 text-sky-400" />
            <span className="text-2xl font-bold text-slate-100">AI股探</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-200">建立帳號</h1>
          <p className="text-sm text-slate-500 mt-1">加入AI股探，開始 AI 智能股票監控</p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">使用者名稱</label>
            <input
              className="input"
              placeholder="至少 3 個字元"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">密碼</label>
            <input
              className="input"
              type="password"
              placeholder="至少 6 個字元"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">確認密碼</label>
            <input
              className="input"
              type="password"
              placeholder="再次輸入密碼"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            {loading ? '建立中…' : '建立帳號'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-5">
          已有帳號？{' '}
          <Link href="/login" className="text-sky-400 hover:text-sky-300 transition-colors">
            立即登入
          </Link>
        </p>
      </div>
    </div>
  );
}

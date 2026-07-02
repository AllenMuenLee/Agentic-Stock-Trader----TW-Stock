'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrendingUp, LogIn } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) { setError('請填寫所有欄位'); return; }
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登入失敗');
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
            <span className="text-2xl font-bold text-slate-100">智股通</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-200">登入帳號</h1>
          <p className="text-sm text-slate-500 mt-1">歡迎回來，請輸入您的帳號資訊</p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">使用者名稱</label>
            <input
              className="input"
              placeholder="輸入使用者名稱"
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
              placeholder="輸入密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
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
            <LogIn className="w-4 h-4" />
            {loading ? '登入中…' : '登入'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-5">
          還沒有帳號？{' '}
          <Link href="/register" className="text-sky-400 hover:text-sky-300 transition-colors">
            立即註冊
          </Link>
        </p>
      </div>
    </div>
  );
}

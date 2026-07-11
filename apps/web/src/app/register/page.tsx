'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrendingUp, UserPlus, MailCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !confirm) { setError('請填寫所有欄位'); return; }
    if (password !== confirm) { setError('兩次輸入的密碼不一致'); return; }
    setError('');
    setLoading(true);
    try {
      await register(email, password);
      setRegistered(true);
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

        {registered ? (
          <div className="card p-6 text-center space-y-3">
            <MailCheck className="w-10 h-10 text-emerald-400 mx-auto" />
            <h2 className="text-slate-200 font-semibold">請查收您的 Email</h2>
            <p className="text-sm text-slate-400">
              我們已寄送驗證信至 <span className="text-slate-200">{email}</span>，請點擊信中的連結完成驗證後即可登入。
            </p>
            <Link href="/login" className="btn-primary w-full inline-flex items-center justify-center mt-2">
              前往登入
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
              <input
                className="input"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
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
        )}

        {!registered && (
          <p className="text-center text-sm text-slate-500 mt-5">
            已有帳號？{' '}
            <Link href="/login" className="text-sky-400 hover:text-sky-300 transition-colors">
              立即登入
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { LogIn, MailCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('請填寫所有欄位'); return; }
    setError('');
    setNeedsVerification(false);
    setResendState('idle');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登入失敗');
      if (err instanceof Error && (err as Error & { code?: string }).code === 'EMAIL_NOT_VERIFIED') {
        setNeedsVerification(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setResendState('sending');
    try {
      await api.resendVerification(email);
    } finally {
      setResendState('sent');
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <Image src="/Logo.png" alt="AI股探" width={32} height={32} className="rounded" />
            <span className="text-2xl font-bold text-slate-100">AI股探</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-200">登入帳號</h1>
          <p className="text-sm text-slate-500 mt-1">歡迎回來，請輸入您的帳號資訊</p>
        </div>

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

          {needsVerification && (
            <div className="text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 space-y-2">
              <p className="text-amber-400">尚未收到驗證信嗎？</p>
              {resendState === 'sent' ? (
                <p className="text-emerald-400 flex items-center gap-1.5">
                  <MailCheck className="w-3.5 h-3.5" /> 已重新寄送，請至信箱查看（若沒看到，也請確認垃圾郵件資料夾）
                </p>
              ) : (
                <button
                  type="button"
                  onClick={resend}
                  disabled={resendState === 'sending'}
                  className="btn-ghost text-xs"
                >
                  {resendState === 'sending' ? '寄送中…' : '重新寄送驗證信'}
                </button>
              )}
            </div>
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

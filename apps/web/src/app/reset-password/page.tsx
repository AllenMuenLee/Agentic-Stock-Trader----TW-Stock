'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { KeyRound, XCircle } from 'lucide-react';
import { api, extractErrorMessage } from '@/lib/api';

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) { setError('重設連結缺少必要參數'); return; }
    if (!password || !confirm) { setError('請填寫所有欄位'); return; }
    if (password !== confirm) { setError('兩次輸入的密碼不一致'); return; }
    if (password.length < 6) { setError('密碼至少需要 6 個字元'); return; }
    setError('');
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(extractErrorMessage(err, '重設密碼失敗'));
    } finally {
      setLoading(false);
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
          <h1 className="text-xl font-semibold text-slate-200">重設密碼</h1>
        </div>

        {!token ? (
          <div className="card p-6 text-center space-y-3">
            <XCircle className="w-10 h-10 text-red-400 mx-auto" />
            <p className="text-red-400">重設連結缺少必要參數，請重新申請。</p>
            <Link href="/forgot-password" className="btn-ghost w-full inline-flex items-center justify-center mt-2">
              重新申請重設密碼
            </Link>
          </div>
        ) : done ? (
          <div className="card p-6 text-center space-y-3">
            <KeyRound className="w-10 h-10 text-emerald-400 mx-auto" />
            <p className="text-slate-200 font-semibold">密碼已重設！</p>
            <Link href="/login" className="btn-primary w-full inline-flex items-center justify-center mt-2">
              前往登入
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">新密碼</label>
              <input
                className="input"
                type="password"
                placeholder="至少 6 個字元"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">確認新密碼</label>
              <input
                className="input"
                type="password"
                placeholder="再次輸入新密碼"
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
              <KeyRound className="w-4 h-4" />
              {loading ? '重設中…' : '重設密碼'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

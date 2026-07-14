'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Send, MailCheck } from 'lucide-react';
import { api, extractErrorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { setError('請輸入 Email'); return; }
    setError('');
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(extractErrorMessage(err, '請求失敗，請稍後再試'));
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
          <h1 className="text-xl font-semibold text-slate-200">忘記密碼</h1>
          <p className="text-sm text-slate-500 mt-1">輸入您註冊時使用的 Email，我們會寄送重設密碼連結給您</p>
        </div>

        {sent ? (
          <div className="card p-6 text-center space-y-3">
            <MailCheck className="w-10 h-10 text-emerald-400 mx-auto" />
            <h2 className="text-slate-200 font-semibold">請查收您的 Email</h2>
            <p className="text-sm text-slate-400">
              若 <span className="text-slate-200">{email}</span> 已註冊，我們已寄送重設密碼連結。
            </p>
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              📌 沒看到信件嗎？請確認「垃圾郵件」或「促銷」資料夾。
            </p>
            <Link href="/login" className="btn-ghost w-full inline-flex items-center justify-center mt-2">
              返回登入頁
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
                autoFocus
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
              <Send className="w-4 h-4" />
              {loading ? '寄送中…' : '寄送重設密碼連結'}
            </button>
          </form>
        )}

        {!sent && (
          <p className="text-center text-sm text-slate-500 mt-5">
            想起密碼了？{' '}
            <Link href="/login" className="text-sky-400 hover:text-sky-300 transition-colors">
              返回登入
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

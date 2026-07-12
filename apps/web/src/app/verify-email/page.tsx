'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('驗證連結缺少必要參數');
      return;
    }
    api.verifyEmail(token)
      .then((res) => {
        setStatus('success');
        setMessage(res.message);
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : '驗證失敗');
      });
  }, [token]);

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center gap-2 mb-6">
          <Image src="/Logo.png" alt="AI股探" width={32} height={32} className="rounded" />
          <span className="text-2xl font-bold text-slate-100">AI股探</span>
        </div>

        <div className="card p-6 space-y-3">
          {status === 'verifying' && (
            <>
              <RefreshCw className="w-8 h-8 text-sky-400 mx-auto animate-spin" />
              <p className="text-slate-300">驗證中…</p>
            </>
          )}
          {status === 'success' && (
            <>
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <p className="text-slate-200 font-semibold">{message}</p>
              <Link href="/login" className="btn-primary w-full inline-flex items-center justify-center mt-2">
                前往登入
              </Link>
            </>
          )}
          {status === 'error' && (
            <>
              <XCircle className="w-10 h-10 text-red-400 mx-auto" />
              <p className="text-red-400">{message}</p>
              <Link href="/login" className="btn-ghost w-full inline-flex items-center justify-center mt-2">
                返回登入頁
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}

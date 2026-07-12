'use client';

import Link from 'next/link';
import Image from 'next/image';
import { TrendingUp, Bot, Bell, BarChart2, Shield, Zap } from 'lucide-react';
import { useAuth } from '@/lib/auth';

const features = [
  {
    icon: Bot,
    title: 'AI 智能分析',
    desc: '用自然語言描述您的股票策略，AI 自動轉換成可執行的監控規則。',
    color: 'text-sky-400',
    bg: 'bg-sky-500/10 border-sky-500/20',
  },
  {
    icon: Bell,
    title: '即時通知',
    desc: '透過 Email、LINE、Discord 即時接收股票信號通知，掌握每一個交易機會。',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  {
    icon: BarChart2,
    title: '歷史回測',
    desc: '在部署規則之前，使用歷史數據回測您的策略，驗證勝率與效果。',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/20',
  },
  {
    icon: Zap,
    title: '動態選股池',
    desc: '設定自訂篩選條件，自動從股票市場中挑選符合條件的標的。',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
  },
  {
    icon: Shield,
    title: '安全可靠',
    desc: '規則執行於沙盒環境中，系統 24 小時不間斷監控，保障您的帳號安全。',
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
  },
  {
    icon: TrendingUp,
    title: '多元指標',
    desc: '支援 SMA、EMA、RSI、布林通道、成交量等多種技術指標組合策略。',
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/10 border-indigo-500/20',
  },
];

export default function HomePage() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-sky-900/20 via-slate-950 to-slate-950 pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-sky-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-5xl mx-auto px-6 py-24 text-center">
          <Image src="/Logo.png" alt="AI股探" width={72} height={72} className="mx-auto mb-6 rounded-2xl" priority />

          <div className="inline-flex items-center gap-2 bg-sky-500/10 border border-sky-500/20 rounded-full px-4 py-1.5 text-sky-400 text-sm font-medium mb-8">
            <TrendingUp className="w-4 h-4" />
            AI 驅動的股票監控平台
          </div>

          <h1 className="text-5xl sm:text-6xl font-bold text-slate-100 mb-6 leading-tight tracking-tight">
            AI股探
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400 mt-1">
              讓 AI 替您看盤
            </span>
          </h1>

          <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            用自然語言描述您的股票策略，系統自動生成監控規則，
            在關鍵時刻即時通知您。告別盯盤，讓 AI 成為您的最佳看盤助手。
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {user ? (
              <Link href="/chat" className="btn-primary text-base px-8 py-3 rounded-xl flex items-center gap-2">
                <Bot className="w-5 h-5" />
                前往 AI 助手
              </Link>
            ) : (
              <>
                <Link href="/register" className="btn-primary text-base px-8 py-3 rounded-xl flex items-center gap-2">
                  免費開始使用
                </Link>
                <Link href="/login" className="btn-ghost text-base px-8 py-3 rounded-xl border border-slate-700">
                  登入帳號
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-20 w-full">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold text-slate-100 mb-3">為什麼選擇AI股探？</h2>
          <p className="text-slate-400">強大的功能，簡單的操作，讓股票監控更聰明</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map(({ icon: Icon, title, desc, color, bg }) => (
            <div key={title} className={`card p-6 border ${bg} hover:scale-[1.01] transition-transform`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${bg}`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <h3 className={`font-semibold mb-2 ${color}`}>{title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      {!user && (
        <section className="border-t border-slate-800 bg-slate-900/50">
          <div className="max-w-2xl mx-auto px-6 py-16 text-center">
            <h2 className="text-2xl font-bold text-slate-100 mb-3">立即開始智能監控</h2>
            <p className="text-slate-400 mb-8">免費註冊，幾分鐘內設定您的第一條監控規則</p>
            <Link href="/register" className="btn-primary text-base px-10 py-3 rounded-xl">
              免費建立帳號
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, LayoutDashboard, Settings, TrendingUp, LogOut, User, BookOpen, CreditCard } from 'lucide-react';
import { useAuth } from '@/lib/auth';

const links = [
  { href: '/chat', label: 'AI 助手', icon: MessageSquare },
  { href: '/dashboard', label: '監控儀表板', icon: LayoutDashboard },
  { href: '/plans', label: '訂閱方案', icon: CreditCard },
  { href: '/settings', label: '帳號設定', icon: Settings },
];

export default function NavBar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-2">
        <Link href="/" className="flex items-center gap-2 mr-6">
          <TrendingUp className="w-5 h-5 text-sky-400" />
          <span className="font-bold text-slate-100 text-sm">AI股探</span>
        </Link>

        {user && links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              pathname.startsWith(href)
                ? 'bg-sky-600/20 text-sky-400'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}

        <Link
          href="/docs"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ml-auto ${
            pathname.startsWith('/docs')
              ? 'bg-sky-600/20 text-sky-400'
              : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          API 文件
        </Link>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <div className="flex items-center gap-1.5 text-sm text-slate-400 px-2">
                <User className="w-4 h-4" />
                <span className="hidden sm:inline">{user.username}</span>
              </div>
              <button
                onClick={logout}
                className="btn-ghost flex items-center gap-1.5 text-sm"
                title="登出"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">登出</span>
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost text-sm px-3 py-1.5">登入</Link>
              <Link href="/register" className="btn-primary text-sm px-3 py-1.5">註冊</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

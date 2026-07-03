import type { Metadata } from 'next';
import './globals.css';
import NavBar from '@/components/NavBar';
import SignalToast from '@/components/SignalToast';
import { AuthProvider } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'AI股探 — AI 股票監控系統',
  description: 'AI 驅動的股票信號監控系統',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen flex flex-col">
        <AuthProvider>
          <NavBar />
          <main className="flex-1 flex flex-col">{children}</main>
          <SignalToast />
        </AuthProvider>
      </body>
    </html>
  );
}

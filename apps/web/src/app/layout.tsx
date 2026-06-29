import type { Metadata } from 'next';
import './globals.css';
import NavBar from '@/components/NavBar';
import SignalToast from '@/components/SignalToast';

export const metadata: Metadata = {
  title: 'Agentic Stock Notifier',
  description: 'AI-powered stock signal monitoring system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen flex flex-col">
        <NavBar />
        <main className="flex-1 flex flex-col">{children}</main>
        <SignalToast />
      </body>
    </html>
  );
}

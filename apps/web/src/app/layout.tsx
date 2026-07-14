import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import NavBar from '@/components/NavBar';
import SignalToast from '@/components/SignalToast';
import { AuthProvider } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'AI股探 — AI 股票監控系統',
  description: 'AI 驅動的股票信號監控系統',
  icons: { icon: '/Logo.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen flex flex-col">
        {/* Google tag (gtag.js) — loaded via next/script so every page gets it without blocking hydration. */}
        <Script async src="https://www.googletagmanager.com/gtag/js?id=AW-18321827835" strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'AW-18321827835');
          `}
        </Script>
        <AuthProvider>
          <NavBar />
          <main className="flex-1 flex flex-col">{children}</main>
          <SignalToast />
        </AuthProvider>
      </body>
    </html>
  );
}

/** @type {import('next').NextConfig} */
const config = {
  // Allow long-running backtest requests (default proxy timeout is too short
  // for large dynamic pool backtests).
  experimental: {
    proxyTimeout: 300_000, // 5 minutes
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default config;

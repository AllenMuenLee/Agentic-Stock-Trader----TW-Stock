/** @type {import('next').NextConfig} */
const config = {
  // Allow long-running backtest requests (default proxy timeout is too short
  // for large dynamic pool backtests).
  experimental: {
    proxyTimeout: 300_000, // 5 minutes
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ];
  },
};

export default config;

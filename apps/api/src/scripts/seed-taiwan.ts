/**
 * One-shot script: seeds 100 days of daily bars for every stock listed on
 * TWSE (上市) and TPEx (上櫃). Run this once to pre-populate historical data.
 *
 * Usage:
 *   npx tsx src/scripts/seed-taiwan.ts
 *
 * On subsequent runs, symbols that already have bars from the last 7 days are
 * skipped automatically, so re-running is safe and fast.
 */

import { YFinanceService } from '../services/yfinance.service.js';

const yfinance = new YFinanceService();

async function main() {
  console.log('[seed-taiwan] Starting one-shot Taiwan stock seed...');
  await yfinance.seedAllTaiwanDailyBars();
  console.log('[seed-taiwan] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-taiwan] Fatal error:', err);
  process.exit(1);
});

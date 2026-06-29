/**
 * One-shot cleanup: removes all historical bar data that is no longer used.
 * - Deletes every interval except '1m' (old 1d, 5m, 15m, 30m, 1h rows from previous seeding)
 * - Deletes 1m rows older than 7 days (beyond Yahoo Finance's 1m history limit)
 *
 * Usage:
 *   npx tsx src/scripts/cleanup-db.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [{ count: oldIntervals }, { count: stale1m }] = await Promise.all([
    prisma.stockPrice.deleteMany({ where: { interval: { not: '1m' } } }),
    prisma.stockPrice.deleteMany({ where: { interval: '1m', date: { lt: cutoff } } }),
  ]);

  console.log(`Deleted ${oldIntervals} non-1m rows (1d / 5m / 15m / 30m / 1h)`);
  console.log(`Deleted ${stale1m} stale 1m rows (older than ${cutoff.toISOString().slice(0, 10)})`);
  console.log('Done.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());

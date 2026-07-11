// ─── Taiwan stock market session & order-type routing ──────────────────────
//
// INTENTIONAL DUPLICATE of packages/shared/src/market-session.ts. apps/trading-app
// is distributed to end users as a standalone zip (GET /api/trading-app/download
// in apps/api/src/routes/trading-app.ts excludes node_modules — the user runs
// `npm install` in isolation from this monorepo), so it cannot depend on the
// unpublished `@stock-notifier/shared` workspace package (a `"*"` version range
// would fail to resolve outside the monorepo). Keep this file in sync with the
// shared version by hand if the Taiwan session/routing rules ever change.
//
// Pure, side-effect-free helpers for Taiwan (TWSE/TPEx) trading mechanics:
//   - 盤中整股 (continuous, 09:00–13:30, 1000-share 張 lots)
//   - 盤中零股 (intraday odd lot, 09:00–13:30, 1–999 shares)
//   - 盤後定價 (after-hours fixed price, 14:00–14:30, whole 張 only, priced at
//     today's close)
//   - 盤後零股 (after-hours odd lot, 13:40–14:30, 1–999 shares)
//
// Known limitations (documented, not silently assumed):
//   - No TWSE holiday calendar — session detection is weekday + time-of-day
//     only, so a rule could still be told "market open" on a national holiday.
//   - No auction-microstructure modeling — 零股/盤後定價 fills are approximated
//     using whatever reference price the caller supplies (e.g. latest tick or
//     bar close), not a real 5-second call-auction clearing price.
//   - marketType is NEVER taken from caller input — it's mechanically derived
//     from quantity + current session, since an incorrect marketType would
//     produce an invalid order at the exchange.

export type TaiwanMarketType = 'Common' | 'Odd' | 'Fixing';
export type TaiwanPriceType = 'Limit' | 'Market';
export type TaiwanTimeInForce = 'ROD' | 'IOC' | 'FOK';

export interface MarketSessionInfo {
  session: 'INTRADAY' | 'AFTER_HOURS_ODD' | 'AFTER_HOURS_FIXED_AND_ODD' | 'CLOSED';
  intraday: boolean;
  afterHoursOdd: boolean;
  afterHoursFixed: boolean;
  taipeiTime: string;
}

export interface OrderRouting {
  allowed: boolean;
  reason: string | null;
  marketType: TaiwanMarketType | null;
  priceType: TaiwanPriceType | null;
  timeInForce: TaiwanTimeInForce | null;
  quantity: number;
  limitPrice: number | null;
  note: string | null;
}

function taipeiParts(unixSeconds: number): { weekday: number; hour: number; minute: number; label: string } {
  const date = new Date(unixSeconds * 1000);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const weekdayLabel = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[weekdayLabel] ?? 0;
  const label = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { weekday, hour, minute, label };
}

export function getMarketSession(unixSeconds: number): MarketSessionInfo {
  const { weekday, hour, minute, label } = taipeiParts(unixSeconds);
  const minutes = hour * 60 + minute;
  const isWeekday = weekday >= 1 && weekday <= 5;

  const intraday = isWeekday && minutes >= 540 && minutes < 810; // 09:00–13:30
  const afterHoursOdd = isWeekday && minutes >= 820 && minutes < 870; // 13:40–14:30
  const afterHoursFixed = isWeekday && minutes >= 840 && minutes < 870; // 14:00–14:30

  let session: MarketSessionInfo['session'] = 'CLOSED';
  if (intraday) session = 'INTRADAY';
  else if (afterHoursFixed) session = 'AFTER_HOURS_FIXED_AND_ODD';
  else if (afterHoursOdd) session = 'AFTER_HOURS_ODD';

  return { session, intraday, afterHoursOdd, afterHoursFixed, taipeiTime: label };
}

export function resolveOrderRouting(
  requestedQuantity: number,
  unixSeconds: number,
  referencePrice: number | undefined,
  overrides?: { priceType?: TaiwanPriceType; timeInForce?: TaiwanTimeInForce; limitPrice?: number },
): OrderRouting {
  const notAllowed = (reason: string): OrderRouting => ({
    allowed: false,
    reason,
    marketType: null,
    priceType: null,
    timeInForce: null,
    quantity: Math.max(0, Math.trunc(requestedQuantity) || 0),
    limitPrice: null,
    note: null,
  });

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    return notAllowed('委託股數必須為正整數');
  }
  const requested = Math.trunc(requestedQuantity);
  const session = getMarketSession(unixSeconds);

  if (!session.intraday && !session.afterHoursOdd && !session.afterHoursFixed) {
    return notAllowed(`台股目前非交易時段（台北時間 ${session.taipeiTime}）`);
  }

  const isLotMultiple = requested >= 1000;
  let marketType: TaiwanMarketType;
  let quantity: number;

  if (session.intraday) {
    marketType = isLotMultiple ? 'Common' : 'Odd';
    quantity = isLotMultiple ? Math.floor(requested / 1000) * 1000 : requested;
  } else if (session.afterHoursFixed && isLotMultiple) {
    marketType = 'Fixing';
    quantity = Math.floor(requested / 1000) * 1000;
  } else if (session.afterHoursOdd && !isLotMultiple) {
    marketType = 'Odd';
    quantity = requested;
  } else {
    const reason = isLotMultiple
      ? `目前僅零股交易開放（台北時間 ${session.taipeiTime}），股數需為 1–999 股`
      : `目前非零股交易時段（台北時間 ${session.taipeiTime}）`;
    return notAllowed(reason);
  }

  if (quantity <= 0) {
    return notAllowed('股數不足以構成一筆有效委託');
  }

  let priceType: TaiwanPriceType;
  let timeInForce: TaiwanTimeInForce;
  let note: string | null = null;

  if (marketType === 'Odd') {
    if ((overrides?.priceType && overrides.priceType !== 'Limit') || (overrides?.timeInForce && overrides.timeInForce !== 'ROD')) {
      note = '零股交易僅允許限價 ROD，已自動調整委託條件';
    }
    priceType = 'Limit';
    timeInForce = 'ROD';
  } else if (marketType === 'Fixing') {
    if ((overrides?.priceType && overrides.priceType !== 'Market') || (overrides?.timeInForce && overrides.timeInForce !== 'ROD')) {
      note = '盤後定價僅能以當日收盤價、ROD 方式委託，已自動調整委託條件';
    }
    priceType = 'Market';
    timeInForce = 'ROD';
  } else {
    priceType = overrides?.priceType ?? 'Market';
    timeInForce = overrides?.timeInForce ?? 'ROD';
  }

  let limitPrice: number | null = null;
  if (priceType === 'Limit') {
    const candidate = overrides?.limitPrice ?? referencePrice ?? null;
    if (candidate === null || !Number.isFinite(candidate) || candidate <= 0) {
      return notAllowed('限價委託需要有效的參考價格，但目前無可用價格');
    }
    limitPrice = candidate;
  }

  return { allowed: true, reason: null, marketType, priceType, timeInForce, quantity, limitPrice, note };
}

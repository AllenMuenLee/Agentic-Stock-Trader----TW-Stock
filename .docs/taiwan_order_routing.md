# Taiwan Market Session & Order-Type Routing

Implemented 2026-07-11. Adds Taiwan stock exchange trading-session and order-type
rules — previously entirely unmodeled — into the AI rule-code contract, the live
signal path, the backtest simulator, and the actual Fubon order placement.

## Why

An audit found none of the following was modeled anywhere in the codebase:
- Trading sessions: 盤中整股 (09:00–13:30, 1000-share 張 lots), 盤中零股 (same
  window, 1–999 shares), 盤後定價 (14:00–14:30, whole 張 at today's close),
  盤後零股 (13:40–14:30, 1–999 shares).
- Order types: 限價/市價 (limit/market), 時效 ROD/IOC/FOK.
- `apps/trading-app/python/fubon_bridge.py` hardcoded every order to
  `MarketType.Common` + `PriceType.Market` + `TimeInForce.ROD` — no odd-lot, no
  after-hours, no limit price.
- No lot-size validation anywhere except the live `'ALL'`-BUY path.
- No trading-hours awareness anywhere.
- The backtest (`runBacktest`) filled any share count instantly at bar close,
  with no minimum-commission floor.

## Design

### Canonical routing logic: `resolveOrderRouting()`

`packages/shared/src/market-session.ts` (pure, no I/O) exports:
- `getMarketSession(unixSeconds)` — Taipei weekday/time-of-day session lookup.
  **No TWSE holiday calendar** — a known, documented limitation.
- `resolveOrderRouting(requestedQuantity, unixSeconds, referencePrice, overrides?)`
  → `{ allowed, reason, marketType, priceType, timeInForce, quantity, limitPrice, note }`.
  - `marketType` (`'Common' | 'Odd' | 'Fixing'`) is **always mechanically derived**
    from quantity + session — never taken from caller/AI input.
  - Quantity is clamped **down** to a valid lot size (e.g. 1500 → 1000 during
    整股 hours) — no auto-split into a second odd-lot order for the remainder.
  - 零股 (Odd) forces 限價 ROD; 盤後定價 (Fixing) forces 市價 ROD at the close —
    both non-negotiable regardless of `overrides`. 整股 (Common) accepts free
    `priceType`/`timeInForce` overrides, defaulting to Market/ROD.

`apps/trading-app` is distributed as a **standalone zip** to end users
(`GET /api/trading-app/download` excludes `node_modules`; they `npm install`
outside the monorepo), so it cannot depend on the unpublished
`@stock-notifier/shared` workspace package. `apps/trading-app/src/market-session.ts`
is an **intentional duplicate** — keep both files in sync by hand if the Taiwan
rules ever change.

### AI rule-code contract

Two new sandbox helpers (documented for the AI in `.docs/helper_functions.md`
§5–6 and in `apps/api/src/services/gemini.service.ts`'s system prompt):
- `get_market_session()` — check whether/what kind of trading is open.
- `resolve_order_type(quantity)` — get the exact routing a signal should use.

The rule return contract gained **optional** fields — `priceType`, `timeInForce`,
`limitPrice` — validated in `apps/api/src/engine/sandbox.ts`'s `validateResult()`.
`marketType` is never accepted from rule code. When a rule omits these fields
entirely (the common case — old rules keep working unchanged), the server
still calls `resolveOrderRouting()` with no overrides, so every signal ends up
with correct, session-valid routing regardless of whether the AI used the helper.

### Two resolution points: server vs. trading-app

`quantity: 'ALL'` is never resolved on the API server (it doesn't know real
account balance) — routing for `'ALL'` signals is left unresolved on the wire
and resolved fresh in `apps/trading-app/src/server.ts`'s `executeOrder()`,
**recomputed against the current wall-clock time** right before sending to
Fubon (not reused from the signal-time preview) — the user may confirm well
after the signal fired, and the session can change in between. Concrete
quantities are resolved once, server-side, in `apps/api/src/index.ts` (live)
and `runBacktest()` (backtest), and that resolution is shown as a preview in
the trading-app's pending-order card.

### Data flow (concrete quantity)

```
rule code (optional hints) → sandbox.ts validateResult()
  → rule-engine.ts RuleResult
  → index.ts: resolveOrderRouting(quantity, currTimeSec, tick.price, hints)
  → Trigger row (marketType/priceType/timeInForce/limitPrice/orderAllowed/orderNote)
  → SignalPayloadDto → socket 'signal'/'notification'
  → trading-app PendingOrder (preview)
  → executeOrder(): resolveOrderRouting() again, fresh clock
  → FubonClient.placeOrder() → fubon_bridge.py → fubon_neo.sdk.Order(...)
  → activity-log.ts / POST /api/trading-app/activity → TradeActivity row
```

### Backtest

`runBacktest()` (`apps/api/src/services/yfinance.service.ts`) now:
- Calls `resolveOrderRouting()` for both BUY and SELL, using the clamped
  quantity for the simulated fill; skips the bar (same pattern as the existing
  insufficient-cash/-shares skip) when routing isn't `allowed`.
- Applies a `MIN_COMMISSION = 20` (NT$20) floor via `commissionFor(gross)`,
  previously a pure-percentage calculation with no floor — this matters most
  for small/odd-lot trades.
- Records `marketType`/`priceType`/`timeInForce`/`limitPrice` on each
  `signals[]` entry.
- Daily-bar backtests have no real intraday timestamp (each bar just marks a
  calendar day at midnight) — `data-context.ts`'s new `taipeiTradingInstant()`
  synthesizes 09:01 Taipei on that day so session-aware helpers don't always
  read as "market closed" against a literal midnight bar.

## Scope limits (deliberate, not oversights)

- **No multi-leg split orders.** A clamped remainder (e.g. the 500 left over
  from a 1500-share request during 整股 hours) is dropped, not placed as a
  second 零股 order.
- **No TWSE holiday calendar.** Weekday + time-of-day only.
- **Fubon SDK enum names are unverified.** `MarketType.Odd`/`MarketType.Fixing`
  and the `Order(price=...)` kwarg in `fubon_bridge.py` follow the same
  "written from general SDK knowledge, not checked against live docs" caveat
  already standing for the rest of that file — verify before real-money use.
- **零股/盤後定價 backtest fills** still use bar close as the reference price —
  no 5-second call-auction microstructure is modeled.

## Files touched

- `packages/shared/src/market-session.ts` (new), `types.ts`, `index.ts`
- `apps/api/prisma/schema.prisma` — `Trigger`/`TradeActivity` gained
  `marketType`/`priceType`/`timeInForce`/`limitPrice` (+ `orderAllowed`/`orderNote`
  on `Trigger`)
- `apps/api/src/engine/data-context.ts`, `sandbox.ts`, `rule-engine.ts`
- `apps/api/src/services/gemini.service.ts`, `yfinance.service.ts`
- `apps/api/src/index.ts`, `src/routes/trading-app.ts`
- `apps/trading-app/src/market-session.ts` (new, duplicated), `signal-listener.ts`,
  `pending-orders.ts`, `server.ts`, `fubon-client.ts`, `activity-log.ts`
- `apps/trading-app/python/fubon_bridge.py`
- `apps/trading-app/public/index.html`, `app.js`, `style.css`
- `apps/web/src/components/TradingActivityPanel.tsx`, `src/app/dashboard/page.tsx`

## Known bug caught during verification (fixed)

`sandbox.ts`'s `validateResult()` originally checked `obj.limitPrice !== undefined`,
which treated an explicit `limitPrice: null` (the correct value for a Market
order when a rule spreads `...routing` into its return object) as an invalid
value and rejected the whole signal. Fixed by checking `!= null` instead for
`priceType`/`timeInForce`/`limitPrice`.

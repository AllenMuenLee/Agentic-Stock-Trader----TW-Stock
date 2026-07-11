# Agentic Stock Notifier — Project Structure (ver_0)

Snapshot as of 2026-07-11. This is a full-stack AI-driven Taiwan stock
monitoring and (optionally) automated-trading system, built as an npm
workspaces monorepo.

## Monorepo layout

```
apps/
  api/            Node.js + Express + Socket.io + TypeScript — the central server (port 3001)
  web/            Next.js 14 + Tailwind — the dashboard/chat frontend (port 3000)
  trading-app/    Standalone local Node app — places real Fubon orders, distributed as a zip
packages/
  shared/         Shared TypeScript types + pure logic, consumed by api and web
.docs/            Project reference docs (this file, helper_functions.md, taiwan_order_routing.md)
.implementation_prompt/   Original build-out prompts this project was implemented from
```

Root `package.json` workspaces: `apps/*`, `packages/*`. `npm run dev` starts
`apps/api` + `apps/web` concurrently; `apps/trading-app` is launched
separately by an end user (`npm run dev` inside its own downloaded copy).

## `packages/shared` — shared types & pure logic

- `src/types.ts` — every cross-workspace DTO/type: `TickData`, `OHLCVBar`,
  `RuleConfig`, `RuleResult`, `SignalPayloadDto`, `TriggerDto`, `RuleDto`,
  `ReportTradeActivityDto`/`TradeActivityDto`, `ReportAccountSnapshotDto`,
  `PlanDefinition`/`PlanStatus`, `BacktestResult`.
- `src/market-session.ts` — pure Taiwan trading-session/order-routing logic
  (`getMarketSession`, `resolveOrderRouting`) — see "Taiwan order routing"
  below. **Duplicated** (not imported) into `apps/trading-app/src/market-session.ts`
  because the trading-app is distributed standalone and can't depend on this
  unpublished workspace package.
- Resolves via `dist/` (built by `tsc`) — after editing `src/`, run
  `npm run build` in this package before other workspaces will see the change.

## `apps/api` — the central server

**Stack**: Express + Socket.io + Prisma/SQLite + TypeScript, `tsx watch` in dev.

### Rule engine (`src/engine/`)
- `sandbox.ts` — `runRuleCode(code, dataContext)`: executes AI-generated
  JavaScript in a restricted Node `vm` (250ms timeout, forbidden-identifier
  denylist, output validation via `validateResult`). Also `runPoolFilter` for
  dynamic-pool filter code.
- `data-context.ts` — builds the `DataContext` object exposed to sandboxed
  rule code. Three builders: `loadDataContext` (live, Redis+SQL), `buildBarContext`
  (backtest, daily bars), `buildIntradayBarContext` (backtest, intraday bars).
  Exposes `get_data`/`get_detail`/`get_price`/`get_indicator`/`get_meta`/
  `get_bars`/`get_candle`/`get_position`/`get_cash`/`get_market_session`/
  `resolve_order_type` — see `.docs/helper_functions.md` for the full
  AI-facing reference.
- `rule-engine.ts` — `RuleEngine.evaluate()`: runs code-based rules through
  the sandbox, or legacy declarative `conditions`/`logic` rules through a
  built-in condition evaluator (`PRICE_ABOVE`, `MA_CROSS_ABOVE`, `RSI_OVERSOLD`, …).
- `indicators.ts` — SMA, EMA, RSI, Bollinger Bands, N-day high/low, avg volume.

### Services (`src/services/`)
- `gemini.service.ts` — `GeminiService`: chats with Google's Generative
  Language API, extracts `CREATE_RULE` JSON from the AI's response. The
  system prompt (in Chinese) is the authoritative spec for what AI-generated
  rule code may read/return.
- `yfinance.service.ts` — `YFinanceService`: fetches historical/intraday bars
  from Yahoo Finance's v8 chart API (direct axios, not the `yahoo-finance2`
  package), caches into SQL `StockPrice`, and implements `runBacktest()` — the
  full backtest simulator (real position tracking, commission/tax, Taiwan
  order routing — see below).
- `fugle.service.ts` — live tick feed via `@fugle/realtime` WebSocket, with a
  simulation-mode fallback (mock ticks) when no API key is configured.
- `redis.service.ts` — hot/recent tick storage (sorted sets), in-memory
  fallback when Redis is unreachable.
- `notification.service.ts` — email/LINE/Discord push notifications.
- `usage.service.ts` — daily quota enforcement for `FREE`/`PLAN_399`/`PLAN_799`.

### Routes (`src/routes/`)
`auth`, `bind` (LINE/Discord account linking), `chat` (AI chat + rule
creation), `rules` (CRUD + backtest trigger), `settings`, `stocks`, `plans`,
`webhooks`, `trading-app` (activity/account reporting from the trading-app,
zip download).

### Entry point (`src/index.ts`)
Boots Express + Socket.io, subscribes to live ticks via `fugle.onTick`, and on
every tick: loads a shared `DataContext`, evaluates every matching FIXED/DYNAMIC
rule, resolves Taiwan order routing for concrete quantities, persists a
`Trigger` row, and broadcasts a `SignalPayloadDto` over Socket.io
(`signal`/`notification` events) plus push notifications.

### Database (`prisma/schema.prisma`, SQLite via `dev.db`)
`User` (with plan/quota fields), `Rule` (JSON-serialized `RuleConfig` +
pool type), `Trigger` (per-fire record, now carries resolved order routing),
`StockPrice` (OHLCV cache, multi-interval), `SymbolMeta`, `TradeActivity`
(trading-app-reported order outcomes, now carries order routing too),
`AccountSnapshot` (cached Fubon cash/positions), `ChatMessage`.

## `apps/web` — dashboard frontend

Next.js 14 App Router + Tailwind. Pages: `/` (landing), `/login`, `/register`,
`/chat` (AI rule-building conversation), `/dashboard` (rule list, backtest
panel, trigger history, `TradingActivityPanel`), `/plans` (subscription tiers
+ trading-app download), `/settings`, `/docs`. `lib/api.ts` is the typed
fetch wrapper against `apps/api`; `lib/auth.tsx` holds the JWT auth context.

## `apps/trading-app` — standalone local trading app

Distributed as a **zip** (`GET /api/trading-app/download`, gated by plan,
excludes `node_modules`/`dist`/`.env`) for users to run on their own machine
against their own Fubon brokerage session — the main server never sees Fubon
credentials.

- `server.ts` — Express app bound to `127.0.0.1` only, serves the `public/`
  single-page UI, handles connect/disconnect, pending-order confirm/reject,
  and `executeOrder()` (the only place that actually calls Fubon).
- `signal-listener.ts` — Socket.io client to `apps/api`, forwards BUY/SELL
  signals to `handleSignal()`.
- `pending-orders.ts` — in-memory queue; every signal becomes a `PendingOrder`
  requiring explicit user confirmation before any order is sent — never
  auto-executed.
- `fubon-client.ts` — spawns `python/fubon_bridge.py` as a subprocess,
  talks newline-delimited JSON over stdio (Fubon's official SDK is Python-only).
- `python/fubon_bridge.py` — the actual `fubon_neo` SDK calls (login,
  placeOrder, getAccount, logout). **Exact class/enum names are unverified
  against live Fubon docs** — written from general SDK knowledge.
- `account-sync.ts` — polls Fubon cash/positions every ~15s, pushes to
  `apps/api` so rule code's `get_position`/`get_cash` have live data.
- `activity-log.ts` — local JSONL trade log (`~/.stock-notifier-trader/activity.log`)
  + reports outcomes back to `apps/api` for dashboard visibility.
- `market-session.ts` — **duplicated** copy of `packages/shared/src/market-session.ts`
  (see rationale above).
- `public/` — vanilla JS/HTML/CSS UI, no bundler. Connect form, pending-order
  cards, activity table.
- Supports a bundled Fubon **simulation** account/cert for safe testing
  without a real brokerage account.

## Cross-cutting feature: AI rule-code contract

A `Rule.config` is JSON with either:
1. **`code`** (preferred) — AI-generated JavaScript executed per-tick (live)
   or per-bar (backtest) in the sandbox, returning `{ signal, message, quantity?, priceType?, timeInForce?, limitPrice? }` or `null`.
2. **`conditions`/`logic`** (legacy) — declarative condition arrays.

`quantity` is share count (1 張 = 1000 股), or the sentinel `'ALL'` (resolved
only by the trading-app, against real account data, never by the server).

## Cross-cutting feature: Taiwan order-type routing (2026-07-11)

Session/order-type rules (盤中整股, 盤中零股, 盤後定價, 盤後零股, 限價/市價,
ROD/IOC/FOK) are resolved by `resolveOrderRouting()` (`packages/shared/src/market-session.ts`)
and threaded end-to-end: AI sandbox helpers (`get_market_session()`,
`resolve_order_type()`) → live signal path (`index.ts`) → backtest
(`runBacktest()`, with a NT$20 minimum-commission floor) → `Trigger`/`TradeActivity`
DB columns → trading-app pending-order preview → confirm-time re-resolution
→ `fubon_bridge.py`'s actual `Order(...)` call. Full design in
`.docs/taiwan_order_routing.md`.

## Cross-cutting feature: backtest simulation

`runBacktest()` walks historical bars chronologically holding a real simulated
position per symbol (seeded from a user-supplied 本金/principal), applying
commission (0.1425%, both sides, NT$20 minimum) + transaction tax (0.3%, sell
only), and now Taiwan lot-size/session constraints. Reports `returnRate`
(realized) and `unrealizedReturnRate` (mark-to-market on anything still held)
as two independent percentages, plus a per-signal list. `get_cash()`/`get_position()`
inside rule code reflect the backtest's own simulated cash/shares, not a real account.

## Known standing caveats (see individual docs for detail)
- Fubon Neo SDK class/method/enum names in `fubon_bridge.py` are unverified
  against live docs.
- No TWSE holiday calendar — session detection is weekday + time-of-day only.
- Backtest has no auction-microstructure model for 零股/盤後定價 fills (uses
  bar close as the reference price).
- No multi-leg split orders — a quantity that doesn't cleanly fit one lot type
  is clamped down, not split across two orders.

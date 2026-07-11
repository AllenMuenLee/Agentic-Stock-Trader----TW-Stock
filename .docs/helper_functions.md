# Agentic Stock Notifier - Rule Engine Helper Functions

This document lists the helper functions, variables, and data structures available to you when writing custom JavaScript stock monitoring rules.

The rules run inside a secure V8 sandbox on a per-tick basis. You have access to real-time market data, technical indicators, and historical K-lines (bars) through the injected global context.

## 1. Global Context Variables

| Variable | Type | Description |
| :--- | :--- | :--- |
| `stock` | `string` | The symbol currently being evaluated (e.g., `"2330"`). |
| `curr_time` | `number` | The current time as a Unix timestamp in **seconds**. |

Additionally, the following pure JavaScript globals are exposed:
- `Math`, `Number`, `JSON`

*(Note: `console.log`, `fetch`, `require`, and `process` are disabled or stubbed out for security and performance reasons).*

---

## 2. Core Data Functions

### `get_price(stock: string) -> number | undefined`
A shorthand for getting the latest traded price of the given stock.
```javascript
const price = get_price(stock);
if (price && price > 1000) return { signal: 'NOTIFY', message: 'Price broke 1000' };
```

### `get_detail(stock: string, feature: string) -> number | undefined`
Retrieves the latest tick value of a specific numerical feature.
**Supported features:** `'price'`, `'volume'`, `'open'`, `'high'`, `'low'`, `'close'`, `'change'`, `'changePercent'`, `'bid'`, `'ask'`, `'bidVolume'`, `'askVolume'`.
*(Note: `changePercent` is the daily gain/loss percentage, e.g. `3` for +3%)*
```javascript
const gain = get_detail(stock, 'changePercent');
if (gain >= 5) { ... }
```

### `get_data(stock: string, feature: string, startTime: number, endTime: number) -> number[]`
Returns a time-series array of a specific tick feature's values over a given time range (Unix seconds).
```javascript
// Get all price ticks in the last 60 seconds
const recentPrices = get_data(stock, 'price', curr_time - 60, curr_time);
```

### `get_meta(stock: string, key: string) -> unknown`
Retrieves non-market, slow-changing metadata for a stock.
**Common keys:** `'name'` (string), `'dayTradeable'` (boolean), `'sector'` (string).
```javascript
if (get_meta(stock, 'dayTradeable') === true) { ... }
```

---

## 3. K-Line / OHLCV Bar Functions

These functions return structured `CandleBar` objects representing completed intervals.

### `CandleBar` Interface
```typescript
{
  time: number;   // Bar open time as a Unix timestamp in seconds
  open: number;   // Open price
  high: number;   // Highest price in the interval
  low: number;    // Lowest price in the interval
  close: number;  // Close price
  volume: number; // Total volume in the interval
}
```
*Note for Taiwan Market: 紅K (Red Candle) means `close > open`, 綠K (Green Candle) means `close < open`.*

### `get_bars(stock: string, interval: string, count: number) -> CandleBar[]`
Retrieves the last `count` completed bars for the specified `interval`, ordered chronologically (oldest first).
**Supported intervals:** `'1m'`, `'3m'`, `'5m'`, `'15m'`, `'30m'`, `'1h'`, `'1d'`, `'1w'`.
```javascript
// Get the last 3 completed 5-minute bars
const bars = get_bars(stock, '5m', 3);
```

### `get_candle(stock: string, interval: string, offset?: number) -> CandleBar | undefined`
Retrieves a single bar by its offset from the most recently completed bar.
- `offset = 0` (or omitted) → The most recently **completed** bar.
- `offset = 1` → The bar right before the most recently completed one.
```javascript
const lastCompletedBar = get_candle(stock, '1m');
```

---

## 4. Technical Indicators

### `get_indicator(stock: string, name: string, params?: Record<string, number>) -> number | null`
Computes and returns a technical indicator based on the stock's daily history. Returns `null` if there isn't enough historical data to compute it.

**Supported Indicators:**
- `'sma'` / `'ema'`: Moving Averages. `params: { period: number }` (default 20)
- `'rsi'`: Relative Strength Index. `params: { period: number }` (default 14)
- `'bollinger_upper'` / `'bollinger_middle'` / `'bollinger_lower'`: Bollinger Bands. `params: { period: number, stdMult: number }` (default 20, 2)
- `'highest_high'` / `'lowest_low'`: N-day Highs/Lows. `params: { period: number }` (default 20)
- `'avg_volume'`: N-day Average Volume. `params: { period: number }` (default 20)

```javascript
const rsi14 = get_indicator(stock, 'rsi', { period: 14 });
if (rsi14 !== null && rsi14 < 30) {
  // oversold
}
```

---

## 5. Account & Position Functions

### `get_position(stock: string) -> number`
Shares of `stock` currently held. Live: the user's real Fubon account. Backtest: the backtest's own simulated position. `0` when none held or no account data has been reported yet.
```javascript
if (get_position(stock) > 2000) return null; // already hold enough
```

### `get_cash() -> number | undefined`
Available cash. Live: the user's real Fubon account. Backtest: the backtest's own simulated remaining 本金 (principal), rising/falling with each simulated BUY/SELL — mirrors how `get_position` reflects the simulated share count. `undefined` only when no data is available yet (e.g. no account snapshot reported live), so still check `!= null` before using it.
```javascript
const cash = get_cash();
if (cash != null && cash > 50000) { ... }
```

---

## 6. Taiwan Market Session & Order Routing

These helpers decide **how** a BUY/SELL signal should actually be placed — which market segment (整股/零股/盤後定價), price type, and time-in-force — given Taiwan's trading-session rules. `marketType` is *never* something rule code chooses: it's mechanically derived from `quantity` + the current session, since an incorrect value would produce an invalid order at the exchange. Calling these is optional — if a trade rule only returns `quantity`, the server derives the same routing automatically and applies it before the order reaches the trading-app. Call them yourself when you want to check the market is actually open, or to request a specific `priceType`/`timeInForce`/`limitPrice`.

### `get_market_session() -> MarketSessionInfo`
```typescript
{
  session: 'INTRADAY' | 'AFTER_HOURS_ODD' | 'AFTER_HOURS_FIXED_AND_ODD' | 'CLOSED';
  intraday: boolean;       // 09:00–13:30 — 盤中整股 (>=1000股) and 盤中零股 (<1000股)
  afterHoursOdd: boolean;  // 13:40–14:30 — 盤後零股, single 14:30 auction
  afterHoursFixed: boolean;// 14:00–14:30 — 盤後定價 (whole 張 only, priced at today's close)
  taipeiTime: string;      // "HH:MM", Taipei local time
}
```
All three booleans `false` means the market is closed (nights, weekends, the 13:30–13:40 gap). **No TWSE holiday calendar is checked** — only weekday + time-of-day.

```javascript
const session = get_market_session();
if (!session.intraday && !session.afterHoursOdd && !session.afterHoursFixed) return null; // market closed, skip
```

### `resolve_order_type(quantity: number) -> OrderRouting`
```typescript
{
  allowed: boolean;
  reason: string | null;              // why not allowed, when allowed is false
  marketType: 'Common' | 'Odd' | 'Fixing' | null;  // 整股 / 零股 / 盤後定價
  priceType: 'Limit' | 'Market' | null;
  timeInForce: 'ROD' | 'IOC' | 'FOK' | null;
  quantity: number;                   // requested quantity, clamped down to a valid lot size
  limitPrice: number | null;          // non-null whenever priceType is 'Limit'
  note: string | null;                // explains an automatic correction, e.g. odd-lot forcing 限價 ROD
}
```
- Quantity is clamped **down**, never up or split — e.g. requesting 1500 shares during 整股 hours resolves to `quantity: 1000` (the 500 remainder is simply not placed as a second order).
- 零股 (Odd) and 盤後定價 (Fixing) have non-negotiable price/TIF combinations (零股 = 限價 ROD only; 盤後定價 = 市價 ROD only, executes at today's close) — any conflicting override you pass is ignored and `note` explains why.
- 整股 (Common) is free to choose: `priceType` (`'Limit'`/`'Market'`) × `timeInForce` (`'ROD'`/`'IOC'`/`'FOK'`), defaulting to Market/ROD.
- You can pass overrides as a third-ish concept by including `priceType`/`timeInForce`/`limitPrice` directly on your *return object* (see below) — `resolve_order_type` itself only takes `quantity`; the override is applied when the server (or you) folds its own hints in.

```javascript
const routing = resolve_order_type(1500);
if (!routing.allowed) return null; // market closed or invalid quantity for this session
return {
  signal: 'BUY',
  quantity: routing.quantity,
  priceType: routing.priceType,
  timeInForce: routing.timeInForce,
  limitPrice: routing.limitPrice,
  message: `Buying ${routing.quantity} shares (${routing.marketType})`,
};
```

---

## 7. Return Value Protocol

Every rule evaluated in the sandbox must return either:
1. An object indicating a triggered rule: `{ signal: 'BUY' | 'SELL' | 'NOTIFY', message: 'Your reason here', ... }`
2. `null` or `undefined` (or no return) if the conditions were not met.

**For `actionType: "trade"` rules whose `signal` is `'BUY'` or `'SELL'`, `quantity` is required** — shares (positive number), or the string `'ALL'` (entire position for SELL / all available cash for BUY — resolved downstream by the trading-app, never by the server). Defaults to 1000 (1 張) if omitted on legacy/declarative rules only; AI-generated trade rules must always include it explicitly.

**Optional order-routing fields** — `priceType`, `timeInForce`, `limitPrice` (see §6). Omit them and the server derives sensible session-appropriate defaults automatically. Never include `marketType` yourself.

```javascript
const closes = get_data(stock, 'close', curr_time - 300, curr_time);
if (closes.length < 5) return null;

// Notify-only signal — no quantity needed
return {
  signal: 'NOTIFY',
  message: `Condition triggered at ${curr_time} for ${stock}`
};
```

```javascript
// Trade signal — quantity required; priceType/timeInForce/limitPrice optional
return {
  signal: 'BUY',
  quantity: 1000,
  message: `Buying 1 lot of ${stock}`,
};
```

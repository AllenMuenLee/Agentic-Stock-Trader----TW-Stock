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

## 5. Return Value Protocol

Every rule evaluated in the sandbox must return either:
1. An object indicating a triggered rule: `{ signal: 'BUY' | 'SELL' | 'NOTIFY', message: 'Your reason here' }`
2. `null` or `undefined` (or no return) if the conditions were not met.

```javascript
const closes = get_data(stock, 'close', curr_time - 300, curr_time);
if (closes.length < 5) return null;

// Return the signal if condition is met
return {
  signal: 'NOTIFY',
  message: `Condition triggered at ${curr_time} for ${stock}`
};
```

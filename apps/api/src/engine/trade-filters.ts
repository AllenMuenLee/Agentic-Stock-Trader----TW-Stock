import type { CandleBar, DataContext } from './data-context';

const THIRTY_MINUTES_SEC = 30 * 60;

type CandleColor = 'green' | 'red';

export interface TradeColorConfirmation {
  allowed: boolean;
  reason: string;
}

export function confirmThirtyMinuteSameColorTrade(
  context: DataContext,
  symbol: string,
  triggerTimeSec: number,
  triggerPrice?: number,
): TradeColorConfirmation {
  const currentStart = Math.floor(triggerTimeSec / THIRTY_MINUTES_SEC) * THIRTY_MINUTES_SEC;
  const previousStart = currentStart - THIRTY_MINUTES_SEC;
  const oneMinuteBars = context.get_bars(symbol, '1m', 120);

  const current = buildThirtyMinuteBar(oneMinuteBars, currentStart, triggerTimeSec, triggerPrice);
  const previous = buildThirtyMinuteBar(oneMinuteBars, previousStart, currentStart - 1);
  if (!current || !previous) {
    return {
      allowed: false,
      reason: 'missing current or previous 30m candle for trade color confirmation',
    };
  }

  const currentColor = candleColor(current);
  const previousColor = candleColor(previous);
  if (!currentColor || !previousColor) {
    return {
      allowed: false,
      reason: 'current or previous 30m candle is neutral',
    };
  }

  if (currentColor !== previousColor) {
    return {
      allowed: false,
      reason: `30m candle color mismatch: current=${currentColor}, previous=${previousColor}`,
    };
  }

  return {
    allowed: true,
    reason: `30m candles share ${currentColor} color`,
  };
}

function buildThirtyMinuteBar(
  oneMinuteBars: CandleBar[],
  startSec: number,
  endSecInclusive: number,
  triggerPrice?: number,
): CandleBar | undefined {
  const endSecExclusive = endSecInclusive + 1;
  const bars = oneMinuteBars.filter((bar) => bar.time >= startSec && bar.time < endSecExclusive);

  if (triggerPrice !== undefined && endSecInclusive >= startSec) {
    const triggerBar: CandleBar = {
      time: endSecInclusive,
      open: triggerPrice,
      high: triggerPrice,
      low: triggerPrice,
      close: triggerPrice,
      volume: 0,
    };
    bars.push(triggerBar);
  }

  if (bars.length === 0) return undefined;
  bars.sort((a, b) => a.time - b.time);

  return {
    time: startSec,
    open: bars[0].open,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    close: bars[bars.length - 1].close,
    volume: bars.reduce((sum, bar) => sum + bar.volume, 0),
  };
}

function candleColor(bar: CandleBar): CandleColor | undefined {
  if (bar.close > bar.open) return 'green';
  if (bar.close < bar.open) return 'red';
  return undefined;
}

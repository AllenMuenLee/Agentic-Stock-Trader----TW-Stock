import type { OHLCVBar } from '../types/rule';

export function sma(bars: OHLCVBar[], period: number): number | null {
  if (bars.length < period) return null;
  const slice = bars.slice(-period);
  return slice.reduce((sum, b) => sum + b.close, 0) / period;
}

export function ema(bars: OHLCVBar[], period: number): number | null {
  if (bars.length < period) return null;
  const k = 2 / (period + 1);
  let emaValue = bars.slice(0, period).reduce((s, b) => s + b.close, 0) / period;
  for (let i = period; i < bars.length; i++) {
    emaValue = bars[i].close * k + emaValue * (1 - k);
  }
  return emaValue;
}

export function rsi(bars: OHLCVBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const closes = bars.map((b) => b.close);
  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function bollingerBands(
  bars: OHLCVBar[],
  period = 20,
  stdMult = 2,
): { upper: number; middle: number; lower: number } | null {
  if (bars.length < period) return null;
  const slice = bars.slice(-period);
  const avg = slice.reduce((s, b) => s + b.close, 0) / period;
  const variance = slice.reduce((s, b) => s + Math.pow(b.close - avg, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: avg + stdMult * std,
    middle: avg,
    lower: avg - stdMult * std,
  };
}

export function nDayHigh(bars: OHLCVBar[], period: number): number | null {
  if (bars.length < period) return null;
  return Math.max(...bars.slice(-period).map((b) => b.high));
}

export function nDayLow(bars: OHLCVBar[], period: number): number | null {
  if (bars.length < period) return null;
  return Math.min(...bars.slice(-period).map((b) => b.low));
}

export function avgVolume(bars: OHLCVBar[], period: number): number | null {
  if (bars.length < period) return null;
  return bars.slice(-period).reduce((s, b) => s + b.volume, 0) / period;
}

import type { RuleConfig, RuleResult, TickData, OHLCVBar, Condition } from '../types/rule';
import * as indicators from './indicators';
import { runRuleCode } from './sandbox';
import type { DataContext } from './data-context';

export class RuleEngine {
  evaluate(
    config: RuleConfig,
    tick: TickData,
    history: OHLCVBar[],
    dataContext?: DataContext,
  ): RuleResult {
    // Code-based rules take precedence and run in the secure sandbox.
    if (config.code && config.code.trim()) {
      return this.evaluateCode(config, dataContext);
    }

    const conditions = config.conditions ?? [];
    if (conditions.length === 0) return { triggered: false };

    const results = conditions.map((c: Condition) => this.evaluateCondition(c, tick, history));
    const triggered =
      config.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);

    if (!triggered) return { triggered: false };

    return {
      triggered: true,
      signal: config.signal,
      message: this.buildMessage(config, tick),
    };
  }

  /** Executes an AI-generated rule body in the sandbox and maps the outcome to a RuleResult. */
  private evaluateCode(config: RuleConfig, dataContext?: DataContext): RuleResult {
    if (!dataContext) {
      return { triggered: false, error: 'Code rule evaluated without a data context' };
    }

    const { result, error } = runRuleCode(config.code as string, dataContext);

    // Surface the error to the caller so it can be logged with full rule context.
    if (error) return { triggered: false, error };

    if (!result) return { triggered: false };

    return {
      triggered: true,
      signal: result.signal,
      message: result.message,
      quantity: result.quantity,
    };
  }

  private evaluateCondition(
    condition: Condition,
    tick: TickData,
    history: OHLCVBar[],
  ): boolean {
    const p = condition.params as Record<string, number>;

    switch (condition.type) {
      case 'PRICE_ABOVE':
        return tick.price > p.value;

      case 'PRICE_BELOW':
        return tick.price < p.value;

      case 'PRICE_ABOVE_MA': {
        const ma = indicators.sma(history, p.period);
        return ma !== null && tick.price > ma;
      }

      case 'PRICE_BELOW_MA': {
        const ma = indicators.sma(history, p.period);
        return ma !== null && tick.price < ma;
      }

      case 'MA_CROSS_ABOVE': {
        if (history.length < 2) return false;
        const shortNow = indicators.sma(history, p.shortPeriod);
        const longNow = indicators.sma(history, p.longPeriod);
        const shortPrev = indicators.sma(history.slice(0, -1), p.shortPeriod);
        const longPrev = indicators.sma(history.slice(0, -1), p.longPeriod);
        if (!shortNow || !longNow || !shortPrev || !longPrev) return false;
        return shortPrev <= longPrev && shortNow > longNow;
      }

      case 'MA_CROSS_BELOW': {
        if (history.length < 2) return false;
        const shortNow = indicators.sma(history, p.shortPeriod);
        const longNow = indicators.sma(history, p.longPeriod);
        const shortPrev = indicators.sma(history.slice(0, -1), p.shortPeriod);
        const longPrev = indicators.sma(history.slice(0, -1), p.longPeriod);
        if (!shortNow || !longNow || !shortPrev || !longPrev) return false;
        return shortPrev >= longPrev && shortNow < longNow;
      }

      case 'RSI_OVERSOLD': {
        const rsi = indicators.rsi(history, p.period || 14);
        return rsi !== null && rsi < (p.threshold || 30);
      }

      case 'RSI_OVERBOUGHT': {
        const rsi = indicators.rsi(history, p.period || 14);
        return rsi !== null && rsi > (p.threshold || 70);
      }

      case 'VOLUME_SPIKE': {
        const avgVol = indicators.avgVolume(history, p.period || 20);
        return avgVol !== null && tick.volume > avgVol * (p.multiplier || 2);
      }

      case 'PRICE_BREAK_HIGH': {
        const high = indicators.nDayHigh(history, p.period || 52);
        return high !== null && tick.price > high;
      }

      case 'PRICE_BREAK_LOW': {
        const low = indicators.nDayLow(history, p.period || 52);
        return low !== null && tick.price < low;
      }

      case 'BOLLINGER_BREAK_UPPER': {
        const bb = indicators.bollingerBands(history, p.period || 20, p.stdMult || 2);
        return bb !== null && tick.price > bb.upper;
      }

      case 'BOLLINGER_BREAK_LOWER': {
        const bb = indicators.bollingerBands(history, p.period || 20, p.stdMult || 2);
        return bb !== null && tick.price < bb.lower;
      }

      default:
        return false;
    }
  }

  private buildMessage(config: RuleConfig, tick: TickData): string {
    const conditionDescriptions = (config.conditions ?? []).map((c: Condition) => {
      switch (c.type) {
        case 'PRICE_ABOVE_MA':
          return `Price above MA${c.params.period}`;
        case 'PRICE_BELOW_MA':
          return `Price below MA${c.params.period}`;
        case 'MA_CROSS_ABOVE':
          return `MA${c.params.shortPeriod} crossed above MA${c.params.longPeriod}`;
        case 'MA_CROSS_BELOW':
          return `MA${c.params.shortPeriod} crossed below MA${c.params.longPeriod}`;
        case 'RSI_OVERSOLD':
          return `RSI(${c.params.period || 14}) < ${c.params.threshold || 30}`;
        case 'RSI_OVERBOUGHT':
          return `RSI(${c.params.period || 14}) > ${c.params.threshold || 70}`;
        case 'VOLUME_SPIKE':
          return `Volume spike (${c.params.multiplier || 2}x avg)`;
        case 'PRICE_BREAK_HIGH':
          return `${c.params.period}-day high breakout`;
        case 'PRICE_BREAK_LOW':
          return `${c.params.period}-day low breakdown`;
        case 'BOLLINGER_BREAK_UPPER':
          return 'Price above upper Bollinger Band';
        case 'BOLLINGER_BREAK_LOWER':
          return 'Price below lower Bollinger Band';
        default:
          return c.type;
      }
    });

    return (
      `${config.signal} signal for ${tick.symbol} at ${tick.price}: ` +
      conditionDescriptions.join(config.logic === 'AND' ? ' AND ' : ' OR ')
    );
  }
}

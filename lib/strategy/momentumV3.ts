import { Strategy, StrategyConfig, StrategyContext, StrategySignal, StrategyAction } from '../../types/strategy';
import { Candle } from '../../types';
import { calculateEMA, calculateATR, calculateAverageVolume, calculateADX } from '../indicators';

export class MomentumStrategyV3 implements Strategy {
  public readonly name = 'MomentumStrategyV3';

  public evaluate(candles: Candle[], config: StrategyConfig, context: StrategyContext): StrategySignal {
    const defaultSignal = this.createSignal('HOLD', candles, 'No trade criteria met', config);

    // Config extraction with defaults
    const emaFastPeriod = (config.emaFast as number) || 20;
    const emaSlowPeriod = (config.emaSlow as number) || 50;
    const adxPeriod = (config.adxPeriod as number) || 14;
    const minimumADX = config.minimumADX !== undefined ? (config.minimumADX as number) : 20;
    
    const pullbackLookback = (config.pullbackLookback as number) || 10;
    const pullbackTolerancePercent = config.pullbackTolerancePercent !== undefined ? (config.pullbackTolerancePercent as number) : 0.001; // 0.1%
    
    const volumeMultiplier = config.volumeMultiplier !== undefined ? (config.volumeMultiplier as number) : 1.2;
    const minimumATRPercent = config.minimumATRPercent !== undefined ? (config.minimumATRPercent as number) : 0.001; // 0.1%
    
    const atrBuffer = config.atrBuffer !== undefined ? (config.atrBuffer as number) : 0.5;

    const maxPeriod = Math.max(emaSlowPeriod, adxPeriod * 2, pullbackLookback + 1);

    if (candles.length <= maxPeriod) {
      return defaultSignal;
    }

    const currentIdx = candles.length - 1;
    const currentCandle = candles[currentIdx];
    const prevCandle = candles[currentIdx - 1];

    // Indicator calculations
    const emaFast = calculateEMA(candles, emaFastPeriod);
    const emaSlow = calculateEMA(candles, emaSlowPeriod);
    const atr = calculateATR(candles, 14); // Fixed 14 for ATR
    const avgVol = calculateAverageVolume(candles, emaSlowPeriod);
    const { adx } = calculateADX(candles, adxPeriod);

    const currentEmaFast = emaFast[currentIdx];
    const currentEmaSlow = emaSlow[currentIdx];
    const currentAtr = atr[currentIdx];
    const currentAvgVol = avgVol[currentIdx];
    const currentAdx = adx[currentIdx];

    // Missing data guards
    if (isNaN(currentEmaFast) || isNaN(currentEmaSlow) || isNaN(currentAtr) || isNaN(currentAdx) || isNaN(currentAvgVol)) {
      return defaultSignal;
    }

    // --- 1. BASIC FILTERS ---

    // Volatility Filter
    const currentVolatilityPercent = currentAtr / currentCandle.close;
    if (currentVolatilityPercent < minimumATRPercent) {
      return this.createSignal('HOLD', candles, `Volatility (${(currentVolatilityPercent*100).toFixed(2)}%) below minimum (${(minimumATRPercent*100).toFixed(2)}%)`, config);
    }

    // ADX Filter
    if (currentAdx < minimumADX) {
      return this.createSignal('HOLD', candles, `ADX (${currentAdx.toFixed(1)}) below minimum (${minimumADX})`, config);
    }

    // --- 2. TREND & PULLBACK ANALYSIS ---
    
    // We look at the last `pullbackLookback` candles up to the previous candle.
    // The current candle is the confirmation candle, so the pullback must have happened BEFORE it.
    const lookbackCandles = candles.slice(currentIdx - pullbackLookback, currentIdx);
    const lookbackEmaFast = emaFast.slice(currentIdx - pullbackLookback, currentIdx);
    const lookbackEmaSlow = emaSlow.slice(currentIdx - pullbackLookback, currentIdx);
    
    let isLongTrendIntact = true;
    let hasLongPullback = false;
    let swingLow = Infinity;

    let isShortTrendIntact = true;
    let hasShortPullback = false;
    let swingHigh = -Infinity;

    for (let i = 0; i < lookbackCandles.length; i++) {
      const c = lookbackCandles[i];
      const eFast = lookbackEmaFast[i];
      const eSlow = lookbackEmaSlow[i];

      // LONG analysis
      if (c.close <= eSlow) {
        isLongTrendIntact = false; // Trend invalidated if close drops below EMA50
      }
      const longPullbackThreshold = eFast * (1 + pullbackTolerancePercent);
      if (c.low <= longPullbackThreshold) {
        hasLongPullback = true;
      }
      if (c.low < swingLow) {
        swingLow = c.low;
      }

      // SHORT analysis
      if (c.close >= eSlow) {
        isShortTrendIntact = false; // Trend invalidated if close rises above EMA50
      }
      const shortPullbackThreshold = eFast * (1 - pullbackTolerancePercent);
      if (c.high >= shortPullbackThreshold) {
        hasShortPullback = true;
      }
      if (c.high > swingHigh) {
        swingHigh = c.high;
      }
    }

    // Current trend alignment
    const isCurrentTrendLong = currentEmaFast > currentEmaSlow;
    const isCurrentTrendShort = currentEmaFast < currentEmaSlow;

    // --- 3. CONTINUATION CONFIRMATION ---

    const isBullishCandle = currentCandle.close > currentCandle.open;
    const isBearishCandle = currentCandle.close < currentCandle.open;

    const currentVolumeSpike = currentCandle.volume > (currentAvgVol * volumeMultiplier);

    const isLongContinuation = 
      isCurrentTrendLong &&
      isLongTrendIntact &&
      hasLongPullback &&
      isBullishCandle &&
      currentCandle.close > prevCandle.high &&
      currentVolumeSpike;

    const isShortContinuation =
      isCurrentTrendShort &&
      isShortTrendIntact &&
      hasShortPullback &&
      isBearishCandle &&
      currentCandle.close < prevCandle.low &&
      currentVolumeSpike;

    // --- 4. SIGNAL GENERATION ---

    if (process.env.NODE_ENV === 'test') {
      console.log('SHORT DEBUG:', {
        isCurrentTrendShort,
        currentEmaFast,
        currentEmaSlow,
        isShortTrendIntact,
        hasShortPullback,
        isBearishCandle,
        close: currentCandle.close,
        prevLow: prevCandle.low,
        currentVolumeSpike
      });
    }

    if (isLongContinuation) {
      return this.createSignal('OPEN_LONG', candles, 'Long Pullback Continuation', config, currentAtr, atrBuffer, swingLow, currentCandle.close);
    }

    if (isShortContinuation) {
      return this.createSignal('OPEN_SHORT', candles, 'Short Pullback Continuation', config, currentAtr, atrBuffer, swingHigh, currentCandle.close);
    }

    return defaultSignal;
  }

  private createSignal(
    action: StrategyAction,
    candles: Candle[],
    reason: string,
    config: StrategyConfig,
    atr?: number,
    atrBuffer?: number,
    swingExtremum?: number,
    price?: number
  ): StrategySignal {
    const signal: StrategySignal = {
      action,
      timestamp: candles[candles.length - 1].time,
      reason: [reason],
      strategyName: this.name
    };

    if (action === 'OPEN_LONG' && atr !== undefined && atrBuffer !== undefined && swingExtremum !== undefined && price !== undefined) {
      const riskReward = (config.riskReward as number) || 2.0;
      signal.entryPrice = price;
      signal.stopLoss = swingExtremum - (atr * atrBuffer);
      
      const riskDistance = price - signal.stopLoss;
      signal.takeProfit = price + (riskDistance * riskReward);
    }

    if (action === 'OPEN_SHORT' && atr !== undefined && atrBuffer !== undefined && swingExtremum !== undefined && price !== undefined) {
      const riskReward = (config.riskReward as number) || 2.0;
      signal.entryPrice = price;
      signal.stopLoss = swingExtremum + (atr * atrBuffer);
      
      const riskDistance = signal.stopLoss - price;
      signal.takeProfit = price - (riskDistance * riskReward);
    }

    return signal;
  }
}

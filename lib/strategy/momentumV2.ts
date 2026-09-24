import { Strategy, StrategyConfig, StrategyContext, StrategySignal, StrategyAction } from '../../types/strategy';
import { Candle } from '../../types';
import { calculateEMA, calculateRSI, calculateATR, calculateAverageVolume, calculateADX } from '../indicators';

export class MomentumStrategyV2 implements Strategy {
  public readonly name = 'MomentumStrategyV2';

  public evaluate(candles: Candle[], config: StrategyConfig, context: StrategyContext): StrategySignal {
    const defaultSignal = this.createSignal('HOLD', candles, 'No trade criteria met', config);

    // Minimum candles required to calculate all indicators
    const maxPeriod = Math.max(
      (config.emaSlow as number) || 50,
      ((config.adxPeriod as number) || 14) * 2,
      (config.breakoutCandles as number) || 5
    );

    if (candles.length <= maxPeriod) {
      return defaultSignal;
    }

    const currentIdx = candles.length - 1;
    const currentCandle = candles[currentIdx];

    // Indicator calculations
    const emaFast = calculateEMA(candles, (config.emaFast as number) || 20);
    const emaSlow = calculateEMA(candles, (config.emaSlow as number) || 50);
    const rsi = calculateRSI(candles, (config.rsiPeriod as number) || 14);
    const atr = calculateATR(candles, (config.atrPeriod as number) || 14);
    const avgVol = calculateAverageVolume(candles, (config.emaSlow as number) || 50);
    const { adx } = calculateADX(candles, (config.adxPeriod as number) || 14);

    const currentEmaFast = emaFast[currentIdx];
    const currentEmaSlow = emaSlow[currentIdx];
    const currentRsi = rsi[currentIdx];
    const currentAtr = atr[currentIdx];
    const currentAvgVol = avgVol[currentIdx];
    const currentAdx = adx[currentIdx];

    // Missing data guards
    if (isNaN(currentEmaFast) || isNaN(currentEmaSlow) || isNaN(currentRsi) || isNaN(currentAtr) || isNaN(currentAdx) || isNaN(currentAvgVol)) {
      return defaultSignal;
    }

    // --- FILTERS ---

    // 1. ADX Trend Strength Filter
    const minimumADX = config.minimumADX !== undefined ? (config.minimumADX as number) : 20;
    if (currentAdx < minimumADX) {
      return this.createSignal('HOLD', candles, `ADX (${currentAdx.toFixed(1)}) below minimum (${minimumADX})`, config);
    }

    // 2. Volatility Filter
    const minimumATRPercent = config.minimumATRPercent !== undefined ? (config.minimumATRPercent as number) : 0.001; // Default 0.1%
    const currentVolatilityPercent = currentAtr / currentCandle.close;
    if (currentVolatilityPercent < minimumATRPercent) {
      return this.createSignal('HOLD', candles, `Volatility (${(currentVolatilityPercent*100).toFixed(2)}%) below minimum (${(minimumATRPercent*100).toFixed(2)}%)`, config);
    }

    // 3. EMA Separation Filter
    const minimumEMASeparation = config.minimumEMASeparation !== undefined ? (config.minimumEMASeparation as number) : 0.001;
    const emaSeparationPercent = Math.abs(currentEmaFast - currentEmaSlow) / currentCandle.close;
    if (emaSeparationPercent < minimumEMASeparation) {
      return this.createSignal('HOLD', candles, `EMA separation (${(emaSeparationPercent*100).toFixed(2)}%) below minimum (${(minimumEMASeparation*100).toFixed(2)}%)`, config);
    }

    // 4. Volume Confirmation
    const volumeMultiplier = config.volumeMultiplier !== undefined ? (config.volumeMultiplier as number) : 1.2;
    if (currentCandle.volume < currentAvgVol * volumeMultiplier) {
      return this.createSignal('HOLD', candles, `Insufficient volume`, config);
    }

    // 5. Breakout Confirmation
    const breakoutCandles = config.breakoutCandles !== undefined ? (config.breakoutCandles as number) : 5;
    const recentCandles = candles.slice(currentIdx - breakoutCandles, currentIdx); // EXCLUDES current candle
    const highestHigh = Math.max(...recentCandles.map(c => c.high));
    const lowestLow = Math.min(...recentCandles.map(c => c.low));

    // --- SIGNAL GENERATION ---

    const longRsiThreshold = (config.longRsi as number) || 55;
    const shortRsiThreshold = (config.shortRsi as number) || 45;

    const isLongCondition = 
      currentEmaFast > currentEmaSlow && 
      currentRsi > longRsiThreshold &&
      currentCandle.close > highestHigh;

    const isShortCondition = 
      currentEmaFast < currentEmaSlow && 
      currentRsi < shortRsiThreshold &&
      currentCandle.close < lowestLow;

    if (isLongCondition) {
      return this.createSignal('OPEN_LONG', candles, 'Strong Long breakout detected', config, currentAtr, currentCandle.close);
    }

    if (isShortCondition) {
      return this.createSignal('OPEN_SHORT', candles, 'Strong Short breakout detected', config, currentAtr, currentCandle.close);
    }

    return defaultSignal;
  }

  private createSignal(
    action: StrategyAction,
    candles: Candle[],
    reason: string,
    config: StrategyConfig,
    atr?: number,
    price?: number
  ): StrategySignal {
    const signal: StrategySignal = {
      action,
      timestamp: candles[candles.length - 1].time,
      reason: [reason],
      strategyName: this.name
    };

    if (action === 'OPEN_LONG' && atr && price) {
      const atrMultiplier = (config.atrMultiplier as number) || 1.5;
      const riskReward = (config.riskReward as number) || 2.0;
      const stopDistance = atr * atrMultiplier;
      signal.entryPrice = price;
      signal.stopLoss = price - stopDistance;
      signal.takeProfit = price + (stopDistance * riskReward);
    }

    if (action === 'OPEN_SHORT' && atr && price) {
      const atrMultiplier = (config.atrMultiplier as number) || 1.5;
      const riskReward = (config.riskReward as number) || 2.0;
      const stopDistance = atr * atrMultiplier;
      signal.entryPrice = price;
      signal.stopLoss = price + stopDistance;
      signal.takeProfit = price - (stopDistance * riskReward);
    }

    return signal;
  }
}

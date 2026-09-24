import { Strategy, StrategyConfig, StrategyContext, StrategySignal, StrategyAction } from '../../types/strategy';
import { Candle } from '../../types';
import { calculateEMA, calculateATR, calculateRSI, calculateBollingerBands, calculateADX } from '../indicators';

export class MeanReversionStrategyV4 implements Strategy {
  public readonly name = 'MeanReversionStrategyV4';

  public evaluate(candles: Candle[], config: StrategyConfig, context: StrategyContext): StrategySignal {
    const defaultSignal = this.createSignal('HOLD', candles, 'No trade criteria met', config);

    // Config extraction with defaults
    const bbPeriod = (config.bbPeriod as number) || 20;
    const bbStdDev = (config.bbStdDev as number) || 2.0;
    const rsiPeriod = (config.rsiPeriod as number) || 14;
    const oversoldRSI = (config.oversoldRSI as number) || 30;
    const overboughtRSI = (config.overboughtRSI as number) || 70;
    const emaFastPeriod = (config.emaFast as number) || 20;
    const emaSlowPeriod = (config.emaSlow as number) || 50;
    const adxPeriod = (config.adxPeriod as number) || 14;
    const maxTrendADX = config.maxTrendADX !== undefined ? (config.maxTrendADX as number) : 25;
    const atrPeriod = (config.atrPeriod as number) || 14;
    const atrMultiplier = config.atrMultiplier !== undefined ? (config.atrMultiplier as number) : 1.5;
    const maxRiskReward = config.maxRiskReward !== undefined ? (config.maxRiskReward as number) : 5.0;

    const maxPeriod = Math.max(bbPeriod, rsiPeriod, emaSlowPeriod, adxPeriod * 2, atrPeriod);

    if (candles.length <= maxPeriod) {
      return defaultSignal;
    }

    const currentIdx = candles.length - 1;
    const currentCandle = candles[currentIdx];
    const prevCandle = candles[currentIdx - 1];

    // Indicators
    const bb = calculateBollingerBands(candles, bbPeriod, bbStdDev);
    const rsi = calculateRSI(candles, rsiPeriod);
    const emaFast = calculateEMA(candles, emaFastPeriod);
    const emaSlow = calculateEMA(candles, emaSlowPeriod);
    const { adx } = calculateADX(candles, adxPeriod);
    const atr = calculateATR(candles, atrPeriod);

    const currentUpper = bb.upper[currentIdx];
    const currentMiddle = bb.middle[currentIdx];
    const currentLower = bb.lower[currentIdx];
    const prevLower = bb.lower[currentIdx - 1];
    const prevUpper = bb.upper[currentIdx - 1];
    
    const currentRsi = rsi[currentIdx];
    const prevRsi = rsi[currentIdx - 1];
    const currentEmaFast = emaFast[currentIdx];
    const currentEmaSlow = emaSlow[currentIdx];
    const currentAdx = adx[currentIdx];
    const currentAtr = atr[currentIdx];

    if (process.env.NODE_ENV === 'test') {
      console.log({
         currentUpper, currentMiddle, currentLower, prevLower, prevUpper,
         currentRsi, prevRsi, currentEmaFast, currentEmaSlow, currentAdx, currentAtr,
         prevCandleClose: prevCandle.close, currentCandleClose: currentCandle.close,
         open: currentCandle.open
      });
    }

    // Guards
    if (isNaN(currentMiddle) || isNaN(currentRsi) || isNaN(currentEmaFast) || isNaN(currentEmaSlow) || isNaN(currentAdx) || isNaN(currentAtr)) {
      return defaultSignal;
    }

    // --- 1. LONG SIGNAL LOGIC ---
    
    // Condition 1: Price extended significantly (previous candle was <= lower band)
    const isPriceExtendedDown = prevCandle.close <= prevLower;
    
    // Condition 2: Oversold RSI (checked on the extreme candle)
    const isRsiOversold = prevRsi <= oversoldRSI;
    
    // Condition 3: Not in a strong bearish trend
    const isStrongBearishTrend = (currentEmaFast < currentEmaSlow) && (currentAdx > maxTrendADX);
    const isSafeToLong = !isStrongBearishTrend;
    
    // Condition 4: Confirmation (closes back inside the band and is bullish)
    const isLongConfirmation = currentCandle.close > currentCandle.open && currentCandle.close > currentLower;

    if (isPriceExtendedDown && isRsiOversold && isSafeToLong && isLongConfirmation) {
      // Look for the recent swing low over the last few candles (e.g. 5)
      let swingLow = currentCandle.low;
      for (let i = Math.max(0, currentIdx - 5); i <= currentIdx; i++) {
        if (candles[i].low < swingLow) swingLow = candles[i].low;
      }
      
      const entryPrice = currentCandle.close;
      const stopLoss = swingLow - (currentAtr * atrMultiplier);
      const takeProfit = currentMiddle; // Target the mean (SMA)
      
      const risk = entryPrice - stopLoss;
      const reward = takeProfit - entryPrice;
      const riskReward = reward / risk;

      if (riskReward > 0 && riskReward <= maxRiskReward) {
        return this.createSignal('OPEN_LONG', candles, 'Mean Reversion Long', entryPrice, stopLoss, takeProfit);
      } else if (riskReward > maxRiskReward) {
        return this.createSignal('HOLD', candles, 'Risk-Reward capped', 0, 0, 0);
      } else {
        return this.createSignal('HOLD', candles, 'Negative Risk-Reward', 0, 0, 0);
      }
    }

    // --- 2. SHORT SIGNAL LOGIC ---
    
    // Condition 1: Price extended significantly (previous candle was >= upper band)
    const isPriceExtendedUp = prevCandle.close >= prevUpper;
    
    // Condition 2: Overbought RSI (checked on the extreme candle)
    const isRsiOverbought = prevRsi >= overboughtRSI;
    
    // Condition 3: Not in a strong bullish trend
    const isStrongBullishTrend = (currentEmaFast > currentEmaSlow) && (currentAdx > maxTrendADX);
    const isSafeToShort = !isStrongBullishTrend;
    
    // Condition 4: Confirmation (closes back inside the band and is bearish)
    const isShortConfirmation = currentCandle.close < currentCandle.open && currentCandle.close < currentUpper;

    if (isPriceExtendedUp && isRsiOverbought && isSafeToShort && isShortConfirmation) {
      // Look for the recent swing high over the last few candles (e.g. 5)
      let swingHigh = currentCandle.high;
      for (let i = Math.max(0, currentIdx - 5); i <= currentIdx; i++) {
        if (candles[i].high > swingHigh) swingHigh = candles[i].high;
      }

      const entryPrice = currentCandle.close;
      const stopLoss = swingHigh + (currentAtr * atrMultiplier);
      const takeProfit = currentMiddle; // Target the mean (SMA)
      
      const risk = stopLoss - entryPrice;
      const reward = entryPrice - takeProfit;
      const riskReward = reward / risk;

      if (riskReward > 0 && riskReward <= maxRiskReward) {
        return this.createSignal('OPEN_SHORT', candles, 'Mean Reversion Short', entryPrice, stopLoss, takeProfit);
      } else if (riskReward > maxRiskReward) {
        return this.createSignal('HOLD', candles, 'Risk-Reward capped', 0, 0, 0);
      } else {
        return this.createSignal('HOLD', candles, 'Negative Risk-Reward', 0, 0, 0);
      }
    }

    return defaultSignal;
  }

  private createSignal(
    action: StrategyAction,
    candles: Candle[],
    reason: string,
    entryPrice: number,
    stopLoss: number,
    takeProfit: number
  ): StrategySignal {
    const signal: StrategySignal = {
      action,
      timestamp: candles[candles.length - 1].time,
      reason: [reason],
      strategyName: this.name
    };

    if (action !== 'HOLD') {
      signal.entryPrice = entryPrice;
      signal.stopLoss = stopLoss;
      signal.takeProfit = takeProfit;
    }

    return signal;
  }
}

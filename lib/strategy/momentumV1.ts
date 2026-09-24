import { Candle } from '../../types';
import { Strategy, StrategyConfig, StrategyContext, StrategySignal } from '../../types/strategy';
import { calculateEMA, calculateRSI, calculateATR, calculateAverageVolume } from '../indicators';

export class MomentumStrategyV1 implements Strategy {
  name = 'Momentum V1';

  evaluate(candles: Candle[], config: StrategyConfig, context: StrategyContext): StrategySignal {
    const defaultSignal: StrategySignal = {
      action: 'HOLD',
      timestamp: candles.length > 0 ? candles[candles.length - 1].time : Date.now(),
      reason: ['No conditions met'],
      strategyName: this.name
    };

    if (candles.length < 50) {
      defaultSignal.reason = ['Insufficient historical candles'];
      return defaultSignal;
    }

    // Config parameters
    const emaFastPeriod = Number(config.emaFast) || 20;
    const emaSlowPeriod = Number(config.emaSlow) || 50;
    const rsiPeriod = Number(config.rsiPeriod) || 14;
    const longRsi = Number(config.longRsi) || 55;
    const shortRsi = Number(config.shortRsi) || 45;
    const atrPeriod = Number(config.atrPeriod) || 14;
    const atrMultiplier = Number(config.atrMultiplier) || 1.5;
    const riskReward = Number(config.riskReward) || 2.0;

    // Calculate Indicators
    const emaFast = calculateEMA(candles, emaFastPeriod);
    const emaSlow = calculateEMA(candles, emaSlowPeriod);
    const rsi = calculateRSI(candles, rsiPeriod);
    const atr = calculateATR(candles, atrPeriod);
    const avgVol = calculateAverageVolume(candles, 20);

    const currentIndex = candles.length - 1;
    const currentCandle = candles[currentIndex];
    
    // Values
    const currentEmaFast = emaFast[currentIndex];
    const currentEmaSlow = emaSlow[currentIndex];
    const currentRsi = rsi[currentIndex];
    const currentAtr = atr[currentIndex];
    const currentVol = currentCandle.volume || 0;
    const currentAvgVol = avgVol[currentIndex];

    if (isNaN(currentEmaFast) || isNaN(currentEmaSlow) || isNaN(currentRsi) || isNaN(currentAtr) || isNaN(currentAvgVol)) {
      defaultSignal.reason = ['Indicators not yet warm'];
      return defaultSignal;
    }

    const price = currentCandle.close;

    // LONG Conditions
    if (currentEmaFast > currentEmaSlow && currentRsi > longRsi && currentVol > currentAvgVol) {
      const stopLoss = price - (currentAtr * atrMultiplier);
      const risk = price - stopLoss;
      const takeProfit = price + (risk * riskReward);

      return {
        action: 'OPEN_LONG',
        timestamp: currentCandle.time,
        entryPrice: price,
        stopLoss,
        takeProfit,
        reason: [`EMA${emaFastPeriod} > EMA${emaSlowPeriod}`, `RSI > ${longRsi}`, `Vol > AvgVol`],
        strategyName: this.name
      };
    }

    // SHORT Conditions
    if (currentEmaFast < currentEmaSlow && currentRsi < shortRsi && currentVol > currentAvgVol) {
      const stopLoss = price + (currentAtr * atrMultiplier);
      const risk = stopLoss - price;
      const takeProfit = price - (risk * riskReward);

      return {
        action: 'OPEN_SHORT',
        timestamp: currentCandle.time,
        entryPrice: price,
        stopLoss,
        takeProfit,
        reason: [`EMA${emaFastPeriod} < EMA${emaSlowPeriod}`, `RSI < ${shortRsi}`, `Vol > AvgVol`],
        strategyName: this.name
      };
    }

    return defaultSignal;
  }
}

import { Candle } from '../../types';
import { Strategy, StrategyConfig, StrategyContext, StrategySignal } from '../../types/strategy';
import { calculateEMA, calculateATR, calculateAverageVolume, calculateADX, calculateRSI } from '../indicators';

export class MomentumStrategyV5 implements Strategy {
  name = 'Momentum V5';

  public diagnostics = {
    totalSignalsEvaluated: 0,
    longCandidates: 0,
    shortCandidates: 0,
    rejectedOpenPosition: 0,
    rejectedAdx: 0,
    rejectedRsi: 0,
    rejectedBreakout: 0,
    rejectedVolume: 0,
    rejectedVolatility: 0,
    rejectedCostFilter: 0,
    finalLongSignals: 0,
    finalShortSignals: 0
  };

  evaluate(candles: Candle[], config: StrategyConfig, context: StrategyContext): StrategySignal {
    const emaFastPeriod = config.emaFast !== undefined ? (config.emaFast as number) : 20;
    const emaSlowPeriod = config.emaSlow !== undefined ? (config.emaSlow as number) : 50;
    const rsiPeriod = config.rsiPeriod !== undefined ? (config.rsiPeriod as number) : 14;
    const longRsiMin = config.longRsiMin !== undefined ? (config.longRsiMin as number) : 55;
    const longRsiMax = config.longRsiMax !== undefined ? (config.longRsiMax as number) : 70;
    const shortRsiMin = config.shortRsiMin !== undefined ? (config.shortRsiMin as number) : 30;
    const shortRsiMax = config.shortRsiMax !== undefined ? (config.shortRsiMax as number) : 45;
    const adxPeriod = config.adxPeriod !== undefined ? (config.adxPeriod as number) : 14;
    const adxThreshold = config.adxThreshold !== undefined ? (config.adxThreshold as number) : 20;
    const atrPeriod = config.atrPeriod !== undefined ? (config.atrPeriod as number) : 14;
    const atrStopMultiplier = config.atrStopMultiplier !== undefined ? (config.atrStopMultiplier as number) : 1.5;
    const rewardRisk = config.rewardRisk !== undefined ? (config.rewardRisk as number) : 2.0;
    const breakoutLookback = config.breakoutLookback !== undefined ? (config.breakoutLookback as number) : 20;
    const averageVolumePeriod = config.averageVolumePeriod !== undefined ? (config.averageVolumePeriod as number) : 20;
    const volumeMultiplier = config.volumeMultiplier !== undefined ? (config.volumeMultiplier as number) : 1.2;
    const minimumAtrPct = config.minimumAtrPct !== undefined ? (config.minimumAtrPct as number) : 0.10;
    const minimumEdgeMultiplier = config.minimumEdgeMultiplier !== undefined ? (config.minimumEdgeMultiplier as number) : 1.5;

    // Need enough candles for indicators and breakout lookback
    const minCandles = Math.max(emaSlowPeriod, rsiPeriod, adxPeriod * 2, atrPeriod, breakoutLookback, averageVolumePeriod) + 1;
    
    if (candles.length < minCandles) {
      return { action: 'HOLD', timestamp: candles[candles.length - 1]?.time || 0, reason: ['INSUFFICIENT_DATA'], strategyName: this.name };
    }

    const currentCandle = candles[candles.length - 1];
    
    // 1. Check open positions
    if (context.openPositions.length > 0) {
      this.diagnostics.rejectedOpenPosition++;
      return { action: 'HOLD', timestamp: currentCandle.time, reason: ['POSITION_ALREADY_OPEN'], strategyName: this.name };
    }

    this.diagnostics.totalSignalsEvaluated++;

    const emaFastVals = calculateEMA(candles, emaFastPeriod);
    const emaSlowVals = calculateEMA(candles, emaSlowPeriod);
    const rsiVals = calculateRSI(candles, rsiPeriod);
    const { adx: adxVals } = calculateADX(candles, adxPeriod);
    const atrVals = calculateATR(candles, atrPeriod);
    const volSmaVals = calculateAverageVolume(candles, averageVolumePeriod);

    const currentEmaFast = emaFastVals[emaFastVals.length - 1];
    const currentEmaSlow = emaSlowVals[emaSlowVals.length - 1];
    const currentRsi = rsiVals[rsiVals.length - 1];
    const currentAdx = adxVals[adxVals.length - 1];
    const currentAtr = atrVals[atrVals.length - 1];
    const currentAvgVol = volSmaVals[volSmaVals.length - 1];

    const isEmaBullish = currentEmaFast > currentEmaSlow;
    const isEmaBearish = currentEmaFast < currentEmaSlow;

    if (isEmaBullish) this.diagnostics.longCandidates++;
    if (isEmaBearish) this.diagnostics.shortCandidates++;

    if (!isEmaBullish && !isEmaBearish) {
       return { action: 'HOLD', timestamp: currentCandle.time, reason: ['NO_TREND'], strategyName: this.name };
    }

    if (currentAdx < adxThreshold) {
      this.diagnostics.rejectedAdx++;
      return { action: 'HOLD', timestamp: currentCandle.time, reason: ['LOW_ADX'], strategyName: this.name };
    }

    // 3. RSI Filter
    let rsiPasses = false;
    if (isEmaBullish && currentRsi >= longRsiMin && currentRsi <= longRsiMax) rsiPasses = true;
    if (isEmaBearish && currentRsi <= shortRsiMax && currentRsi >= shortRsiMin) rsiPasses = true;
    
    if (!rsiPasses) {
      this.diagnostics.rejectedRsi++;
      return { action: 'HOLD', timestamp: currentCandle.time, reason: ['RSI_NOT_IN_RANGE'], strategyName: this.name };
    }

    // 4. Breakout Filter (No look-ahead)
    // We look at the PREVIOUS `breakoutLookback` candles, EXCLUDING current candle.
    const lookbackStartIdx = candles.length - 1 - breakoutLookback;
    const lookbackEndIdx = candles.length - 1; // exclusive end for slice
    const previousCandles = candles.slice(lookbackStartIdx, lookbackEndIdx);

    const prevHighestHigh = Math.max(...previousCandles.map(c => c.high));
    const prevLowestLow = Math.min(...previousCandles.map(c => c.low));

    let breakoutPasses = false;
    if (isEmaBullish && currentCandle.close > prevHighestHigh) breakoutPasses = true;
    if (isEmaBearish && currentCandle.close < prevLowestLow) breakoutPasses = true;

    if (!breakoutPasses) {
      this.diagnostics.rejectedBreakout++;
      return { action: 'HOLD', timestamp: currentCandle.time, reason: ['NO_BREAKOUT'], strategyName: this.name };
    }

    // 5. Volume Filter
    if (currentCandle.volume < currentAvgVol * volumeMultiplier) {
      this.diagnostics.rejectedVolume++;
      return { action: 'HOLD', timestamp: currentCandle.time, reason: ['INSUFFICIENT_VOLUME'], strategyName: this.name };
    }

    // 6. Volatility Filter
    const atrPct = (currentAtr / currentCandle.close) * 100;
    if (atrPct < minimumAtrPct) {
      this.diagnostics.rejectedVolatility++;
      return { action: 'HOLD', timestamp: currentCandle.time, reason: ['INSUFFICIENT_VOLATILITY'], strategyName: this.name };
    }

    // Calculate SL and TP candidates
    const entry = currentCandle.close;
    let sl = 0;
    let tp = 0;

    if (isEmaBullish) {
      sl = entry - currentAtr * atrStopMultiplier;
      tp = entry + (entry - sl) * rewardRisk;
    } else {
      sl = entry + currentAtr * atrStopMultiplier;
      tp = entry - (sl - entry) * rewardRisk;
    }

    // 7. Cost-Aware Filter
    // We expect the BacktestEngine to inject `costConfig` via `config`.
    // We need to read it. Since `config` in `Strategy.evaluate` is `StrategyConfig`, we might need to cast or access dynamically.
    // The engine's BacktestConfig has `costConfig`, but StrategyConfig is a sub-object.
    // Wait, `context` doesn't have `costConfig`. Does the `BacktestEngine` pass the full config?
    // Let's check `BacktestEngine`.
    // For now, if we pass `costConfig` into `strategyConfig` in the script, we can access it.
    // Let's assume we pass `feePerSidePct` and `slippagePerSidePct` directly inside `StrategyConfig` just for the strategy to read, or we can read from `config.costConfig`.
    const feePct = (config.costConfig as any)?.feePerSidePct ?? 0.20;
    const slippagePct = (config.costConfig as any)?.slippagePerSidePct ?? 0.10;
    
    const roundTripCostPct = 2 * (feePct + slippagePct);
    const requiredEdgePct = roundTripCostPct * minimumEdgeMultiplier;

    const expectedMovePct = (Math.abs(tp - entry) / entry) * 100;

    if (expectedMovePct < requiredEdgePct) {
      this.diagnostics.rejectedCostFilter++;
      return { action: 'HOLD', timestamp: currentCandle.time, reason: ['INSUFFICIENT_EDGE_FOR_COSTS'], strategyName: this.name };
    }

    // If we made it here, it's a valid signal
    if (isEmaBullish) {
      this.diagnostics.finalLongSignals++;
      return {
        action: 'OPEN_LONG',
        timestamp: currentCandle.time,
        entryPrice: entry,
        stopLoss: sl,
        takeProfit: tp,
        reason: ['V5_LONG_BREAKOUT'],
        strategyName: this.name
      };
    } else {
      this.diagnostics.finalShortSignals++;
      return {
        action: 'OPEN_SHORT',
        timestamp: currentCandle.time,
        entryPrice: entry,
        stopLoss: sl,
        takeProfit: tp,
        reason: ['V5_SHORT_BREAKOUT'],
        strategyName: this.name
      };
    }
  }
}

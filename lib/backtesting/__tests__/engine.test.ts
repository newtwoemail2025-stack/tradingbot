import { BacktestEngine } from '../engine';
import { Strategy, StrategyConfig, StrategyContext, StrategySignal, BacktestConfig } from '../../../types/strategy';
import { Candle } from '../../../types';

class DummyStrategy implements Strategy {
  name = 'Dummy';
  evaluate(candles: Candle[], config: StrategyConfig, context: StrategyContext): StrategySignal {
    const last = candles[candles.length - 1];
    if (last.time === 2) {
      return { action: 'OPEN_LONG', timestamp: last.time, entryPrice: last.close, stopLoss: last.close - 10, takeProfit: last.close + 20, reason: [], strategyName: 'Dummy' };
    }
    if (last.time === 5) {
      return { action: 'OPEN_SHORT', timestamp: last.time, entryPrice: last.close, stopLoss: last.close + 10, takeProfit: last.close - 20, reason: [], strategyName: 'Dummy' };
    }
    return { action: 'HOLD', timestamp: last.time, reason: [], strategyName: 'Dummy' };
  }
}

describe('BacktestEngine', () => {
  const config: BacktestConfig = {
    initialCapital: 10000,
    riskPerTradePercent: 1.0,
    costConfig: { feePerSidePct: 0.1, slippagePerSidePct: 0.1 },
    strategyConfig: {}
  };

  const candles: Candle[] = [
    { time: 1, open: 100, high: 100, low: 100, close: 100 },
    { time: 2, open: 100, high: 100, low: 100, close: 100 }, // OPEN_LONG at 100
    { time: 3, open: 100, high: 105, low: 95, close: 105 },  
    { time: 4, open: 105, high: 125, low: 105, close: 120 }, // Hits TP (100 + 20 = 120)
    { time: 5, open: 120, high: 120, low: 120, close: 120 }, // OPEN_SHORT at 120
    { time: 6, open: 120, high: 135, low: 120, close: 130 }, // Hits SL (120 + 10 = 130)
  ];

  it('runs backtest and calculates metrics including fees and slippage', () => {
    const engine = new BacktestEngine(new DummyStrategy(), config);
    const metrics = engine.run(candles);

    expect(metrics.totalTrades).toBe(2);
    expect(metrics.winningTrades).toBe(1); // Long won
    expect(metrics.losingTrades).toBe(1);  // Short lost
    expect(metrics.winRate).toBe(50);
    
    // Fees and slippage should be tracked
    expect(metrics.totalFees).toBeGreaterThan(0);
    expect(metrics.totalSlippage).toBeGreaterThan(0);
    
    // Final capital should be updated
    expect(metrics.finalCapital).not.toBe(10000);
    expect(metrics.equityCurve.length).toBeGreaterThan(0);
  });
});

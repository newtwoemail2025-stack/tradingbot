import { MomentumStrategyV1 } from '../momentumV1';
import { Candle } from '../../../types';
import { StrategyConfig, StrategyContext } from '../../../types/strategy';

describe('MomentumStrategyV1', () => {
  const strategy = new MomentumStrategyV1();
  const defaultConfig: StrategyConfig = {
    emaFast: 2,
    emaSlow: 5,
    rsiPeriod: 3,
    longRsi: 55,
    shortRsi: 45,
    atrPeriod: 3,
    atrMultiplier: 1.5,
    riskReward: 2.0
  };
  
  const defaultContext: StrategyContext = {
    openPositions: [],
    events: [],
    currentBalance: 10000
  };

  it('returns HOLD if insufficient candles', () => {
    const candles: Candle[] = [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
    const result = strategy.evaluate(candles, defaultConfig, defaultContext);
    expect(result.action).toBe('HOLD');
    expect(result.reason[0]).toBe('Insufficient historical candles');
  });

  // Since we require 50 candles for MomentumStrategyV1 to bypass the hardcoded `candles.length < 50` check,
  // we will generate 50 dummy candles.
  const generateCandles = (trend: 'UP' | 'DOWN' | 'FLAT'): Candle[] => {
    const candles: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 55; i++) {
      if (trend === 'UP') price += 1;
      if (trend === 'DOWN') price -= 1;
      // Last few candles dictate volume
      const volume = i > 50 ? 200 : 50; 
      candles.push({ time: i, open: price, high: price + 1, low: price - 1, close: price, volume });
    }
    return candles;
  };

  it('generates OPEN_LONG on strong uptrend', () => {
    const upCandles = generateCandles('UP');
    const result = strategy.evaluate(upCandles, defaultConfig, defaultContext);
    
    // Fast EMA > Slow EMA, RSI > 55, Vol > AvgVol
    expect(result.action).toBe('OPEN_LONG');
    expect(result.stopLoss).toBeLessThan(result.entryPrice!);
    expect(result.takeProfit).toBeGreaterThan(result.entryPrice!);
  });

  it('generates OPEN_SHORT on strong downtrend', () => {
    const downCandles = generateCandles('DOWN');
    const result = strategy.evaluate(downCandles, defaultConfig, defaultContext);
    
    // Fast EMA < Slow EMA, RSI < 45, Vol > AvgVol
    expect(result.action).toBe('OPEN_SHORT');
    expect(result.stopLoss).toBeGreaterThan(result.entryPrice!);
    expect(result.takeProfit).toBeLessThan(result.entryPrice!);
  });

  it('generates HOLD on flat market', () => {
    const flatCandles = generateCandles('FLAT');
    const result = strategy.evaluate(flatCandles, defaultConfig, defaultContext);
    
    expect(result.action).toBe('HOLD');
  });
});

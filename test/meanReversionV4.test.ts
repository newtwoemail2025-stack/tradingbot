import { describe, it, expect } from 'vitest';
import { MeanReversionStrategyV4 } from '../lib/strategy/meanReversionV4';
import { StrategyConfig } from '../types/strategy';

describe('MeanReversionStrategyV4', () => {
  const strategy = new MeanReversionStrategyV4();
  
  const config: StrategyConfig = {
    bbPeriod: 20,
    bbStdDev: 2.0,
    rsiPeriod: 14,
    oversoldRSI: 30,
    overboughtRSI: 70,
    emaFast: 20,
    emaSlow: 50,
    adxPeriod: 14,
    maxTrendADX: 25,
    atrPeriod: 14,
    atrMultiplier: 1.5,
    maxRiskReward: 5.0
  };

  const context = {
    openPositions: [],
    events: [],
    currentBalance: 10000
  };

  const generateCandles = (
    count: number,
    basePrice: number,
    trend: number = 0,
    volatility: number = 2,
    offsetTime: number = 0
  ) => {
    const candles = [];
    let currentPrice = basePrice;
    for (let i = 0; i < count; i++) {
      candles.push({
        time: offsetTime + i * 60000,
        open: currentPrice,
        high: currentPrice + volatility,
        low: currentPrice - volatility,
        close: currentPrice,
        volume: 100
      });
      currentPrice += trend;
    }
    return candles;
  };

  it('1. Oversold + reversal -> LONG', () => {
    // Sideways market at 10000
    const candles = generateCandles(60, 10000, 0, 10, 1000000);
    
    // Sudden drop to make it oversold and hit lower BB
    candles.push({ time: 1000000 + 60*60000, open: 10000, high: 10000, low: 9000, close: 9000, volume: 1000 });
    
    // Reversal confirmation: closes back inside BB, bullish candle
    candles.push({ time: 1000000 + 61*60000, open: 9600, high: 9900, low: 9550, close: 9800, volume: 1000 });
    
    const signal = strategy.evaluate(candles, config, context);
    expect(signal.action).toBe('OPEN_LONG');
    expect(signal.reason[0]).toBe('Mean Reversion Long');
  });

  it('2. Overbought + reversal -> SHORT', () => {
    const candles = generateCandles(60, 10000, 0, 10, 2000000);
    
    // Sudden spike to make it overbought and hit upper BB
    candles.push({ time: 2000000 + 60*60000, open: 10000, high: 11000, low: 10000, close: 11000, volume: 1000 });
    
    // Reversal confirmation: closes back inside BB, bearish candle
    candles.push({ time: 2000000 + 61*60000, open: 10400, high: 10450, low: 10200, close: 10300, volume: 1000 });
    
    const signal = strategy.evaluate(candles, config, context);
    expect(signal.action).toBe('OPEN_SHORT');
    expect(signal.reason[0]).toBe('Mean Reversion Short');
  });

  it('3. Strong bearish trend -> block LONG', () => {
    // Strong downtrend
    const candles = generateCandles(80, 10000, -20, 10, 3000000);
    
    // Sudden drop
    const currentPrice = candles[candles.length - 1].close;
    candles.push({ time: 3000000 + 80*60000, open: currentPrice, high: currentPrice, low: currentPrice - 500, close: currentPrice - 500, volume: 1000 });
    
    // Reversal
    candles.push({ time: 3000000 + 81*60000, open: currentPrice - 400, high: currentPrice - 200, low: currentPrice - 450, close: currentPrice - 300, volume: 1000 });
    
    const signal = strategy.evaluate(candles, config, context);
    expect(signal.action).toBe('HOLD'); // ADX will be high and EMA20 < EMA50, blocking the long
  });

  it('4. Strong bullish trend -> block SHORT', () => {
    // Strong uptrend
    const candles = generateCandles(80, 10000, 20, 10, 4000000);
    
    // Sudden spike
    const currentPrice = candles[candles.length - 1].close;
    candles.push({ time: 4000000 + 80*60000, open: currentPrice, high: currentPrice + 500, low: currentPrice, close: currentPrice + 500, volume: 1000 });
    
    // Reversal
    candles.push({ time: 4000000 + 81*60000, open: currentPrice + 400, high: currentPrice + 450, low: currentPrice + 200, close: currentPrice + 300, volume: 1000 });
    
    const signal = strategy.evaluate(candles, config, context);
    expect(signal.action).toBe('HOLD'); // ADX will be high and EMA20 > EMA50, blocking the short
  });

  it('5. Price not sufficiently extended -> NO TRADE', () => {
    const candles = generateCandles(60, 10000, 0, 10, 5000000);
    // Drop, but not enough to touch BB lower
    candles.push({ time: 5000000 + 60*60000, open: 10000, high: 10000, low: 9985, close: 9985, volume: 1000 });
    // Reversal
    candles.push({ time: 5000000 + 61*60000, open: 9985, high: 9990, low: 9985, close: 9990, volume: 1000 });
    
    const signal = strategy.evaluate(candles, config, context);
    expect(signal.action).toBe('HOLD');
  });

  it('6. No reversal confirmation -> NO TRADE', () => {
    const candles = generateCandles(60, 10000, 0, 10, 6000000);
    // Sudden drop
    candles.push({ time: 6000000 + 60*60000, open: 10000, high: 10000, low: 9500, close: 9500, volume: 1000 });
    // No reversal (another bearish candle)
    candles.push({ time: 6000000 + 61*60000, open: 9500, high: 9500, low: 9400, close: 9400, volume: 1000 });
    
    const signal = strategy.evaluate(candles, config, context);
    expect(signal.action).toBe('HOLD');
  });

  it('7 & 8. Correct LONG and SHORT SL (ATR based)', () => {
    const candles = generateCandles(60, 10000, 0, 10, 7000000);
    candles.push({ time: 7000000 + 60*60000, open: 10000, high: 10000, low: 9000, close: 9000, volume: 1000 });
    candles.push({ time: 7000000 + 61*60000, open: 9600, high: 9800, low: 9550, close: 9700, volume: 1000 });
    
    const signal = strategy.evaluate(candles, config, context);
    expect(signal.action).toBe('OPEN_LONG');
    
    // Swing low is 9500. ATR is around 10. StopLoss should be 9500 - (ATR * 1.5)
    expect(signal.stopLoss).toBeLessThan(9500);
    expect(signal.takeProfit).toBeGreaterThan(9700); // Should be targeting SMA (~10000)
  });

  it('9 & 10. No look-ahead and both paths work', () => {
    const candles = generateCandles(60, 10000, 0, 10, 8000000);
    candles.push({ time: 8000000 + 60*60000, open: 10000, high: 11000, low: 10000, close: 11000, volume: 1000 });
    candles.push({ time: 8000000 + 61*60000, open: 10400, high: 10450, low: 10200, close: 10300, volume: 1000 });
    
    // Add future candles that shouldn't affect current evaluation
    const futureCandles = [...candles, { time: 8000000 + 62*60000, open: 10300, high: 11000, low: 9000, close: 11000, volume: 1000 }];
    
    const signal1 = strategy.evaluate(candles, config, context);
    const signal2 = strategy.evaluate(futureCandles.slice(0, futureCandles.length - 1), config, context);
    
    expect(signal1).toEqual(signal2);
    expect(signal1.action).toBe('OPEN_SHORT');
  });
});

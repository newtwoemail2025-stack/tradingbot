import { MomentumStrategyV2 } from '../momentumV2';
import { StrategyConfig, StrategyContext } from '../../../types/strategy';
import { Candle } from '../../../types';

describe('MomentumStrategyV2', () => {
  let strategy: MomentumStrategyV2;
  let baseConfig: StrategyConfig;
  let baseContext: StrategyContext;

  beforeEach(() => {
    strategy = new MomentumStrategyV2();
    baseConfig = {
      emaFast: 2,
      emaSlow: 5,
      rsiPeriod: 2,
      longRsi: 55,
      shortRsi: 45,
      adxPeriod: 2,
      minimumADX: 20,
      minimumEMASeparation: 0.01,
      breakoutCandles: 2,
      volumeMultiplier: 1.2,
      minimumATRPercent: 0.01,
      atrPeriod: 2,
      atrMultiplier: 1.5,
      riskReward: 2.0
    };
    baseContext = {
      openPositions: [],
      events: [],
      currentBalance: 10000
    };
  });

  const createCandles = (basePrice: number, trend: 'UP' | 'DOWN' | 'SIDEWAYS', volumeMultiplier = 1): Candle[] => {
    // Generate enough candles to pass maxPeriod
    const count = 10;
    return Array.from({ length: count }, (_, i) => {
      let close = basePrice;
      if (trend === 'UP') close += i * (basePrice * 0.05);
      if (trend === 'DOWN') close -= i * (basePrice * 0.05);
      if (trend === 'SIDEWAYS') close += (i % 2 === 0 ? 1 : -1) * (basePrice * 0.001); // very tight

      return {
        time: i * 60000,
        open: close - 5,
        high: close + (trend === 'SIDEWAYS' ? 1 : 20),
        low: close - (trend === 'SIDEWAYS' ? 1 : 20),
        close,
        volume: 1000 * volumeMultiplier * (i === count - 1 ? 1.5 : 1) // pump volume on last candle
      };
    });
  };

  it('rejects if not enough candles', () => {
    const signal = strategy.evaluate([{ time: 0, open: 1, high: 2, low: 0, close: 1, volume: 100 }], baseConfig, baseContext);
    expect(signal.action).toBe('HOLD');
  });

  it('returns OPEN_LONG with strong UP trend and high volume', () => {
    const candles = createCandles(1000, 'UP', 2);
    const signal = strategy.evaluate(candles, baseConfig, baseContext);
    
    expect(signal.action).toBe('OPEN_LONG');
    expect(signal.stopLoss).toBeDefined();
    expect(signal.takeProfit).toBeDefined();
    
    // verify risk reward = 2.0
    const risk = signal.entryPrice! - signal.stopLoss!;
    const reward = signal.takeProfit! - signal.entryPrice!;
    expect(reward / risk).toBeCloseTo(2.0, 1);
  });

  it('returns OPEN_SHORT with strong DOWN trend and high volume', () => {
    const candles = createCandles(1000, 'DOWN', 2);
    const signal = strategy.evaluate(candles, baseConfig, baseContext);
    
    expect(signal.action).toBe('OPEN_SHORT');
    expect(signal.stopLoss).toBeDefined();
    expect(signal.takeProfit).toBeDefined();
  });

  it('returns HOLD if ADX is weak', () => {
    // Generate an incredibly choppy sideways market
    const candles = createCandles(1000, 'SIDEWAYS', 2);
    // Force a breakout on the last candle just to pass the breakout test
    candles[candles.length - 1].close = 1500;
    
    // We expect it to hold.
    const signal = strategy.evaluate(candles, baseConfig, baseContext);
    expect(signal.action).toBe('HOLD');
  });

  it('returns HOLD if EMA separation is insufficient', () => {
    const candles = createCandles(1000, 'UP', 2);
    // require massive separation
    const signal = strategy.evaluate(candles, { ...baseConfig, minimumEMASeparation: 0.5 }, baseContext);
    expect(signal.action).toBe('HOLD');
    expect(signal.reason[0]).toContain('EMA separation');
  });

  it('returns HOLD if Volatility is insufficient', () => {
    const candles = createCandles(1000, 'UP', 2);
    // require massive volatility
    const signal = strategy.evaluate(candles, { ...baseConfig, minimumATRPercent: 0.5 }, baseContext);
    expect(signal.action).toBe('HOLD');
    expect(signal.reason[0]).toContain('Volatility');
  });

  it('returns HOLD if Volume is insufficient', () => {
    const candles = createCandles(1000, 'UP', 1); // 1.5x on last candle
    // require 3x volume
    const signal = strategy.evaluate(candles, { ...baseConfig, volumeMultiplier: 3.0 }, baseContext);
    expect(signal.action).toBe('HOLD');
    expect(signal.reason[0]).toContain('Insufficient volume');
  });

  it('returns HOLD if Price does not Breakout', () => {
    const candles = createCandles(1000, 'UP', 2);
    // Sabotage the last candle's close so it's not a breakout
    candles[candles.length - 1].close = candles[candles.length - 2].close - 10;
    
    const signal = strategy.evaluate(candles, baseConfig, baseContext);
    expect(signal.action).toBe('HOLD');
  });

  it('returns HOLD on SIDEWAYS chop despite volume', () => {
    const candles = createCandles(1000, 'SIDEWAYS', 2);
    const signal = strategy.evaluate(candles, baseConfig, baseContext);
    expect(signal.action).toBe('HOLD');
  });
});

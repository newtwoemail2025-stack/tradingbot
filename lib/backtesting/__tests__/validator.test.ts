import { StrategyValidator } from '../validator';
import { Strategy, StrategyConfig, StrategyContext, StrategySignal, BacktestConfig } from '../../../types/strategy';
import { Candle } from '../../../types';

class MockStrategy implements Strategy {
  name = 'Mock';
  evaluate(candles: Candle[], config: StrategyConfig, context: StrategyContext): StrategySignal {
    return { action: 'HOLD', timestamp: candles[candles.length - 1].time, reason: [], strategyName: 'Mock' };
  }
}

describe('StrategyValidator', () => {
  const defaultConfig: BacktestConfig = {
    initialCapital: 10000,
    riskPerTradePercent: 1.0,
    costConfig: { feePerSidePct: 0.1, slippagePerSidePct: 0.1 },
    strategyConfig: {}
  };

  const createCandles = (count: number): Candle[] => {
    return Array.from({ length: count }, (_, i) => ({
      time: i * 60000,
      open: 100, high: 105, low: 95, close: 100, volume: 100
    }));
  };

  let validator: StrategyValidator;

  beforeEach(() => {
    validator = new StrategyValidator(new MockStrategy(), defaultConfig);
  });

  describe('runChronologicalSplit', () => {
    it('returns INSUFFICIENT DATA if candles < 100', () => {
      const candles = createCandles(50);
      const result = validator.runChronologicalSplit(candles);
      expect(result.verdict).toBe('INSUFFICIENT DATA');
    });

    it('splits candles into Train (60%), Val (20%), Test (20%) correctly', () => {
      const candles = createCandles(1000); // 600, 200, 200
      const result = validator.runChronologicalSplit(candles, 0.6, 0.2);
      
      expect(result.train.baseline.equityCurve.length).toBe(601);
      expect(result.validation.baseline.equityCurve.length).toBe(201);
      expect(result.test.baseline.equityCurve.length).toBe(201);
    });

    it('returns INSUFFICIENT TRADES if total trades < 30', () => {
      const candles = createCandles(1000);
      const result = validator.runChronologicalSplit(candles);
      expect(result.verdict).toBe('INSUFFICIENT TRADES');
    });
  });

  describe('runWalkForward', () => {
    it('creates rolling windows correctly', () => {
      const candles = createCandles(100);
      
      const result = validator.runWalkForward(candles, 50, 25);
      expect(result.windows.length).toBe(2);
      expect(result.windows[0].train.baseline.equityCurve.length).toBe(51);
      expect(result.windows[0].test.baseline.equityCurve.length).toBe(26);
      expect(result.windows[1].train.baseline.equityCurve.length).toBe(51);
      expect(result.windows[1].test.baseline.equityCurve.length).toBe(26);
    });
  });
});

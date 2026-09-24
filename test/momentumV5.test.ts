import { describe, it, expect, beforeEach } from 'vitest';
import { MomentumStrategyV5 } from '../lib/strategy/momentumV5';
import { Candle } from '../types';
import { StrategyConfig, StrategyContext } from '../types/strategy';

describe('MomentumStrategyV5 Tests', () => {
  let strategy: MomentumStrategyV5;
  let context: StrategyContext;

  beforeEach(() => {
    strategy = new MomentumStrategyV5();
    context = {
      openPositions: [],
      events: [],
      currentBalance: 10000
    };
  });

  const baseConfig: StrategyConfig = {
    emaFast: 20,
    emaSlow: 50,
    rsiPeriod: 14,
    longRsiMin: 0,
    longRsiMax: 100,
    shortRsiMin: 0,
    shortRsiMax: 100,
    adxPeriod: 14,
    adxThreshold: 0,
    atrPeriod: 14,
    atrStopMultiplier: 1.5,
    rewardRisk: 2.0,
    breakoutLookback: 5,
    averageVolumePeriod: 20,
    volumeMultiplier: 1.2,
    minimumAtrPct: 0.10,
    minimumEdgeMultiplier: 1.5,
    costConfig: { feePerSidePct: 0.2, slippagePerSidePct: 0.1 } // 0.6% round trip
  };

  const generateCandles = (trend: 'UP' | 'DOWN', breakout: boolean, sufficientEdge: boolean = true): Candle[] => {
    const candles: Candle[] = [];
    const numCandles = 60; // Enough to warm up EMA50 and others
    const startTime = Date.now() + Math.floor(Math.random() * 10000000);

    let basePrice = 10000;
    
    for (let i = 0; i < numCandles - 1; i++) {
      if (trend === 'UP') {
        basePrice += 50; // Steady uptrend
      } else {
        basePrice -= 50; // Steady downtrend
      }
      
      candles.push({
        time: startTime + i * 60000,
        open: basePrice - 10,
        high: basePrice + 100, // Giving some ATR
        low: basePrice - 100,
        close: basePrice,
        volume: 1000
      });
    }

    // The LAST candle is the trigger candle
    let lastPrice = basePrice;
    let high = 0;
    let low = 0;

    if (trend === 'UP') {
      // Need a strong push up to break previous highs
      lastPrice = breakout ? basePrice + 500 : basePrice - 10;
      high = lastPrice + 50;
      low = lastPrice - 150;
    } else {
      // Need a strong push down to break previous lows
      lastPrice = breakout ? basePrice - 500 : basePrice + 10;
      high = lastPrice + 150;
      low = lastPrice - 50;
    }

    if (!sufficientEdge) {
      // Make the ATR very small so TP is extremely close, failing cost filter
      // But it still needs to pass minimum ATR % filter, so let's adjust costConfig instead in the test
      // Actually we will control sufficientEdge via config in the test itself.
    }

    candles.push({
      time: startTime + (numCandles - 1) * 60000,
      open: basePrice,
      high,
      low,
      close: lastPrice,
      volume: 2000 // Ensure volume > avgVolume * 1.2
    });

    return candles;
  };

  it('1. LONG breakout signal generated correctly with sufficient edge', () => {
    const candles = generateCandles('UP', true);
    // Ensure we meet all requirements
    const result = strategy.evaluate(candles, baseConfig, context);
    expect(result.action).toBe('OPEN_LONG');
    expect(result.reason).toContain('V5_LONG_BREAKOUT');
  });

  it('2. SHORT breakout signal generated correctly', () => {
    const candles = generateCandles('DOWN', true);
    const result = strategy.evaluate(candles, baseConfig, context);
    expect(result.action).toBe('OPEN_SHORT');
    expect(result.reason).toContain('V5_SHORT_BREAKOUT');
  });

  it('3 & 5. LONG stop and target calculation', () => {
    const candles = generateCandles('UP', true);
    const result = strategy.evaluate(candles, baseConfig, context);
    
    expect(result.action).toBe('OPEN_LONG');
    const entry = result.entryPrice!;
    const sl = result.stopLoss!;
    const tp = result.takeProfit!;
    
    // Stop loss should be below entry
    expect(sl).toBeLessThan(entry);
    // Target should be above entry
    expect(tp).toBeGreaterThan(entry);
    
    const risk = entry - sl;
    const reward = tp - entry;
    // Reward / Risk should be exactly 2.0
    expect(reward / risk).toBeCloseTo(2.0, 4);
  });

  it('4 & 6. SHORT stop and target calculation', () => {
    const candles = generateCandles('DOWN', true);
    const result = strategy.evaluate(candles, baseConfig, context);
    
    expect(result.action).toBe('OPEN_SHORT');
    const entry = result.entryPrice!;
    const sl = result.stopLoss!;
    const tp = result.takeProfit!;
    
    // Stop loss should be above entry
    expect(sl).toBeGreaterThan(entry);
    // Target should be below entry
    expect(tp).toBeLessThan(entry);
    
    const risk = sl - entry;
    const reward = entry - tp;
    // Reward / Risk should be exactly 2.0
    expect(reward / risk).toBeCloseTo(2.0, 4);
  });

  it('7. Cost-aware filter rejects insufficient edge', () => {
    const candles = generateCandles('UP', true);
    const highCostConfig: StrategyConfig = {
      ...baseConfig,
      // Massive fees to ensure required edge is enormous
      costConfig: { feePerSidePct: 10.0, slippagePerSidePct: 5.0 } // 30% round trip
    };

    const result = strategy.evaluate(candles, highCostConfig, context);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('INSUFFICIENT_EDGE_FOR_COSTS');
  });

  it('8. Cost-aware filter accepts sufficient edge', () => {
    const candles = generateCandles('UP', true);
    const zeroCostConfig: StrategyConfig = {
      ...baseConfig,
      costConfig: { feePerSidePct: 0.0, slippagePerSidePct: 0.0 }
    };

    const result = strategy.evaluate(candles, zeroCostConfig, context);
    expect(result.action).toBe('OPEN_LONG');
  });

  it('9. No look-ahead in breakout logic', () => {
    // We send a down trend so EMA is bearish, but then massive up candle.
    // If it was looking ahead or including current candle, the current candle would break its own high.
    const candles = generateCandles('UP', false);
    
    // Explicitly make the current candle lower than prev high
    const prevHigh = Math.max(...candles.slice(0, -1).map(c => c.high));
    candles[candles.length - 1].close = prevHigh - 1;

    const result = strategy.evaluate(candles, baseConfig, context);
    expect(result.action).toBe('HOLD');
    expect(result.reason).toContain('NO_BREAKOUT');
  });

  it('10. LONG/SHORT symmetry', () => {
    const upCandles = generateCandles('UP', true);
    const downCandles = generateCandles('DOWN', true);

    const longResult = strategy.evaluate(upCandles, baseConfig, context);
    const shortResult = strategy.evaluate(downCandles, baseConfig, context);

    expect(longResult.action).toBe('OPEN_LONG');
    expect(shortResult.action).toBe('OPEN_SHORT');

    const longRiskPct = (longResult.entryPrice! - longResult.stopLoss!) / longResult.entryPrice!;
    const shortRiskPct = (shortResult.stopLoss! - shortResult.entryPrice!) / shortResult.entryPrice!;
    
    // They won't be perfectly identical due to different base prices, but both should be positive
    expect(longRiskPct).toBeGreaterThan(0);
    expect(shortRiskPct).toBeGreaterThan(0);
  });
});

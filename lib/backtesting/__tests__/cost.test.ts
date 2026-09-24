import { expect, test, describe } from 'vitest';
import { BacktestEngine } from '../engine';
import { Strategy, StrategyContext, BacktestConfig } from '../../../types/strategy';
import { Candle } from '../../../types';

class MockStrategy implements Strategy {
  name = 'Mock';
  constructor(public side: 'LONG' | 'SHORT') {}

  evaluate(candles: Candle[], config: any, context: StrategyContext) {
    if (context.openPositions.length === 0 && candles.length === 1) {
      return {
        action: this.side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        timestamp: candles[0].time,
        entryPrice: 100, // RAW entry price
        stopLoss: this.side === 'LONG' ? 90 : 110,
        takeProfit: this.side === 'LONG' ? 105 : 95,
        reason: ['TEST'],
        strategyName: 'Mock'
      } as const;
    }
    return { action: 'HOLD', reason: [], strategyName: 'Mock' } as const;
  }
}

const defaultCandles: Candle[] = [
  { time: 1000, open: 100, high: 100, low: 100, close: 100, volume: 100 },
];
const longCandles = [...defaultCandles, { time: 2000, open: 100, high: 105, low: 100, close: 105, volume: 100 }];
const shortCandles = [...defaultCandles, { time: 2000, open: 100, high: 100, low: 95, close: 95, volume: 100 }];

describe('BacktestCostConfig', () => {
  test('default configuration produces the same existing behavior', () => {
    const config: BacktestConfig = {
      initialCapital: 1000,
      riskPerTradePercent: 1.0,
      strategyConfig: {}
    };
    const engine = new BacktestEngine(new MockStrategy('LONG'), config);
    const metrics = engine.run(longCandles);
    
    // Default is 0.2% fee per side, 0.1% slippage per side
    // Entry price 100. Slippage LONG -> +0.1% = 100.1
    // Exit price 105. Slippage LONG -> -0.1% = 104.895
    expect(metrics.trades.length).toBe(1);
    expect(metrics.trades[0].entryPrice).toBeCloseTo(100.1);
    expect(metrics.trades[0].exitPrice).toBeCloseTo(104.895);
    // fee = 100.1 * 0.002 + 104.895 * 0.002 = 0.40998 per share
    // Let's just ensure default values are used implicitly
    expect(metrics.trades[0].fees).toBeGreaterThan(0);
    expect(metrics.trades[0].slippage).toBeGreaterThan(0);
  });

  test('invalid negative costs are rejected', () => {
    expect(() => {
      new BacktestEngine(new MockStrategy('LONG'), {
        initialCapital: 1000,
        riskPerTradePercent: 1.0,
        costConfig: { feePerSidePct: -0.1, slippagePerSidePct: 0.1 },
        strategyConfig: {}
      });
    }).toThrow(/non-negative/);

    expect(() => {
      new BacktestEngine(new MockStrategy('LONG'), {
        initialCapital: 1000,
        riskPerTradePercent: 1.0,
        costConfig: { feePerSidePct: 0.1, slippagePerSidePct: -0.1 },
        strategyConfig: {}
      });
    }).toThrow(/non-negative/);
  });

  test('custom fee configuration changes P&L correctly', () => {
    const configZero: BacktestConfig = {
      initialCapital: 1000,
      riskPerTradePercent: 1.0,
      costConfig: { feePerSidePct: 0.0, slippagePerSidePct: 0.0 },
      strategyConfig: {}
    };
    const engineZero = new BacktestEngine(new MockStrategy('LONG'), configZero);
    const metricsZero = engineZero.run(longCandles);

    const configFee: BacktestConfig = {
      initialCapital: 1000,
      riskPerTradePercent: 1.0,
      costConfig: { feePerSidePct: 1.0, slippagePerSidePct: 0.0 },
      strategyConfig: {}
    };
    const engineFee = new BacktestEngine(new MockStrategy('LONG'), configFee);
    const metricsFee = engineFee.run(longCandles);

    expect(metricsFee.trades[0].fees).toBeGreaterThan(0);
    expect(metricsZero.trades[0].fees).toBe(0);
    expect(metricsFee.trades[0].netPnl).toBeLessThan(metricsZero.trades[0].netPnl);
    expect(metricsFee.trades[0].grossPnl).toBe(metricsZero.trades[0].grossPnl);
  });

  test('custom slippage configuration changes execution prices correctly', () => {
    const configZero: BacktestConfig = {
      initialCapital: 1000,
      riskPerTradePercent: 1.0,
      costConfig: { feePerSidePct: 0.0, slippagePerSidePct: 0.0 },
      strategyConfig: {}
    };
    const engineZero = new BacktestEngine(new MockStrategy('LONG'), configZero);
    const metricsZero = engineZero.run(longCandles);

    const configSlippage: BacktestConfig = {
      initialCapital: 1000,
      riskPerTradePercent: 1.0,
      costConfig: { feePerSidePct: 0.0, slippagePerSidePct: 1.0 }, // 1%
      strategyConfig: {}
    };
    const engineSlippage = new BacktestEngine(new MockStrategy('LONG'), configSlippage);
    const metricsSlippage = engineSlippage.run(longCandles);

    expect(metricsSlippage.trades[0].entryPrice).toBeGreaterThan(metricsZero.trades[0].entryPrice);
    expect(metricsSlippage.trades[0].exitPrice).toBeLessThan(metricsZero.trades[0].exitPrice);
  });

  test('LONG and SHORT both work with custom costs', () => {
    const customConfig: BacktestConfig = {
      initialCapital: 1000,
      riskPerTradePercent: 1.0,
      costConfig: { feePerSidePct: 0.5, slippagePerSidePct: 0.5 },
      strategyConfig: {}
    };
    
    const engineLong = new BacktestEngine(new MockStrategy('LONG'), customConfig);
    const metricsLong = engineLong.run(longCandles);
    
    expect(metricsLong.trades[0].entryPrice).toBe(100.5); // 100 + 0.5%
    expect(metricsLong.trades[0].exitPrice).toBe(104.475); // 105 - 0.5%
    expect(metricsLong.trades[0].fees).toBeGreaterThan(0);

    const engineShort = new BacktestEngine(new MockStrategy('SHORT'), customConfig);
    const metricsShort = engineShort.run(shortCandles);

    expect(metricsShort.trades[0].entryPrice).toBe(99.5); // 100 - 0.5%
    expect(metricsShort.trades[0].exitPrice).toBe(95.475); // 95 + 0.5%
    expect(metricsShort.trades[0].fees).toBeGreaterThan(0);
  });
});

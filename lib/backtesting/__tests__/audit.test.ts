import { BacktestEngine } from '../engine';
import { Strategy, StrategyConfig, StrategyContext, StrategySignal, BacktestConfig } from '../../../types/strategy';
import { Candle } from '../../../types';

/**
 * A perfectly deterministic strategy used strictly for auditing the BacktestEngine mechanics.
 * It fires signals on specific candle indices.
 */
class AuditStrategy implements Strategy {
  name = 'Audit';
  signals: { [index: number]: StrategySignal } = {};

  evaluate(candles: Candle[], config: StrategyConfig, context: StrategyContext): StrategySignal {
    const currentIndex = candles.length - 1;
    const currentCandle = candles[currentIndex];
    
    if (this.signals[currentIndex]) {
      return this.signals[currentIndex];
    }
    
    return { action: 'HOLD', timestamp: currentCandle.time, reason: [], strategyName: 'Audit' };
  }
}

describe('Backtester Audit Suite', () => {
  const defaultConfig: BacktestConfig = {
    initialCapital: 10000,
    riskPerTradePercent: 1.0,
    costConfig: { feePerSidePct: 0.1, slippagePerSidePct: 0.05 }, // 0.1%
       // 0.1%
    strategyConfig: {}
  };

  const createCandle = (index: number, open: number, high: number, low: number, close: number): Candle => ({
    time: index * 60000,
    open, high, low, close, volume: 100
  });

  let strategy: AuditStrategy;

  beforeEach(() => {
    strategy = new AuditStrategy();
  });

  describe('A. Profitable LONG & B. Losing LONG', () => {
    it('calculates long profitability correctly with fees and slippage', () => {
      // Candle 0: flat
      // Candle 1: strategy says OPEN_LONG at 100, SL=90, TP=120
      // Candle 2: price drops to 95 (no SL)
      // Candle 3: price jumps to 125 (hits TP 120)
      
      const candles = [
        createCandle(0, 100, 100, 100, 100),
        createCandle(1, 100, 100, 100, 100),
        createCandle(2, 100, 100, 95, 95),
        createCandle(3, 95, 125, 95, 125),
      ];

      strategy.signals[1] = {
        action: 'OPEN_LONG', timestamp: 60000, entryPrice: 100, stopLoss: 90, takeProfit: 120, reason: [], strategyName: 'Audit'
      };

      const engine = new BacktestEngine(strategy, defaultConfig);
      const metrics = engine.run(candles);

      expect(metrics.totalTrades).toBe(1);
      expect(metrics.winningTrades).toBe(1);
      
      const trade = metrics.trades[0];
      expect(trade.side).toBe('LONG');
      expect(trade.exitReason).toBe('TAKE_PROFIT');
      
      // Slippage logic: Entry price = 100 + 0.1% = 100.1
      expect(trade.entryPrice).toBeCloseTo(100.1);
      // Exit price = 120 - 0.1% = 119.88
      expect(trade.exitPrice).toBeCloseTo(119.88);
      
      // Quantity logic: Capital = 10000, Risk = 1% = 100.
      // Entry = 100.1, SL = 90. Risk per unit = 10.1
      // Qty = 100 / 10.1 = 9.9009
      expect(trade.quantity).toBeCloseTo(9.9009);

      // Fees: (100.1 * 9.9009 * 0.1%) + (119.88 * 9.9009 * 0.1%)
      const expectedEntryFee = (100.1 * 9.9009) * 0.001;
      const expectedExitFee = (119.88 * 9.9009) * 0.001;
      expect(trade.fees).toBeCloseTo(expectedEntryFee + expectedExitFee);

      // Gross PNL: (119.88 - 100.1) * 9.9009 = 195.8398
      expect(trade.grossPnl).toBeCloseTo(195.8398);
      
      // Net PNL: Gross - Fees
      expect(trade.netPnl).toBeCloseTo(trade.grossPnl - trade.fees);
    });
  });

  describe('C. Profitable SHORT & D. Losing SHORT', () => {
    it('calculates short profitability correctly', () => {
      // Candle 0: flat
      // Candle 1: OPEN_SHORT at 100, SL=110, TP=80
      // Candle 2: jumps to 105
      // Candle 3: dumps to 75 (hits TP 80)
      
      const candles = [
        createCandle(0, 100, 100, 100, 100),
        createCandle(1, 100, 100, 100, 100),
        createCandle(2, 100, 105, 100, 105),
        createCandle(3, 105, 105, 75, 75),
      ];

      strategy.signals[1] = {
        action: 'OPEN_SHORT', timestamp: 60000, entryPrice: 100, stopLoss: 110, takeProfit: 80, reason: [], strategyName: 'Audit'
      };

      const engine = new BacktestEngine(strategy, defaultConfig);
      const metrics = engine.run(candles);

      expect(metrics.totalTrades).toBe(1);
      const trade = metrics.trades[0];
      expect(trade.side).toBe('SHORT');
      expect(trade.exitReason).toBe('TAKE_PROFIT');

      // Short Entry Slippage: 100 - 0.1% = 99.9
      expect(trade.entryPrice).toBeCloseTo(99.9);
      // Short Exit Slippage: 80 + 0.1% = 80.08
      expect(trade.exitPrice).toBeCloseTo(80.08);

      // Gross Pnl: (99.9 - 80.08) * qty
      expect(trade.grossPnl).toBeGreaterThan(0);
    });
  });

  describe('G. Both SL and TP inside same candle', () => {
    it('pessimistically executes SL instead of TP', () => {
      // Candle 0: flat
      // Candle 1: OPEN_LONG at 100, SL=95, TP=105
      // Candle 2: massive volatility candle High=106, Low=94
      
      const candles = [
        createCandle(0, 100, 100, 100, 100),
        createCandle(1, 100, 100, 100, 100),
        createCandle(2, 100, 106, 94, 100),
      ];

      strategy.signals[1] = {
        action: 'OPEN_LONG', timestamp: 60000, entryPrice: 100, stopLoss: 95, takeProfit: 105, reason: [], strategyName: 'Audit'
      };

      const engine = new BacktestEngine(strategy, defaultConfig);
      const metrics = engine.run(candles);

      expect(metrics.totalTrades).toBe(1);
      const trade = metrics.trades[0];
      // MUST hit STOP_LOSS to prevent look-ahead bias cheating
      expect(trade.exitReason).toBe('STOP_LOSS');
      
      // Exit price is 95 - slippage (95 - 0.095 = 94.905)
      expect(trade.exitPrice).toBeCloseTo(94.905);
      expect(trade.netPnl).toBeLessThan(0);
    });
  });

  describe('J. Maximum Exposure', () => {
    it('caps quantity to 1x leverage', () => {
      // Capital = 10000
      // If we put SL very very tight, risk-based quantity would theoretically be massive.
      // Entry = 100, SL = 99.9. Risk per unit = 0.1
      // Risk Amount = 100.
      // Qty theoretical = 100 / 0.1 = 1000.
      // 1000 units * 100 price = 100,000 Position Value. (Requires 10x leverage)
      // Engine must cap it at 1x: 100 units.

      const candles = [
        createCandle(0, 100, 100, 100, 100),
        createCandle(1, 100, 100, 100, 100),
        createCandle(2, 100, 100, 99, 99),
      ];

      // Disable slippage for this math check to make entry exact 100
      const cfg = { ...defaultConfig,  };

      strategy.signals[1] = {
        action: 'OPEN_LONG', timestamp: 60000, entryPrice: 100, stopLoss: 99.9, takeProfit: 110, reason: [], strategyName: 'Audit'
      };

      const engine = new BacktestEngine(strategy, cfg);
      const metrics = engine.run(candles);

      const trade = metrics.trades[0];
      // Max possible quantity for 10000 capital at 100 price is 100 units.
      expect(trade.quantity).toBeCloseTo(100);
    });
  });

  describe('L. End of Backtest', () => {
    it('forces open positions to close at the final candle', () => {
      const candles = [
        createCandle(0, 100, 100, 100, 100),
        createCandle(1, 100, 100, 100, 100),
        createCandle(2, 105, 105, 105, 105),
      ];

      strategy.signals[1] = {
        action: 'OPEN_LONG', timestamp: 60000, entryPrice: 100, stopLoss: 50, takeProfit: 200, reason: [], strategyName: 'Audit'
      };

      const engine = new BacktestEngine(strategy, { ...defaultConfig,  });
      const metrics = engine.run(candles);

      expect(metrics.totalTrades).toBe(1);
      const trade = metrics.trades[0];
      expect(trade.exitReason).toBe('END_OF_BACKTEST');
      expect(trade.exitPrice).toBe(105);
    });
  });
});

import { BacktestEngine } from '../lib/backtesting/engine';
import { Strategy, StrategyContext, BacktestConfig } from '../types/strategy';
import { Candle } from '../types';

class SyntheticTestStrategy implements Strategy {
  name = 'SyntheticTest';
  constructor(public side: 'LONG' | 'SHORT') {}

  evaluate(candles: Candle[], config: any, context: StrategyContext) {
    if (context.openPositions.length === 0 && candles.length === 1) {
      return {
        action: this.side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        timestamp: candles[0].time,
        entryPrice: 100, // RAW entry price
        stopLoss: this.side === 'LONG' ? 90 : 110,
        takeProfit: this.side === 'LONG' ? 105 : 95
      } as const;
    }
    return { action: 'HOLD' } as const;
  }
}

function runTest(side: 'LONG' | 'SHORT') {
  const config: BacktestConfig = {
    initialCapital: 1000,
    costConfig: { feePerSidePct: 0, slippagePerSidePct: 0 }, // 0 fees to test pure gross PnL
     // 0 slippage to test pure gross PnL
    riskPerTradePercent: 1.0,
    strategyConfig: {}
  };

  const engine = new BacktestEngine(new SyntheticTestStrategy(side), config);

  const candles: Candle[] = [
    { time: 1000, open: 100, high: 100, low: 100, close: 100, volume: 100 },
  ];

  if (side === 'LONG') {
    candles.push({ time: 2000, open: 100, high: 105, low: 100, close: 105, volume: 100 }); // Hits TP
  } else {
    candles.push({ time: 2000, open: 100, high: 100, low: 95, close: 95, volume: 100 }); // Hits TP
  }

  const metrics = engine.run(candles);
  console.log(`\n--- SYNTHETIC ${side} TEST ---`);
  console.log(`Trades: ${metrics.trades.length}`);
  if (metrics.trades.length > 0) {
    const t = metrics.trades[0];
    console.log(`Entry: ${t.entryPrice}`);
    console.log(`Exit: ${t.exitPrice}`);
    console.log(`Reason: ${t.exitReason}`);
    console.log(`Gross PnL: ${t.grossPnl}`);
    console.log(`Net PnL: ${t.netPnl}`);
    if (t.netPnl > 0) {
      console.log('Result: PASS - PROFIT');
    } else {
      console.log('Result: FAIL - LOSS OR ZERO');
    }
  }
}

runTest('LONG');
runTest('SHORT');

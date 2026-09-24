import fs from 'fs';
import { MomentumStrategyV5 } from '../lib/strategy/momentumV5';
import { BacktestEngine } from '../lib/backtesting/engine';
import { Candle } from '../types';

const jsonData = fs.readFileSync('public/data/btc-inr-90d-1m.json', 'utf8');
const allCandles = JSON.parse(jsonData) as Candle[];

const strategy = new MomentumStrategyV5();

const config = {
  initialCapital: 10000,
  costConfig: { feePerSidePct: 0.0, slippagePerSidePct: 0.0 },
  riskPerTradePercent: 1.0,
  strategyConfig: {
    emaFast: 20,
    emaSlow: 50,
    rsiPeriod: 14,
    longRsiMin: 55,
    longRsiMax: 70,
    shortRsiMin: 30,
    shortRsiMax: 45,
    adxPeriod: 14,
    adxThreshold: 20,
    atrPeriod: 14,
    atrStopMultiplier: 1.5,
    rewardRisk: 2.0,
    breakoutLookback: 20,
    averageVolumePeriod: 20,
    volumeMultiplier: 1.2,
    minimumAtrPct: 0.10,
    minimumEdgeMultiplier: 1.5,
    costConfig: { feePerSidePct: 0.0, slippagePerSidePct: 0.0 }
  }
};

const engine = new BacktestEngine(strategy, config);
const metrics = engine.run(allCandles);

console.log('Trades taken:', metrics.totalTrades);
console.log('Win rate:', (metrics.winRate * 100).toFixed(2) + '%');
console.log('Net P&L: ₹' + metrics.netProfit.toFixed(2));
console.log('Profit Factor:', metrics.profitFactor.toFixed(2));
console.log('Diagnostics:', strategy.diagnostics);

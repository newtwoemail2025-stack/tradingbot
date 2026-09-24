import fs from 'fs';
import { MomentumStrategyV5 } from '../lib/strategy/momentumV5';
import { Candle } from '../types';

const jsonData = fs.readFileSync('public/data/btc-inr-90d-1m.json', 'utf8');
const allCandles = JSON.parse(jsonData) as Candle[];

const strategy = new MomentumStrategyV5();
const config = {
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
    minimumEdgeMultiplier: 1.5
};

const context = {
    openPositions: [],
    history: [],
    balance: 10000,
    currentDate: new Date(),
    costConfig: { feePerSidePct: 0.2, slippagePerSidePct: 0.1 }
};

for (let i = 0; i < 5000; i++) {
  const previousCandles = allCandles.slice(0, i + 1);
  strategy.evaluate(previousCandles, config, context);
}
console.log('Finished 5000 candles with standalone strategy evaluate');

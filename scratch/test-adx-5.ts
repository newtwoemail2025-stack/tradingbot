import fs from 'fs';
import { BacktestEngine } from '../lib/backtesting/engine';
import { MomentumStrategyV5 } from '../lib/strategy/momentumV5';
import { Candle } from '../types';
import { calculateADX, calculateEMA, calculateRSI, calculateATR, calculateAverageVolume } from '../lib/indicators/index';

const jsonData = fs.readFileSync('public/data/btc-inr-90d-1m.json', 'utf8');
const allCandles = JSON.parse(jsonData) as Candle[];

const emaFastPeriod = 20;
const emaSlowPeriod = 50;
const rsiPeriod = 14;
const adxPeriod = 14;
const atrPeriod = 14;
const averageVolumePeriod = 20;
const breakoutLookback = 20;

let passed20 = 0;
for (let i = 0; i < 5000; i++) {
  const previousCandles = allCandles.slice(0, i + 1);
  const candles = previousCandles;
  
  if (candles.length < Math.max(emaSlowPeriod, breakoutLookback + 5)) {
    continue;
  }
  
  const emaFastVals = calculateEMA(candles, emaFastPeriod);
  const emaSlowVals = calculateEMA(candles, emaSlowPeriod);
  const rsiVals = calculateRSI(candles, rsiPeriod);
  const { adx: adxVals } = calculateADX(candles, adxPeriod);
  const atrVals = calculateATR(candles, atrPeriod);
  const volSmaVals = calculateAverageVolume(candles, averageVolumePeriod);
  
  const currentAdx = adxVals[candles.length - 1];
  if (currentAdx > 20) {
    passed20++;
  }
}
console.log('Passed 20 in manual loop:', passed20);

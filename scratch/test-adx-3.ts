import fs from 'fs';
import { calculateADX, calculateEMA, calculateRSI, calculateATR, calculateAverageVolume } from '../lib/indicators/index';
import { Candle } from '../types';

const jsonData = fs.readFileSync('public/data/btc-inr-90d-1m.json', 'utf8');
const allCandles = JSON.parse(jsonData) as Candle[];

let passed20 = 0;
for (let i = 49; i < 5000; i++) {
  const candles = allCandles.slice(0, i + 1);
  const emaFastVals = calculateEMA(candles, 20);
  const emaSlowVals = calculateEMA(candles, 50);
  const rsiVals = calculateRSI(candles, 14);
  const { adx: adxVals } = calculateADX(candles, 14);
  const atrVals = calculateATR(candles, 14);
  const volSmaVals = calculateAverageVolume(candles, 20);
  
  const currentAdx = adxVals[candles.length - 1];
  if (candles.length % 1000 === 0) console.log(`ADX at ${candles.length}: ${currentAdx}`);
  if (currentAdx > 20) {
    passed20++;
  }
}
console.log('Passed 20 iteratively:', passed20);

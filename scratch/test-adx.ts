import fs from 'fs';
import { calculateADX } from '../lib/indicators/index';
import { Candle } from '../types';

const jsonData = fs.readFileSync('public/data/btc-inr-90d-1m.json', 'utf8');
const allCandles = JSON.parse(jsonData) as Candle[];

// Calculate ADX sequentially to simulate backtest engine
for (let i = 200; i <= 210; i++) {
    const candles = allCandles.slice(0, i);
    const { adx } = calculateADX(candles, 14);
    console.log(`Candle ${i} ADX:`, adx[adx.length - 1]);
}

// Compare with full run
const fullResult = calculateADX(allCandles.slice(0, 210), 14);
console.log('Full run ADX for 210:', fullResult.adx[209]);

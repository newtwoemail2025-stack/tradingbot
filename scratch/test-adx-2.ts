import fs from 'fs';
import { calculateADX } from '../lib/indicators/index';
import { Candle } from '../types';


const jsonData = fs.readFileSync('public/data/btc-inr-90d-1m.json', 'utf8');
const allCandles = JSON.parse(jsonData) as Candle[];

const { adx } = calculateADX(allCandles, 14);

let maxAdx = 0;
let passed20 = 0;
let passed25 = 0;
for (let i = 0; i < adx.length; i++) {
  if (adx[i] > maxAdx) maxAdx = adx[i];
  if (adx[i] > 20) passed20++;
  if (adx[i] > 25) passed25++;
}

console.log('Internal calculateADX:');
console.log('Max ADX:', maxAdx);
console.log('Passed 20:', passed20);
console.log('Passed 25:', passed25);



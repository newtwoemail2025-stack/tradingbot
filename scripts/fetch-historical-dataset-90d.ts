import fs from 'fs';
import path from 'path';
import { Candle } from '../types';

const OUTPUT_FILE = path.join(__dirname, '../public/data/btc-inr-90d-1m.json');
const TARGET_CANDLES = 129600; // 90 days of 1-minute candles
const USD_INR_RATE = 84.0; // Static conversion rate

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchBinanceKlines(endTime?: number) {
  let url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000';
  if (endTime) {
    url += `&endTime=${endTime}`;
  }
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
  }
  
  // Array of arrays: [Open time, Open, High, Low, Close, Volume, Close time, Quote asset volume, Number of trades, Taker buy base asset volume, Taker buy quote asset volume, Ignore]
  const data: any[][] = await response.json();
  
  return data.map(kline => ({
    time: kline[0], // Open time in ms
    open: Number(kline[1]) * USD_INR_RATE,
    high: Number(kline[2]) * USD_INR_RATE,
    low: Number(kline[3]) * USD_INR_RATE,
    close: Number(kline[4]) * USD_INR_RATE,
    volume: Number(kline[5])
  })) as Candle[];
}

async function run() {
  console.log(`Starting massive data fetch (Target: ${TARGET_CANDLES} candles, ~90 days)`);
  let allCandles: Candle[] = [];
  let currentEndTime: number | undefined = undefined;
  
  let totalRequests = 0;
  let failedRequests = 0;

  while (allCandles.length < TARGET_CANDLES) {
    try {
      if (totalRequests % 10 === 0) {
        console.log(`Fetching batch... (Current total: ${allCandles.length} / ${TARGET_CANDLES})`);
      }
      const batch = await fetchBinanceKlines(currentEndTime);
      totalRequests++;

      if (batch.length === 0) {
        console.warn('API returned empty batch, stopping early.');
        break;
      }

      // Prepend to array
      allCandles = [...batch, ...allCandles];
      
      // Next iteration should fetch candles before the oldest one we just got
      currentEndTime = batch[0].time - 1;
      
      // Delay to respect API limits
      await delay(100);
    } catch (e) {
      console.error(e);
      failedRequests++;
      await delay(2000); // Wait longer on failure
      if (failedRequests > 15) {
         console.error('Too many failed requests. Aborting fetch loop.');
         break;
      }
    }
  }

  // Deduplicate based on timestamp
  const map = new Map<number, Candle>();
  for (const c of allCandles) {
    map.set(c.time, c);
  }
  const uniqueCandles = Array.from(map.values());

  // Sort chronologically ascending
  uniqueCandles.sort((a, b) => a.time - b.time);
  
  // Gap detection
  let missingMinutes = 0;
  for (let i = 1; i < uniqueCandles.length; i++) {
    const timeDiff = uniqueCandles[i].time - uniqueCandles[i - 1].time;
    if (timeDiff > 60000) { // more than 1 minute gap
      const missed = Math.floor(timeDiff / 60000) - 1;
      missingMinutes += missed;
    }
  }

  // Trim to exact target if we over-fetched
  let finalCandles = uniqueCandles;
  if (finalCandles.length > TARGET_CANDLES) {
    finalCandles = finalCandles.slice(finalCandles.length - TARGET_CANDLES);
  }

  console.log('\n--- DATA VALIDATION REPORT ---');
  console.log(`Total candles originally fetched: ${allCandles.length}`);
  console.log(`Duplicates removed: ${allCandles.length - uniqueCandles.length}`);
  console.log(`Missing minutes (API gaps): ${missingMinutes}`);
  console.log(`Final total candles: ${finalCandles.length}`);
  console.log(`Earliest timestamp: ${new Date(finalCandles[0].time).toISOString()}`);
  console.log(`Latest timestamp: ${new Date(finalCandles[finalCandles.length - 1].time).toISOString()}`);
  console.log(`Timeframe: 1m`);
  console.log(`Chronological ordering: YES (Sorted ascending)`);
  console.log(`Number of API requests: ${totalRequests}`);
  console.log(`Failed requests/retries: ${failedRequests}`);
  
  // Ensure directory exists
  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalCandles, null, 2), 'utf-8');
  console.log(`\nDataset successfully saved to ${OUTPUT_FILE}`);
}

run().catch(console.error);

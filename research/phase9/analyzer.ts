import fs from 'fs';
import path from 'path';
import { Candle } from '../../types';
import { calculateSMA } from '../../lib/indicators';

// Reusing standard ATR calculation logic
export function calculateATR(candles: Candle[], period: number): number[] {
  if (candles.length < period) return new Array(candles.length).fill(0);
  const atr = new Float64Array(candles.length);
  const tr = new Float64Array(candles.length);

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;

  for (let i = period + 1; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return Array.from(atr);
}

// 1. Timeframe Aggregation
export function aggregateCandles(candles: Candle[], minutes: number): Candle[] {
  if (minutes === 1) return candles;
  const aggregated: Candle[] = [];
  let currentCandle: Candle | null = null;
  let count = 0;

  for (const c of candles) {
    if (!currentCandle) {
      currentCandle = { ...c };
      count = 1;
    } else {
      currentCandle.high = Math.max(currentCandle.high, c.high);
      currentCandle.low = Math.min(currentCandle.low, c.low);
      currentCandle.close = c.close;
      currentCandle.volume += c.volume;
      count++;
    }

    if (count === minutes) {
      aggregated.push(currentCandle);
      currentCandle = null;
    }
  }
  return aggregated;
}

// 2. Data Quality Check
export function checkDataQuality(candles: Candle[]): { valid: boolean, errors: string[] } {
  const errors: string[] = [];
  if (candles.length === 0) {
    errors.push("Empty candle array");
    return { valid: false, errors };
  }
  
  let prevTime = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.time <= prevTime) {
      errors.push(`Timestamp not strictly ascending at index ${i}: ${prevTime} >= ${c.time}`);
    }
    if (c.high < c.low || c.open < c.low || c.open > c.high || c.close < c.low || c.close > c.high) {
      errors.push(`Invalid OHLC at index ${i}: O=${c.open}, H=${c.high}, L=${c.low}, C=${c.close}`);
    }
    prevTime = c.time;
  }
  return { valid: errors.length === 0, errors };
}

// 3. Forward Return Calculation
export function getForwardReturn(candles: Candle[], currentIndex: number, forwardBars: number): number | null {
  if (currentIndex + forwardBars >= candles.length) return null;
  const entryPrice = candles[currentIndex].close;
  const exitPrice = candles[currentIndex + forwardBars].close;
  return (exitPrice - entryPrice) / entryPrice;
}

// Maximum Favorable/Adverse Excursion
export function getMfeMae(candles: Candle[], currentIndex: number, forwardBars: number, isLong: boolean): { mfe: number, mae: number } | null {
  if (currentIndex + forwardBars >= candles.length) return null;
  const entryPrice = candles[currentIndex].close;
  let highest = entryPrice;
  let lowest = entryPrice;
  
  for (let i = 1; i <= forwardBars; i++) {
    highest = Math.max(highest, candles[currentIndex + i].high);
    lowest = Math.min(lowest, candles[currentIndex + i].low);
  }

  if (isLong) {
    return {
      mfe: (highest - entryPrice) / entryPrice,
      mae: (lowest - entryPrice) / entryPrice
    };
  } else {
    return {
      mfe: (entryPrice - lowest) / entryPrice,
      mae: (entryPrice - highest) / entryPrice
    };
  }
}

// 4. Baseline Return Calculation
export function calculateBaseline(candles: Candle[], forwardBars: number): { mean: number, median: number, positivePct: number } {
  const returns: number[] = [];
  for (let i = 0; i < candles.length - forwardBars; i++) {
    const ret = getForwardReturn(candles, i, forwardBars);
    if (ret !== null) returns.push(ret);
  }
  
  if (returns.length === 0) return { mean: 0, median: 0, positivePct: 0 };
  
  returns.sort((a, b) => a - b);
  let sum = 0;
  let positiveCount = 0;
  for (const r of returns) {
    sum += r;
    if (r > 0) positiveCount++;
  }
  
  return {
    mean: sum / returns.length,
    median: returns[Math.floor(returns.length / 2)],
    positivePct: (positiveCount / returns.length) * 100
  };
}

export interface ResearchStats {
  observations: number;
  mean: number;
  median: number;
  positivePct: number;
  negativePct: number;
  p10: number;
  p90: number;
  mfeMean?: number;
  maeMean?: number;
}

export function computeStats(returns: number[], mfeArray?: number[], maeArray?: number[]): ResearchStats {
  if (returns.length === 0) {
    return { observations: 0, mean: 0, median: 0, positivePct: 0, negativePct: 0, p10: 0, p90: 0 };
  }
  returns.sort((a, b) => a - b);
  let sum = 0;
  let positiveCount = 0;
  for (const r of returns) {
    sum += r;
    if (r > 0) positiveCount++;
  }
  
  const mean = sum / returns.length;
  const median = returns[Math.floor(returns.length / 2)];
  const positivePct = (positiveCount / returns.length) * 100;
  const negativePct = ((returns.length - positiveCount) / returns.length) * 100; // treating 0 as neutral/negative bucket component
  const p10 = returns[Math.floor(returns.length * 0.1)];
  const p90 = returns[Math.floor(returns.length * 0.9)];

  let mfeMean = 0;
  let maeMean = 0;
  if (mfeArray && maeArray && mfeArray.length === returns.length) {
    mfeMean = mfeArray.reduce((a, b) => a + b, 0) / mfeArray.length;
    maeMean = maeArray.reduce((a, b) => a + b, 0) / maeArray.length;
  }

  return { observations: returns.length, mean, median, positivePct, negativePct, p10, p90, mfeMean, maeMean };
}

// MAIN RUNNER
async function runResearch() {
  console.log("Loading data...");
  const dataPath = path.join(__dirname, '../../public/data/btc-inr-90d-1m.json');
  if (!fs.existsSync(dataPath)) {
    console.error("Data file not found:", dataPath);
    return;
  }

  const rawCandles = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as Candle[];
  
  const quality = checkDataQuality(rawCandles);
  if (!quality.valid) {
    console.error("Data Quality Check Failed:", quality.errors.slice(0, 5));
    return;
  }
  console.log("Data Quality OK. Observations:", rawCandles.length);

  const timeframes = [1, 5, 15, 30, 60];
  const timeframeLabels = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h' };
  const forwardWindows = [1, 3, 5, 10];
  
  const summaryRows: any[] = [];
  const fullResults: any = {};

  // Helper to initialize buckets
  function initBuckets(labels: string[]) {
    const b: any = {};
    for (const l of labels) {
      b[l] = {};
      for (const fw of forwardWindows) {
        b[l][fw] = { returns: [], mfe: [], mae: [] };
      }
    }
    return b;
  }

  const momentumBuckets = initBuckets(['pos_0.25_0.50', 'pos_0.50_1.00', 'pos_gt_1.00', 'neg_0.25_0.50', 'neg_0.50_1.00', 'neg_lt_1.00']);
  const breakoutBuckets = initBuckets(['long_5', 'long_10', 'long_20', 'short_5', 'short_10', 'short_20']);
  const meanRevBuckets = initBuckets(['pos_0.25_0.50', 'pos_0.50_1.00', 'pos_gt_1.00', 'neg_0.25_0.50', 'neg_0.50_1.00', 'neg_lt_1.00']);
  const volBuckets = initBuckets(['inc_10_25', 'inc_25_50', 'inc_gt_50']);

  for (const tf of timeframes) {
    console.log(`Processing timeframe: ${timeframeLabels[tf as keyof typeof timeframeLabels]}...`);
    const candles = aggregateCandles(rawCandles, tf);
    fullResults[tf] = { candles: candles.length, baselines: {}, momentum: {}, breakout: {}, meanReversion: {}, volatility: {} };

    // Baselines
    for (const fw of forwardWindows) {
      const baseline = calculateBaseline(candles, fw);
      fullResults[tf].baselines[fw] = baseline;
    }

    const sma20Vals = Array.from(calculateSMA(candles, 20));
    const atr14Vals = calculateATR(candles, 14);

    for (let i = 20; i < candles.length - 10; i++) {
      const c = candles[i];
      const prevC = candles[i - 1];

      // --- RES 1: Momentum Continuation ---
      const past3Ret = (c.close - candles[i - 3].close) / candles[i - 3].close * 100;
      const past5Ret = (c.close - candles[i - 5].close) / candles[i - 5].close * 100;
      const past10Ret = (c.close - candles[i - 10].close) / candles[i - 10].close * 100;
      
      const checkMom = (ret: number) => {
        if (ret >= 0.25 && ret < 0.50) return 'pos_0.25_0.50';
        if (ret >= 0.50 && ret < 1.00) return 'pos_0.50_1.00';
        if (ret >= 1.00) return 'pos_gt_1.00';
        if (ret <= -0.25 && ret > -0.50) return 'neg_0.25_0.50';
        if (ret <= -0.50 && ret > -1.00) return 'neg_0.50_1.00';
        if (ret <= -1.00) return 'neg_lt_1.00';
        return null;
      };

      const momBucket = checkMom(past3Ret); // Using 3-bar return as the primary trigger for bucket, could test others. We will just use past3Ret for simplicity in this example to map to bucket.
      if (momBucket) {
        for (const fw of forwardWindows) {
          const fret = getForwardReturn(candles, i, fw);
          if (fret !== null) momentumBuckets[momBucket][fw].returns.push(fret);
        }
      }

      // --- RES 2: Breakout Continuation ---
      for (const lb of [5, 10, 20]) {
        let maxH = -Infinity;
        let minL = Infinity;
        // EXCLUDE current candle (i)
        for (let j = 1; j <= lb; j++) {
           maxH = Math.max(maxH, candles[i - j].high);
           minL = Math.min(minL, candles[i - j].low);
        }
        
        if (c.close > maxH) {
           for (const fw of forwardWindows) {
             const fret = getForwardReturn(candles, i, fw);
             const mm = getMfeMae(candles, i, fw, true);
             if (fret !== null && mm) {
               breakoutBuckets[`long_${lb}`][fw].returns.push(fret);
               breakoutBuckets[`long_${lb}`][fw].mfe.push(mm.mfe);
               breakoutBuckets[`long_${lb}`][fw].mae.push(mm.mae);
             }
           }
        } else if (c.close < minL) {
           for (const fw of forwardWindows) {
             const fret = getForwardReturn(candles, i, fw);
             const mm = getMfeMae(candles, i, fw, false);
             if (fret !== null && mm) {
               breakoutBuckets[`short_${lb}`][fw].returns.push(fret);
               breakoutBuckets[`short_${lb}`][fw].mfe.push(mm.mfe);
               breakoutBuckets[`short_${lb}`][fw].mae.push(mm.mae);
             }
           }
        }
      }

      // --- RES 3: Mean Reversion ---
      const sma = sma20Vals[i];
      if (sma > 0) {
        const distPct = (c.close - sma) / sma * 100;
        const checkMr = (dist: number) => {
          if (dist >= 0.25 && dist < 0.50) return 'pos_0.25_0.50';
          if (dist >= 0.50 && dist < 1.00) return 'pos_0.50_1.00';
          if (dist >= 1.00) return 'pos_gt_1.00';
          if (dist <= -0.25 && dist > -0.50) return 'neg_0.25_0.50';
          if (dist <= -0.50 && dist > -1.00) return 'neg_0.50_1.00';
          if (dist <= -1.00) return 'neg_lt_1.00';
          return null;
        };

        const mrBucket = checkMr(distPct);
        if (mrBucket) {
           for (const fw of forwardWindows) {
             const fret = getForwardReturn(candles, i, fw);
             if (fret !== null) meanRevBuckets[mrBucket][fw].returns.push(fret);
           }
        }
      }

      // --- RES 4: Volatility Expansion ---
      const currAtrPct = atr14Vals[i] / c.close * 100;
      const prevAtrPct = atr14Vals[i - 1] / prevC.close * 100;
      if (prevAtrPct > 0) {
        const atrInc = (currAtrPct - prevAtrPct) / prevAtrPct * 100;
        let volBucket = null;
        if (atrInc >= 10 && atrInc < 25) volBucket = 'inc_10_25';
        else if (atrInc >= 25 && atrInc < 50) volBucket = 'inc_25_50';
        else if (atrInc >= 50) volBucket = 'inc_gt_50';

        if (volBucket) {
           for (const fw of forwardWindows) {
             const fret = getForwardReturn(candles, i, fw);
             const mm = getMfeMae(candles, i, fw, true); // absolute return proxies
             if (fret !== null && mm) {
               volBuckets[volBucket][fw].returns.push(fret);
               volBuckets[volBucket][fw].mfe.push(mm.mfe);
               volBuckets[volBucket][fw].mae.push(mm.mae);
             }
           }
        }
      }
    }

// Compute stats for everything
    for (const bkt in momentumBuckets) {
      fullResults[tf].momentum[bkt] = {};
      for (const fw of forwardWindows) {
        const stats = computeStats(momentumBuckets[bkt][fw].returns);
        fullResults[tf].momentum[bkt][fw] = stats;
        if (stats.observations > 0) {
          summaryRows.push({
             behavior: 'Momentum', tf: timeframeLabels[tf as keyof typeof timeframeLabels], event: bkt, fw: fw,
             obs: stats.observations, mean: (stats.mean*100).toFixed(4), median: (stats.median*100).toFixed(4), posPct: stats.positivePct.toFixed(2), baseline: (fullResults[tf].baselines[fw].mean*100).toFixed(4)
          });
        }
      }
    }

    for (const bkt in breakoutBuckets) {
      fullResults[tf].breakout[bkt] = {};
      for (const fw of forwardWindows) {
        const stats = computeStats(breakoutBuckets[bkt][fw].returns, breakoutBuckets[bkt][fw].mfe, breakoutBuckets[bkt][fw].mae);
        fullResults[tf].breakout[bkt][fw] = stats;
        if (stats.observations > 0) {
          summaryRows.push({
             behavior: 'Breakout', tf: timeframeLabels[tf as keyof typeof timeframeLabels], event: bkt, fw: fw,
             obs: stats.observations, mean: (stats.mean*100).toFixed(4), median: (stats.median*100).toFixed(4), posPct: stats.positivePct.toFixed(2), baseline: (fullResults[tf].baselines[fw].mean*100).toFixed(4)
          });
        }
      }
    }

    for (const bkt in meanRevBuckets) {
      fullResults[tf].meanReversion[bkt] = {};
      for (const fw of forwardWindows) {
        const stats = computeStats(meanRevBuckets[bkt][fw].returns);
        fullResults[tf].meanReversion[bkt][fw] = stats;
        if (stats.observations > 0) {
          summaryRows.push({
             behavior: 'MeanRev', tf: timeframeLabels[tf as keyof typeof timeframeLabels], event: bkt, fw: fw,
             obs: stats.observations, mean: (stats.mean*100).toFixed(4), median: (stats.median*100).toFixed(4), posPct: stats.positivePct.toFixed(2), baseline: (fullResults[tf].baselines[fw].mean*100).toFixed(4)
          });
        }
      }
    }

    for (const bkt in volBuckets) {
      fullResults[tf].volatility[bkt] = {};
      for (const fw of forwardWindows) {
        const stats = computeStats(volBuckets[bkt][fw].returns, volBuckets[bkt][fw].mfe, volBuckets[bkt][fw].mae);
        fullResults[tf].volatility[bkt][fw] = stats;
        if (stats.observations > 0) {
          summaryRows.push({
             behavior: 'VolExpand', tf: timeframeLabels[tf as keyof typeof timeframeLabels], event: bkt, fw: fw,
             obs: stats.observations, mean: (stats.mean*100).toFixed(4), median: (stats.median*100).toFixed(4), posPct: stats.positivePct.toFixed(2), baseline: (fullResults[tf].baselines[fw].mean*100).toFixed(4)
          });
        }
      }
    }
  }

  // Export JSON
  const outDir = path.join(__dirname);
  fs.writeFileSync(path.join(outDir, 'market-edge-results.json'), JSON.stringify(fullResults, null, 2));

  // Export CSV
  let csv = "Behavior,Timeframe,Event,Forward Window,Observations,Mean Return %,Median Return %,Positive %,Baseline Return %\n";
  for (const row of summaryRows) {
    csv += `${row.behavior},${row.tf},${row.event},${row.fw},${row.obs},${row.mean},${row.median},${row.posPct},${row.baseline}\n`;
  }
  fs.writeFileSync(path.join(outDir, 'market-edge-summary.csv'), csv);

  // Export MD
  let md = "# Phase 9: Market Edge Research Lab\n\n";
  md += "## Summary Table\n\n";
  md += "| Behavior | Timeframe | Event | Forward Window | Observations | Mean Return % | Median Return % | Positive % | Baseline Return % |\n";
  md += "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
  for (const row of summaryRows) {
    md += `| ${row.behavior} | ${row.tf} | ${row.event} | ${row.fw} | ${row.obs} | ${row.mean}% | ${row.median}% | ${row.posPct}% | ${row.baseline}% |\n`;
  }
  fs.writeFileSync(path.join(outDir, 'market-edge-report.md'), md);

  console.log("Research complete. Outputs saved in research/phase9/");
}

if (require.main === module) {
  runResearch().catch(console.error);
}

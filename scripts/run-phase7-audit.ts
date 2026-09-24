import fs from 'fs';
import { join } from 'path';
import { Candle } from '../types';
import { calculateEMA, calculateATR, calculateAverageVolume, calculateADX } from '../lib/indicators';

const dataPath = join(process.cwd(), 'public/data/btc-inr-90d-1m.json');
const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const candles = rawData.map((d: any) => ({
  time: new Date(d.time).getTime(),
  open: Number(d.open),
  high: Number(d.high),
  low: Number(d.low),
  close: Number(d.close),
  volume: Number(d.volume)
}));

console.log(`Loaded ${candles.length} candles for audit.`);

const emaFastPeriod = 20;
const emaSlowPeriod = 50;
const adxPeriod = 14;
const minimumADX = 20;
const pullbackLookback = 10;
const pullbackTolerancePercent = 0.001;
const volumeMultiplier = 1.2;
const minimumATRPercent = 0.001;
const atrBuffer = 0.5;

console.log("Calculating indicators...");
const emaFast = calculateEMA(candles, emaFastPeriod);
const emaSlow = calculateEMA(candles, emaSlowPeriod);
const atr = calculateATR(candles, 14);
const avgVol = calculateAverageVolume(candles, emaSlowPeriod);
const { adx } = calculateADX(candles, adxPeriod);
console.log("Done calculating indicators.");

const longCounts = {
    trendPassed: 0,
    adxPassed: 0,
    volatilityPassed: 0,
    pullbackPassed: 0,
    integrityPassed: 0,
    volumePassed: 0,
    confirmationPassed: 0,
    finalSignals: 0
};

const shortCounts = {
    trendPassed: 0,
    adxPassed: 0,
    volatilityPassed: 0,
    pullbackPassed: 0,
    integrityPassed: 0,
    volumePassed: 0,
    confirmationPassed: 0,
    finalSignals: 0
};

for (let currentIdx = Math.max(emaSlowPeriod, adxPeriod * 2, pullbackLookback + 1); currentIdx < candles.length; currentIdx++) {
    const currentCandle = candles[currentIdx];
    const prevCandle = candles[currentIdx - 1];

    const currentEmaFast = emaFast[currentIdx];
    const currentEmaSlow = emaSlow[currentIdx];
    const currentAtr = atr[currentIdx];
    const currentAvgVol = avgVol[currentIdx];
    const currentAdx = adx[currentIdx];

    if (isNaN(currentEmaFast) || isNaN(currentEmaSlow) || isNaN(currentAtr) || isNaN(currentAdx) || isNaN(currentAvgVol)) continue;

    // LONG PIPELINE
    const isCurrentTrendLong = currentEmaFast > currentEmaSlow;
    if (isCurrentTrendLong) {
        longCounts.trendPassed++;
        
        if (currentAdx >= minimumADX) {
            longCounts.adxPassed++;
            
            const currentVolatilityPercent = currentAtr / currentCandle.close;
            if (currentVolatilityPercent >= minimumATRPercent) {
                longCounts.volatilityPassed++;
                
                const lookbackCandles = candles.slice(currentIdx - pullbackLookback, currentIdx);
                const lookbackEmaFast = emaFast.slice(currentIdx - pullbackLookback, currentIdx);
                const lookbackEmaSlow = emaSlow.slice(currentIdx - pullbackLookback, currentIdx);
                
                let isLongTrendIntact = true;
                let hasLongPullback = false;
                
                for (let i = 0; i < lookbackCandles.length; i++) {
                    const c = lookbackCandles[i];
                    const eFast = lookbackEmaFast[i];
                    const eSlow = lookbackEmaSlow[i];
                    
                    if (c.close <= eSlow) isLongTrendIntact = false;
                    const longPullbackThreshold = eFast * (1 + pullbackTolerancePercent);
                    if (c.low <= longPullbackThreshold) hasLongPullback = true;
                }
                
                if (hasLongPullback) {
                    longCounts.pullbackPassed++;
                    
                    if (isLongTrendIntact) {
                        longCounts.integrityPassed++;
                        
                        const currentVolumeSpike = currentCandle.volume > (currentAvgVol * volumeMultiplier);
                        if (currentVolumeSpike) {
                            longCounts.volumePassed++;
                            
                            const isBullishCandle = currentCandle.close > currentCandle.open;
                            if (isBullishCandle && currentCandle.close > prevCandle.high) {
                                longCounts.confirmationPassed++;
                                longCounts.finalSignals++;
                            }
                        }
                    }
                }
            }
        }
    }

    // SHORT PIPELINE
    const isCurrentTrendShort = currentEmaFast < currentEmaSlow;
    if (isCurrentTrendShort) {
        shortCounts.trendPassed++;
        
        if (currentAdx >= minimumADX) {
            shortCounts.adxPassed++;
            
            const currentVolatilityPercent = currentAtr / currentCandle.close;
            if (currentVolatilityPercent >= minimumATRPercent) {
                shortCounts.volatilityPassed++;
                
                const lookbackCandles = candles.slice(currentIdx - pullbackLookback, currentIdx);
                const lookbackEmaFast = emaFast.slice(currentIdx - pullbackLookback, currentIdx);
                const lookbackEmaSlow = emaSlow.slice(currentIdx - pullbackLookback, currentIdx);
                
                let isShortTrendIntact = true;
                let hasShortPullback = false;
                
                for (let i = 0; i < lookbackCandles.length; i++) {
                    const c = lookbackCandles[i];
                    const eFast = lookbackEmaFast[i];
                    const eSlow = lookbackEmaSlow[i];
                    
                    if (c.close >= eSlow) isShortTrendIntact = false;
                    const shortPullbackThreshold = eFast * (1 - pullbackTolerancePercent);
                    if (c.high >= shortPullbackThreshold) hasShortPullback = true;
                }
                
                if (hasShortPullback) {
                    shortCounts.pullbackPassed++;
                    
                    if (isShortTrendIntact) {
                        shortCounts.integrityPassed++;
                        
                        const currentVolumeSpike = currentCandle.volume > (currentAvgVol * volumeMultiplier);
                        if (currentVolumeSpike) {
                            shortCounts.volumePassed++;
                            
                            const isBearishCandle = currentCandle.close < currentCandle.open;
                            if (isBearishCandle && currentCandle.close < prevCandle.low) {
                                shortCounts.confirmationPassed++;
                                shortCounts.finalSignals++;
                            }
                        }
                    }
                }
            }
        }
    }
}

console.log("\n--- LONG PIPELINE COUNTS ---");
console.log(`Trend passed: ${longCounts.trendPassed}`);
console.log(`ADX passed: ${longCounts.adxPassed}`);
console.log(`Volatility passed: ${longCounts.volatilityPassed}`);
console.log(`Pullback passed: ${longCounts.pullbackPassed}`);
console.log(`Trend integrity passed: ${longCounts.integrityPassed}`);
console.log(`Volume passed: ${longCounts.volumePassed}`);
console.log(`Confirmation passed: ${longCounts.confirmationPassed}`);
console.log(`Final signals: ${longCounts.finalSignals}`);

console.log("\n--- SHORT PIPELINE COUNTS ---");
console.log(`Trend passed: ${shortCounts.trendPassed}`);
console.log(`ADX passed: ${shortCounts.adxPassed}`);
console.log(`Volatility passed: ${shortCounts.volatilityPassed}`);
console.log(`Pullback passed: ${shortCounts.pullbackPassed}`);
console.log(`Trend integrity passed: ${shortCounts.integrityPassed}`);
console.log(`Volume passed: ${shortCounts.volumePassed}`);
console.log(`Confirmation passed: ${shortCounts.confirmationPassed}`);
console.log(`Final signals: ${shortCounts.finalSignals}`);

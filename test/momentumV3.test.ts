import { describe, test, expect, beforeEach } from 'vitest';
import { MomentumStrategyV3 } from '../lib/strategy/momentumV3';
import { Candle } from '../types';

describe('MomentumStrategyV3 Synthetic Tests', () => {
    let strategy: MomentumStrategyV3;
    const config = {
        emaFast: 5,
        emaSlow: 10,
        adxPeriod: 5,
        minimumADX: 20,
        pullbackLookback: 3,
        pullbackTolerancePercent: 0.001,
        volumeMultiplier: 1.0,
        minimumATRPercent: 0.0, // disable volatility filter for synthetic test
        atrBuffer: 0.5,
        riskReward: 2.0
    };

    beforeEach(() => {
        strategy = new MomentumStrategyV3();
    });

    const createCandle = (time: number, open: number, high: number, low: number, close: number, volume: number): Candle => ({
        time, open, high, low, close, volume, symbol: 'BTC/INR'
    });

    // Helper to generate a trending sequence
    const generateTrend = (startPrice: number, direction: 1 | -1, count: number, timeOffset: number = 0): Candle[] => {
        const candles: Candle[] = [];
        let curPrice = startPrice;
        for (let i = 0; i < count; i++) {
            curPrice += direction * 10;
            // High volume to guarantee ADX and volume pass
            candles.push(createCandle(timeOffset + (i * 60000), curPrice - direction * 5, curPrice + 5, curPrice - 5, curPrice, 1000));
        }
        return candles;
    };

    test('A. Clear bullish trend + pullback + continuation', () => {
        const timeOffset = 1000000;
        const candles = generateTrend(10000, 1, 50, timeOffset); // Bullish trend (curPrice = 10500, EMA10 ~ 10455, EMA5 ~ 10480)
        // Pullback candle
        const c1 = createCandle(timeOffset + (50 * 60000), 10500, 10500, 10475, 10475, 1000); // Drops near EMA5 but stays above EMA10
        // Continuation candle
        const c2 = createCandle(timeOffset + (51 * 60000), 10475, 10550, 10475, 10520, 5000); // Massive volume, breaks previous high
        
        const testCandles = [...candles, c1, c2];
        const signal = strategy.evaluate(testCandles, config, {} as any);
        
        expect(signal.action).toBe('OPEN_LONG');
    });

    test('B. Clear bearish trend + pullback + continuation', () => {
        const timeOffset = 2000000;
        const candles = generateTrend(10000, -1, 50, timeOffset); // Bearish trend (curPrice = 9500, EMA10 ~ 9545, EMA5 ~ 9520)
        // Pullback candle
        const c1 = createCandle(timeOffset + (50 * 60000), 9500, 9525, 9500, 9525, 1000); // Spikes near EMA5 but stays below EMA10
        // Continuation candle
        const c2 = createCandle(timeOffset + (51 * 60000), 9525, 9525, 9450, 9480, 5000); // Massive volume, breaks previous low
        
        const testCandles = [...candles, c1, c2];
        const signal = strategy.evaluate(testCandles, config, {} as any);
        
        console.log("Synthetic B Signal Reason:", signal.reason);

        expect(signal.action).toBe('OPEN_SHORT');
    });

    test('C. Bullish trend without pullback', () => {
        const timeOffset = 3000000;
        const candles = generateTrend(10000, 1, 50, timeOffset); // Bullish trend
        const c1 = createCandle(timeOffset + (50 * 60000), 10500, 10520, 10510, 10515, 1000); // No pullback (Low is 10510, clearly > EMA5 ~ 10480)
        const c2 = createCandle(timeOffset + (51 * 60000), 10515, 10550, 10500, 10540, 5000); // Continuation but no prior pullback
        
        const testCandles = [...candles, c1, c2];
        const signal = strategy.evaluate(testCandles, config, {} as any);
        
        expect(signal.action).toBe('HOLD');
    });

    test('D. Bearish trend without pullback', () => {
        const timeOffset = 4000000;
        const candles = generateTrend(10000, -1, 50, timeOffset); // Bearish trend
        const c1 = createCandle(timeOffset + (50 * 60000), 9500, 9490, 9470, 9480, 1000); // No pullback (High is 9490, clearly < EMA5 ~ 9520)
        const c2 = createCandle(timeOffset + (51 * 60000), 9480, 9490, 9450, 9460, 5000); // Continuation but no prior pullback
        
        const testCandles = [...candles, c1, c2];
        const signal = strategy.evaluate(testCandles, config, {} as any);
        
        expect(signal.action).toBe('HOLD');
    });
});

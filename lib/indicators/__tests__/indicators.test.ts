import { calculateSMA, calculateEMA, calculateRSI, calculateATR, calculateVWAP, calculateMACD, calculateAverageVolume, calculateADX } from '../index';
import { Candle } from '../../../types';

describe('Indicators', () => {
  const mockCandles: Candle[] = [
    { time: 1, open: 10, high: 15, low: 5, close: 10, volume: 100 },
    { time: 2, open: 10, high: 20, low: 8, close: 12, volume: 200 },
    { time: 3, open: 12, high: 14, low: 10, close: 14, volume: 150 },
    { time: 4, open: 14, high: 16, low: 12, close: 15, volume: 300 },
    { time: 5, open: 15, high: 18, low: 14, close: 13, volume: 100 },
    { time: 6, open: 13, high: 15, low: 10, close: 11, volume: 50 },
  ];

  it('calculates SMA correctly', () => {
    const sma = calculateSMA(mockCandles, 3);
    expect(sma[0]).toBeNaN();
    expect(sma[1]).toBeNaN();
    expect(sma[2]).toBeCloseTo(12); // (10+12+14)/3
    expect(sma[3]).toBeCloseTo(13.666); // (12+14+15)/3
  });

  it('calculates EMA correctly', () => {
    const ema = calculateEMA(mockCandles, 3);
    expect(ema[0]).toBeNaN();
    expect(ema[1]).toBeNaN();
    expect(ema[2]).toBeCloseTo(12); // Initial is SMA
    // Next: (15 - 12) * (2/4) + 12 = 1.5 + 12 = 13.5
    expect(ema[3]).toBeCloseTo(13.5); 
  });

  it('calculates ATR correctly', () => {
    const atr = calculateATR(mockCandles, 3);
    expect(atr[2]).not.toBeNaN();
  });

  it('calculates RSI without errors', () => {
    const rsi = calculateRSI(mockCandles, 3);
    expect(rsi[3]).not.toBeNaN();
    expect(rsi[3]).toBeGreaterThanOrEqual(0);
    expect(rsi[3]).toBeLessThanOrEqual(100);
  });

  it('calculates VWAP correctly', () => {
    const vwap = calculateVWAP(mockCandles);
    expect(vwap[0]).toBeCloseTo(10); // (15+5+10)/3 = 10, cumVol=100 -> 1000/100 = 10
  });

  describe('calculateMACD', () => {
    it('calculates MACD line, signal line, and histogram', () => {
      const { macdLine, signalLine, histogram } = calculateMACD(mockCandles, 12, 26, 9);
      expect(macdLine.length).toBe(mockCandles.length);
      expect(signalLine.length).toBe(mockCandles.length);
      expect(histogram.length).toBe(mockCandles.length);
    });
  });

  describe('calculateADX', () => {
    it('calculates ADX correctly without throwing', () => {
      // Need enough candles for ADX
      const lotsOfCandles = Array.from({ length: 50 }).map((_, i) => ({
        time: i * 60000,
        open: 100 + i,
        high: 105 + i,
        low: 95 + i,
        close: 100 + i + (i % 2 === 0 ? 2 : -2),
        volume: 1000
      }));
      const { adx, plusDI, minusDI } = calculateADX(lotsOfCandles, 14);
      expect(adx.length).toBe(lotsOfCandles.length);
      expect(plusDI.length).toBe(lotsOfCandles.length);
      expect(minusDI.length).toBe(lotsOfCandles.length);
      
      // Early values should be NaN
      expect(adx[0]).toBeNaN();
      
      // Later values should be numbers
      expect(typeof adx[45]).toBe('number');
      expect(isNaN(adx[45])).toBe(false);
    });
  });

  it('calculates Average Volume correctly', () => {
    const avgVol = calculateAverageVolume(mockCandles, 2);
    expect(avgVol[1]).toBe(150); // (100+200)/2
    expect(avgVol[2]).toBe(175); // (200+150)/2
  });
});

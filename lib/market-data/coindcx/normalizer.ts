import { Candle, MarketTick } from '../../../types';

export class CoinDCXNormalizer {
  static normalizeCandles(rawData: any[]): Candle[] {
    if (!Array.isArray(rawData)) return [];

    return rawData.map((c: any) => ({
      time: Math.floor(c.time / 1000), // convert ms to s for lightweight-charts
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume)
    })).sort((a, b) => a.time - b.time); // ensure chronological order
  }

  static normalizeTicker(rawData: any): MarketTick | null {
    if (!rawData || !rawData.data) return null;
    
    // Sometimes rawData comes as JSON string
    const data = typeof rawData.data === 'string' ? JSON.parse(rawData.data) : rawData.data;

    return {
      symbol: 'BTC/INR', // mapped back to generic UI symbol
      price: Number(data.p || data.last_price || 0),
      timestamp: Date.now(),
      change24h: Number(data.c || data.change_24_hour || 0)
    };
  }

  static normalizeLiveCandle(rawData: any): Candle | null {
    if (!rawData || !rawData.data) return null;
    
    const data = typeof rawData.data === 'string' ? JSON.parse(rawData.data) : rawData.data;
    
    if (!data.time) return null;

    return {
      time: Math.floor(data.time / 1000), // convert ms to s
      open: Number(data.open || data.o),
      high: Number(data.high || data.h),
      low: Number(data.low || data.l),
      close: Number(data.close || data.c),
      volume: Number(data.volume || data.v || 0)
    };
  }
}

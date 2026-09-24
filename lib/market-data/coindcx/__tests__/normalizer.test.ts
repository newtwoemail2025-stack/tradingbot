import { CoinDCXNormalizer } from '../normalizer';

describe('CoinDCXNormalizer', () => {
  it('normalizes historical candles', () => {
    const rawData = [
      { open: 50000, high: 51000, low: 49000, close: 50500, volume: 1.5, time: 1789242000000 },
      { open: 49000, high: 50000, low: 48000, close: 49500, volume: 2.5, time: 1789241940000 }
    ];

    const result = CoinDCXNormalizer.normalizeCandles(rawData);
    
    expect(result).toHaveLength(2);
    // Checks sorting (older first)
    expect(result[0].time).toBe(1789241940);
    expect(result[1].time).toBe(1789242000);
    expect(result[0].open).toBe(49000);
  });

  it('normalizes ticker data from string payload', () => {
    const rawData = {
      channel: 'B-BTC_INR@ticker',
      data: JSON.stringify({ p: '5500000', c: '1.5' })
    };

    const result = CoinDCXNormalizer.normalizeTicker(rawData);
    expect(result?.symbol).toBe('BTC/INR');
    expect(result?.price).toBe(5500000);
    expect(result?.change24h).toBe(1.5);
  });

  it('handles malformed ticker data gracefully', () => {
    expect(CoinDCXNormalizer.normalizeTicker(null)).toBeNull();
    expect(CoinDCXNormalizer.normalizeTicker({})).toBeNull();
  });
});

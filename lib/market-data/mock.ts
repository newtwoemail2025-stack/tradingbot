import { MarketDataProvider, MarketTick, Candle } from '../../types';

export class MockMarketDataProvider implements MarketDataProvider {
  private tickInterval: NodeJS.Timeout | null = null;
  private currentPrice = 5500000; // Starting price for BTC/INR
  private callbacks: { [symbol: string]: ((tick: MarketTick) => void)[] } = {};
  private candleCallbacks: { [symbol: string]: ((candle: Candle) => void)[] } = {};

  constructor() {
    this.startSimulation();
  }

  private startSimulation() {
    this.tickInterval = setInterval(() => {
      // Random walk for price
      const change = (Math.random() - 0.5) * 5000; 
      this.currentPrice += change;
      
      const tick: MarketTick = {
        symbol: 'BTC/INR',
        price: Number(this.currentPrice.toFixed(2)),
        timestamp: Date.now(),
        change24h: 2.5,
        volume24h: 15420.5
      };

      if (this.callbacks['BTC/INR']) {
        this.callbacks['BTC/INR'].forEach(cb => cb(tick));
      }
      
      // We can also simulate real-time candle updates here. 
      // For simplicity in the mock, we might just update the current candle.
      const now = Date.now();
      const currentCandleTime = Math.floor(now / 60000) * 60; // 1m candle
      
      const candle: Candle = {
        time: currentCandleTime,
        open: this.currentPrice - change,
        high: Math.max(this.currentPrice, this.currentPrice - change),
        low: Math.min(this.currentPrice, this.currentPrice - change),
        close: this.currentPrice,
        volume: Math.random() * 5
      };

      if (this.candleCallbacks['BTC/INR']) {
        this.candleCallbacks['BTC/INR'].forEach(cb => cb(candle));
      }
      
    }, 1000); // Tick every 1 second
  }

  subscribeToTicker(symbol: string, callback: (tick: MarketTick) => void): void {
    if (!this.callbacks[symbol]) this.callbacks[symbol] = [];
    this.callbacks[symbol].push(callback);
  }

  subscribeToCandles(symbol: string, timeframe: string, callback: (candle: Candle) => void): void {
    if (!this.candleCallbacks[symbol]) this.candleCallbacks[symbol] = [];
    this.candleCallbacks[symbol].push(callback);
  }

  async getHistoricalCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
    // Generate some fake historical candles for the chart
    const candles: Candle[] = [];
    let time = Math.floor(Date.now() / 1000) - (limit * 60); // 1m candles
    let price = this.currentPrice - (limit * 1000);

    for (let i = 0; i < limit; i++) {
      const open = price;
      const close = price + (Math.random() - 0.5) * 5000;
      const high = Math.max(open, close) + Math.random() * 2000;
      const low = Math.min(open, close) - Math.random() * 2000;

      candles.push({
        time,
        open: Number(open.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(close.toFixed(2)),
        volume: Math.random() * 10
      });

      price = close;
      time += 60; // 1m step
    }

    this.currentPrice = price; // sync up
    return candles;
  }

  onConnectionChange(callback: (status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED') => void): void {
    // Mock is always connected immediately
    callback('CONNECTED');
  }

  unsubscribe(symbol: string): void {
    delete this.callbacks[symbol];
    delete this.candleCallbacks[symbol];
  }

  stop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }
}

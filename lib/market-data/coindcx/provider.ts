import { MarketDataProvider, MarketTick, Candle } from '../../../types';
import { CoinDCXNormalizer } from './normalizer';

export class CoinDCXMarketDataProvider implements MarketDataProvider {
  private tickerCallbacks: { [symbol: string]: ((tick: MarketTick) => void)[] } = {};
  private candleCallbacks: { [symbol: string]: ((candle: Candle) => void)[] } = {};
  private connectionCallbacks: ((status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED') => void)[] = [];
  
  private pollingInterval: any = null;
  private isConnected = false;

  constructor() {
    this.connect();
  }

  private connect() {
    this.notifyConnectionState('CONNECTING');
    
    // Start polling immediately
    this.startPolling();
  }
  
  private async startPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    
    // Test connection first
    try {
      await this.fetchTicker();
      this.isConnected = true;
      this.notifyConnectionState('CONNECTED');
    } catch (e) {
      this.isConnected = false;
      this.notifyConnectionState('DISCONNECTED');
    }

    // Poll every 2 seconds for a responsive feel
    this.pollingInterval = setInterval(async () => {
      try {
        await this.fetchTicker();
        
        // Also fetch latest candle to simulate live candle updates
        if (this.candleCallbacks['BTC/INR']?.length > 0) {
          const candles = await this.getHistoricalCandles('BTC/INR', '1m', 1);
          if (candles.length > 0 && this.candleCallbacks['BTC/INR']) {
             this.candleCallbacks['BTC/INR'].forEach(cb => cb(candles[candles.length - 1]));
          }
        }
        
        if (!this.isConnected) {
          this.isConnected = true;
          this.notifyConnectionState('CONNECTED');
        }
      } catch (e) {
        if (this.isConnected) {
          this.isConnected = false;
          this.notifyConnectionState('DISCONNECTED');
        }
      }
    }, 2000);
  }

  private async fetchTicker() {
    if (!this.tickerCallbacks['BTC/INR']?.length) return;
    
    const response = await fetch('/api/coindcx/ticker');
    if (!response.ok) throw new Error('Network error');
    
    const data = await response.json();
    
    // CoinDCX returns an array of all tickers
    const btcTicker = Array.isArray(data) ? data.find((t: any) => t.market === 'BTCINR') : null;
    
    if (btcTicker) {
       const tick = CoinDCXNormalizer.normalizeTicker({ data: btcTicker });
       if (tick && this.tickerCallbacks['BTC/INR']) {
         this.tickerCallbacks['BTC/INR'].forEach(cb => cb(tick));
       }
    }
  }

  onConnectionChange(callback: (status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED') => void): void {
    this.connectionCallbacks.push(callback);
    callback(this.isConnected ? 'CONNECTED' : 'CONNECTING');
  }

  private notifyConnectionState(status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED') {
    this.connectionCallbacks.forEach(cb => cb(status));
  }

  subscribeToTicker(symbol: string, callback: (tick: MarketTick) => void): void {
    if (!this.tickerCallbacks[symbol]) {
      this.tickerCallbacks[symbol] = [];
    }
    this.tickerCallbacks[symbol].push(callback);
  }

  subscribeToCandles(symbol: string, timeframe: string, callback: (candle: Candle) => void): void {
    if (!this.candleCallbacks[symbol]) {
      this.candleCallbacks[symbol] = [];
    }
    this.candleCallbacks[symbol].push(callback);
  }

  async getHistoricalCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
    try {
      const response = await fetch(`/api/coindcx/candles?pair=B-BTC_INR&interval=${timeframe}`);
      if (!response.ok) throw new Error('Failed to fetch candles');
      const data = await response.json();
      return CoinDCXNormalizer.normalizeCandles(data);
    } catch (e) {
      console.error("Error fetching historical candles", e);
      return [];
    }
  }

  unsubscribe(symbol: string): void {
    delete this.tickerCallbacks[symbol];
    delete this.candleCallbacks[symbol];
  }
  
  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }
}

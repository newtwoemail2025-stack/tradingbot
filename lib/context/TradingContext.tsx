'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { MarketTick, Portfolio, Position, Order, Candle, MarketDataProvider } from '../../types';
import { MockMarketDataProvider } from '../market-data/mock';
import { CoinDCXMarketDataProvider } from '../market-data/coindcx/provider';
import { PaperTradingEngine } from '../orders/paper';

interface TradingContextType {
  tick: MarketTick | null;
  portfolio: Portfolio;
  positions: Position[];
  orders: Order[];
  placeOrder: (
    symbol: string, 
    side: 'BUY' | 'SELL', 
    positionSide: 'LONG' | 'SHORT',
    action: 'OPEN' | 'CLOSE',
    type: 'MARKET' | 'LIMIT', 
    quantity: number, 
    price?: number,
    stopLoss?: number,
    takeProfit?: number
  ) => void;
  marketData: MarketDataProvider | null;
  dataSource: 'MOCK' | 'REAL';
  setDataSource: (source: 'MOCK' | 'REAL') => void;
  connectionStatus: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';
}

const TradingContext = createContext<TradingContextType | undefined>(undefined);

export const TradingProvider = ({ children }: { children: React.ReactNode }) => {
  const [tick, setTick] = useState<MarketTick | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio>({ balance: 10000, equity: 10000, unrealizedPnl: 0, realizedPnl: 0 });
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  
  const [dataSource, setDataSource] = useState<'MOCK' | 'REAL'>('MOCK');
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTED' | 'CONNECTING' | 'DISCONNECTED'>('DISCONNECTED');
  const [activeProvider, setActiveProvider] = useState<MarketDataProvider | null>(null);
  
  const engineRef = useRef<PaperTradingEngine | null>(null);

  useEffect(() => {
    engineRef.current = new PaperTradingEngine();
  }, []);

  useEffect(() => {
    if (activeProvider) {
      activeProvider.unsubscribe('BTC/INR');
    }

    const provider = dataSource === 'REAL' ? new CoinDCXMarketDataProvider() : new MockMarketDataProvider();
    
    if (provider.onConnectionChange) {
      provider.onConnectionChange(setConnectionStatus);
    } else {
      setConnectionStatus('CONNECTED'); // Mock is always connected
    }

    provider.subscribeToTicker('BTC/INR', (newTick) => {
      setTick(newTick);
      if (engineRef.current) {
        engineRef.current.processMarketTick(newTick);
        setPortfolio(engineRef.current.getPortfolio());
        setPositions([...engineRef.current.getPositions()]);
        setOrders([...engineRef.current.getOrders()]);
      }
    });

    setActiveProvider(provider);

    return () => {
      provider.unsubscribe('BTC/INR');
      if (provider instanceof MockMarketDataProvider) {
        provider.stop();
      }
    };
  }, [dataSource]);

  const placeOrder = (
    symbol: string, 
    side: 'BUY' | 'SELL', 
    positionSide: 'LONG' | 'SHORT',
    action: 'OPEN' | 'CLOSE',
    type: 'MARKET' | 'LIMIT', 
    quantity: number, 
    price?: number,
    stopLoss?: number,
    takeProfit?: number
  ) => {
    if (engineRef.current) {
      try {
        engineRef.current.placeOrder(symbol, side, positionSide, action, type, quantity, price, stopLoss, takeProfit);
        setOrders([...engineRef.current.getOrders()]);
      } catch (err: any) {
        alert(err.message || 'Error placing order');
      }
    }
  };

  return (
    <TradingContext.Provider value={{ 
      tick, 
      portfolio, 
      positions, 
      orders, 
      placeOrder,
      marketData: activeProvider,
      dataSource,
      setDataSource,
      connectionStatus
    }}>
      {children}
    </TradingContext.Provider>
  );
};

export const useTrading = () => {
  const context = useContext(TradingContext);
  if (context === undefined) {
    throw new Error('useTrading must be used within a TradingProvider');
  }
  return context;
};


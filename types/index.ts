export type MarketTick = {
  symbol: string;
  price: number;
  timestamp: number;
  volume24h?: number;
  change24h?: number;
};

export type Candle = {
  time: number; // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type OrderSide = 'BUY' | 'SELL';
export type PositionSide = 'LONG' | 'SHORT';
export type OrderAction = 'OPEN' | 'CLOSE';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';
export type OrderStatus = 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export type Order = {
  id: string;
  symbol: string;
  side: OrderSide;
  positionSide: PositionSide;
  action: OrderAction;
  type: OrderType;
  quantity: number;
  price?: number; // Optional for MARKET
  stopPrice?: number;
  takeProfit?: number;
  status: OrderStatus;
  timestamp: number;
  filledAt?: number;
};

export type PositionStatus = 'OPEN' | 'CLOSED';

export type Position = {
  id: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  unrealizedPnl: number;
  realizedPnl: number;
  status: PositionStatus;
  openedAt: number;
};

export type Trade = {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  positionSide: PositionSide;
  action: OrderAction;
  quantity: number;
  price: number;
  timestamp: number;
};

export * from './strategy';

export type RiskParameters = {
  maxRiskPerTrade: number;
  maxDailyLoss: number;
  maxPositionSize: number;
  maxOpenPositions: number;
  killSwitch: boolean;
};

export type Portfolio = {
  balance: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
};

export interface MarketDataProvider {
  subscribeToTicker(symbol: string, callback: (tick: MarketTick) => void): void;
  subscribeToCandles(symbol: string, timeframe: string, callback: (candle: Candle) => void): void;
  getHistoricalCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]>;
  unsubscribe(symbol: string): void;
  onConnectionChange?(callback: (status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED') => void): void;
}

export interface ExchangeProvider {
  getBalance(): Promise<Portfolio>;
  getPositions(): Promise<Position[]>;
  placeOrder(order: Omit<Order, 'id' | 'status' | 'timestamp'>): Promise<Order>;
  cancelOrder(orderId: string): Promise<boolean>;
  getOrder(orderId: string): Promise<Order>;
  getOpenOrders(): Promise<Order[]>;
}



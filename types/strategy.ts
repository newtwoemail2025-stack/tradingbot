import { Candle, PositionSide } from './index';

export type StrategyAction = 'HOLD' | 'OPEN_LONG' | 'CLOSE_LONG' | 'OPEN_SHORT' | 'CLOSE_SHORT';
export type ExitReason = 'STOP_LOSS' | 'TAKE_PROFIT' | 'SIGNAL' | 'END_OF_BACKTEST';

export interface StrategySignal {
  action: StrategyAction;
  timestamp: number;
  confidence?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  reason: string[];
  strategyName: string;
}

export interface EventRisk {
  id: string;
  timestamp: number;
  type: 'NEWS' | 'ECONOMIC_EVENT' | 'VOLATILITY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
}

export interface StrategyContext {
  openPositions: BacktestPosition[];
  events: EventRisk[];
  currentBalance: number;
}

export interface StrategyConfig {
  volumeMultiplier?: number;
  adxPeriod?: number;
  minimumADX?: number;
  minimumEMASeparation?: number;
  minimumATRPercent?: number;
  breakoutCandles?: number;
  [key: string]: number | string | boolean | undefined;
}

export interface Strategy {
  name: string;
  evaluate(candles: Candle[], config: StrategyConfig, context: StrategyContext): StrategySignal;
}

export interface BacktestCostConfig {
  feePerSidePct: number;
  slippagePerSidePct: number;
}

export interface BacktestConfig {
  initialCapital: number;
  riskPerTradePercent: number; // e.g., 1.0 for 1%
  costConfig?: BacktestCostConfig;
  strategyConfig: StrategyConfig;
}

export interface BacktestPosition {
  id: string;
  side: PositionSide;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface TradeLog {
  id: string;
  strategy: string;
  symbol: string;
  side: PositionSide;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number;
  grossPnl: number;
  fees: number;
  slippage: number;
  netPnl: number;
  exitReason: ExitReason;
}

export interface EquityPoint {
  time: number;
  value: number;
}

export interface BacktestMetrics {
  startingCapital: number;
  finalCapital: number;
  netProfit: number;
  netReturnPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  averageTrade: number;
  largestWin: number;
  largestLoss: number;
  totalFees: number;
  totalSlippage: number;
  longTradesCount: number;
  shortTradesCount: number;
  longPnl: number;
  shortPnl: number;
  averageHoldingTimeMs: number;
  medianHoldingTimeMs: number;
  equityCurve: EquityPoint[];
  trades: TradeLog[];
}

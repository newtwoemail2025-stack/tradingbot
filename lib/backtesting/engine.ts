import { Candle } from '../../types';
import { 
  BacktestConfig, 
  BacktestMetrics, 
  BacktestPosition, 
  Strategy, 
  StrategyContext, 
  TradeLog, 
  EquityPoint 
} from '../../types/strategy';
import { calculatePositionSize } from '../risk/position-sizing';

export class BacktestEngine {
  private strategy: Strategy;
  private config: BacktestConfig;
  
  private currentBalance: number;
  private peakBalance: number;
  private openPositions: BacktestPosition[] = [];
  private tradeHistory: TradeLog[] = [];
  private equityCurve: EquityPoint[] = [];

  private feePerSidePct: number;
  private slippagePerSidePct: number;

  constructor(strategy: Strategy, config: BacktestConfig) {
    this.strategy = strategy;
    this.config = config;
    this.currentBalance = config.initialCapital;
    this.peakBalance = config.initialCapital;
    
    this.feePerSidePct = config.costConfig?.feePerSidePct ?? 0.20;
    this.slippagePerSidePct = config.costConfig?.slippagePerSidePct ?? 0.10;
    
    if (typeof this.feePerSidePct !== 'number' || !Number.isFinite(this.feePerSidePct) || this.feePerSidePct < 0) {
      throw new Error("feePerSidePct must be a finite non-negative number");
    }
    if (typeof this.slippagePerSidePct !== 'number' || !Number.isFinite(this.slippagePerSidePct) || this.slippagePerSidePct < 0) {
      throw new Error("slippagePerSidePct must be a finite non-negative number");
    }
  }

  public run(candles: Candle[]): BacktestMetrics {
    if (candles.length === 0) {
      throw new Error("No historical data provided for backtest");
    }

    this.equityCurve.push({
      time: candles[0].time,
      value: this.currentBalance
    });

    for (let i = 0; i < candles.length; i++) {
      const currentCandle = candles[i];
      const previousCandles = candles.slice(0, i + 1); // Only up to current candle (no look-ahead)

      // 1. Process open positions (check SL/TP using exact current candle High/Low)
      this.processOpenPositions(currentCandle);

      // 2. Evaluate Strategy
      const context: StrategyContext = {
        openPositions: this.openPositions,
        events: [], // Extensible for future
        currentBalance: this.currentBalance
      };

      const signal = this.strategy.evaluate(previousCandles, { ...this.config.strategyConfig, costConfig: this.config.costConfig }, context);

      // 3. Execute Signal
      if (signal.action === 'OPEN_LONG' || signal.action === 'OPEN_SHORT') {
        // Prevent opening multiple positions in this simplified version
        if (this.openPositions.length === 0) {
          const entryPrice = signal.entryPrice || currentCandle.close;
          
          // Apply slippage penalty to entry price
          const slippageAmount = entryPrice * (this.slippagePerSidePct / 100);
          const executedEntryPrice = signal.action === 'OPEN_LONG' ? entryPrice + slippageAmount : entryPrice - slippageAmount;

          const quantity = calculatePositionSize(
            this.currentBalance,
            this.config.riskPerTradePercent,
            executedEntryPrice,
            signal.stopLoss || 0,
            signal.action === 'OPEN_LONG' ? 'LONG' : 'SHORT'
          );

          if (quantity > 0) {
            const entryFee = (executedEntryPrice * quantity) * (this.feePerSidePct / 100);
            
            // We do NOT deduct entry fee from balance immediately to simplify equity tracking, 
            // we will deduct both entry and exit fees upon trade completion.

            this.openPositions.push({
              id: Math.random().toString(36).substring(7),
              side: signal.action === 'OPEN_LONG' ? 'LONG' : 'SHORT',
              entryTime: signal.timestamp,
              entryPrice: executedEntryPrice,
              quantity,
              stopLoss: signal.stopLoss,
              takeProfit: signal.takeProfit
            });
          }
        }
      } else if (signal.action === 'CLOSE_LONG' || signal.action === 'CLOSE_SHORT') {
        const sideToClose = signal.action === 'CLOSE_LONG' ? 'LONG' : 'SHORT';
        const positionIndex = this.openPositions.findIndex(p => p.side === sideToClose);
        if (positionIndex !== -1) {
          this.closePosition(positionIndex, currentCandle.time, currentCandle.close, 'SIGNAL');
        }
      }

      // Record equity daily or at interval
      // For simplicity, we record it every candle here. In prod, maybe decimate the points.
      let unrealizedPnl = 0;
      this.openPositions.forEach(p => {
        if (p.side === 'LONG') unrealizedPnl += (currentCandle.close - p.entryPrice) * p.quantity;
        if (p.side === 'SHORT') unrealizedPnl += (p.entryPrice - currentCandle.close) * p.quantity;
      });
      
      const equity = this.currentBalance + unrealizedPnl;
      if (equity > this.peakBalance) this.peakBalance = equity;

      this.equityCurve.push({
        time: currentCandle.time,
        value: equity
      });
    }

    // Force close any remaining positions at the end of backtest
    const lastCandle = candles[candles.length - 1];
    while (this.openPositions.length > 0) {
      this.closePosition(0, lastCandle.time, lastCandle.close, 'END_OF_BACKTEST');
    }

    return this.calculateMetrics();
  }

  private processOpenPositions(candle: Candle) {
    for (let i = this.openPositions.length - 1; i >= 0; i--) {
      const pos = this.openPositions[i];

      // PESSIMISTIC EXECUTION: If both SL and TP are hit inside the same candle,
      // we must force the Stop Loss to prevent fabricating unverified win rates.
      if (pos.side === 'LONG') {
        const hitSL = pos.stopLoss && candle.low <= pos.stopLoss;
        const hitTP = pos.takeProfit && candle.high >= pos.takeProfit;
        
        if (hitSL) {
          this.closePosition(i, candle.time, pos.stopLoss!, 'STOP_LOSS');
        } else if (hitTP) {
          this.closePosition(i, candle.time, pos.takeProfit!, 'TAKE_PROFIT');
        }
      } else if (pos.side === 'SHORT') {
        const hitSL = pos.stopLoss && candle.high >= pos.stopLoss;
        const hitTP = pos.takeProfit && candle.low <= pos.takeProfit;
        
        if (hitSL) {
          this.closePosition(i, candle.time, pos.stopLoss!, 'STOP_LOSS');
        } else if (hitTP) {
          this.closePosition(i, candle.time, pos.takeProfit!, 'TAKE_PROFIT');
        }
      }
    }
  }

  private closePosition(index: number, exitTime: number, rawExitPrice: number, reason: TradeLog['exitReason']) {
    const pos = this.openPositions[index];
    this.openPositions.splice(index, 1);

    // Apply slippage penalty to exit price
    const slippageAmount = rawExitPrice * (this.slippagePerSidePct / 100);
    const executedExitPrice = pos.side === 'LONG' ? rawExitPrice - slippageAmount : rawExitPrice + slippageAmount;

    let grossPnl = 0;
    if (pos.side === 'LONG') {
      grossPnl = (executedExitPrice - pos.entryPrice) * pos.quantity;
    } else {
      grossPnl = (pos.entryPrice - executedExitPrice) * pos.quantity;
    }

    const entryFee = (pos.entryPrice * pos.quantity) * (this.feePerSidePct / 100);
    const exitFee = (executedExitPrice * pos.quantity) * (this.feePerSidePct / 100);
    const totalFees = entryFee + exitFee;
    
    // Calculate total slippage cost in fiat terms for metrics
    const entrySlippageFiat = (pos.entryPrice * (this.slippagePerSidePct / 100)) * pos.quantity;
    const exitSlippageFiat = (rawExitPrice * (this.slippagePerSidePct / 100)) * pos.quantity;
    const totalSlippage = entrySlippageFiat + exitSlippageFiat;

    const netPnl = grossPnl - totalFees;
    this.currentBalance += netPnl;

    this.tradeHistory.push({
      id: pos.id,
      strategy: this.strategy.name,
      symbol: 'BTC/INR',
      side: pos.side,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice, // This already has slippage applied
      exitTime,
      exitPrice: executedExitPrice, // This already has slippage applied
      quantity: pos.quantity,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      grossPnl,
      fees: totalFees,
      slippage: totalSlippage,
      netPnl,
      exitReason: reason
    });
  }

  private calculateMetrics(): BacktestMetrics {
    const totalTrades = this.tradeHistory.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalWin = 0;
    let totalLoss = 0;
    let totalFees = 0;
    let totalSlippage = 0;
    
    let largestWin = 0;
    let largestLoss = 0;
    
    let longTradesCount = 0;
    let shortTradesCount = 0;
    let longPnl = 0;
    let shortPnl = 0;
    
    let peakBal = this.config.initialCapital;
    let maxDrawdown = 0;
    
    const holdingTimes: number[] = [];

    for (const trade of this.tradeHistory) {
      if (trade.netPnl > 0) {
        winningTrades++;
        totalWin += trade.netPnl;
        if (trade.netPnl > largestWin) largestWin = trade.netPnl;
      } else {
        losingTrades++;
        totalLoss += Math.abs(trade.netPnl);
        if (trade.netPnl < largestLoss) largestLoss = trade.netPnl;
      }
      
      if (trade.side === 'LONG') {
        longTradesCount++;
        longPnl += trade.netPnl;
      } else {
        shortTradesCount++;
        shortPnl += trade.netPnl;
      }

      holdingTimes.push(trade.exitTime - trade.entryTime);

      totalFees += trade.fees;
      totalSlippage += trade.slippage;
    }

    for (const pt of this.equityCurve) {
      if (pt.value > peakBal) peakBal = pt.value;
      const dd = peakBal - pt.value;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    
    let averageHoldingTimeMs = 0;
    let medianHoldingTimeMs = 0;
    
    if (holdingTimes.length > 0) {
      holdingTimes.sort((a, b) => a - b);
      const sum = holdingTimes.reduce((acc, curr) => acc + curr, 0);
      averageHoldingTimeMs = sum / holdingTimes.length;
      const mid = Math.floor(holdingTimes.length / 2);
      medianHoldingTimeMs = holdingTimes.length % 2 !== 0 ? holdingTimes[mid] : (holdingTimes[mid - 1] + holdingTimes[mid]) / 2;
    }

    const netProfit = this.currentBalance - this.config.initialCapital;
    const netReturnPercent = (netProfit / this.config.initialCapital) * 100;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const averageWin = winningTrades > 0 ? totalWin / winningTrades : 0;
    const averageLoss = losingTrades > 0 ? totalLoss / losingTrades : 0;
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? Infinity : 0);
    const averageTrade = totalTrades > 0 ? netProfit / totalTrades : 0;
    const maxDrawdownPercent = (maxDrawdown / peakBal) * 100;

    return {
      startingCapital: this.config.initialCapital,
      finalCapital: this.currentBalance,
      netProfit,
      netReturnPercent,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      averageWin,
      averageLoss,
      profitFactor,
      maxDrawdown,
      maxDrawdownPercent,
      averageTrade,
      largestWin,
      largestLoss,
      totalFees,
      totalSlippage,
      longTradesCount,
      shortTradesCount,
      longPnl,
      shortPnl,
      averageHoldingTimeMs,
      medianHoldingTimeMs,
      equityCurve: this.equityCurve,
      trades: this.tradeHistory
    };
  }
}

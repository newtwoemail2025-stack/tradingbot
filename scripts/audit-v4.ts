import fs from 'fs';
import { BacktestEngine } from '../lib/backtesting/engine';
import { MeanReversionStrategyV4 } from '../lib/strategy/meanReversionV4';
import { Candle } from '../types';

async function main() {
  const jsonData = fs.readFileSync('public/data/btc-inr-90d-1m.json', 'utf8');
  const allCandles = JSON.parse(jsonData) as Candle[];
  allCandles.sort((a, b) => a.time - b.time);
  
  const defaultConfig = {
    initialCapital: 10000,
    tradingFeePercent: 0.2,
    slippagePercent: 0.1,
    riskPerTradePercent: 1.0,
    strategyConfig: {
      bbPeriod: 20,
      bbStdDev: 2.0,
      rsiPeriod: 14,
      oversoldRSI: 30,
      overboughtRSI: 70,
      emaFast: 20,
      emaSlow: 50,
      adxPeriod: 14,
      maxTrendADX: 25,
      atrPeriod: 14,
      atrMultiplier: 1.5,
      maxRiskReward: 5.0
    }
  };

  const strategy = new MeanReversionStrategyV4();
  const engine = new BacktestEngine(strategy, defaultConfig);
  const metrics = engine.run(allCandles);
  
  console.log(`Total trades: ${metrics.trades.length}`);
  
  const trades = metrics.trades.slice(0, 30);
  console.log("\n==================================================");
  console.log("FIRST 30 TRADES AUDIT");
  console.log("==================================================");
  
  let stopLossCount = 0;
  let takeProfitCount = 0;
  let endOfBacktestCount = 0;
  
  let directionPassCount = 0;
  
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    console.log(`\nTrade #${i + 1} - ${t.side}`);
    console.log(`Entry Time: ${new Date(t.entryTime).toISOString()}`);
    console.log(`Exit Time:  ${new Date(t.exitTime).toISOString()}`);
    console.log(`Entry Price: ₹${t.entryPrice.toFixed(2)} | SL: ₹${t.stopLoss?.toFixed(2)} | TP: ₹${t.takeProfit?.toFixed(2)}`);
    console.log(`Exit Price:  ₹${t.exitPrice.toFixed(2)} | Reason: ${t.exitReason}`);
    
    const holdingDuration = (t.exitTime - t.entryTime) / 60000;
    console.log(`Duration: ${holdingDuration} mins`);
    console.log(`Gross P&L: ₹${t.grossPnl.toFixed(2)} | Fees: ₹${t.fees.toFixed(2)} | Slippage: ₹${t.slippage.toFixed(2)} | Net P&L: ₹${t.netPnl.toFixed(2)}`);
    
    if (t.exitReason === 'STOP_LOSS') stopLossCount++;
    else if (t.exitReason === 'TAKE_PROFIT') takeProfitCount++;
    else if (t.exitReason === 'END_OF_BACKTEST') endOfBacktestCount++;
    
    // Check direction
    if (t.side === 'LONG') {
      const movedFavorable = t.exitPrice > t.entryPrice;
      console.log(`Direction Favorable? ${movedFavorable ? 'YES' : 'NO'}`);
      if (movedFavorable) directionPassCount++;
    } else {
      const movedFavorable = t.exitPrice < t.entryPrice;
      console.log(`Direction Favorable? ${movedFavorable ? 'YES' : 'NO'}`);
      if (movedFavorable) directionPassCount++;
    }
  }
  
  console.log("\n==================================================");
  console.log("EXIT COUNTS (First 30)");
  console.log("==================================================");
  console.log(`STOP_LOSS: ${stopLossCount}`);
  console.log(`TAKE_PROFIT: ${takeProfitCount}`);
  console.log(`END_OF_BACKTEST: ${endOfBacktestCount}`);
  console.log(`OTHER: ${trades.length - stopLossCount - takeProfitCount - endOfBacktestCount}`);
}

main().catch(console.error);

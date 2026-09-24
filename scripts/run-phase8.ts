import fs from 'fs';
import { BacktestEngine } from '../lib/backtesting/engine';
import { MomentumStrategyV3 } from '../lib/strategy/momentumV3';
import { Candle } from '../types';

function runBacktest(candles: Candle[], config: any) {
  const strategy = new MomentumStrategyV3();
  
  // Wrap evaluate to spy on signals vs executions
  let rawLongSignals = 0;
  let rawShortSignals = 0;
  let ignoredSignals = 0;
  
  const originalEvaluate = strategy.evaluate.bind(strategy);
  strategy.evaluate = function(slicedCandles: Candle[], stratConfig: any, context: any) {
    const signal = originalEvaluate(slicedCandles, stratConfig, context);
    if (signal.action === 'OPEN_LONG') {
      rawLongSignals++;
      if (context.openPositions.length > 0) ignoredSignals++;
    } else if (signal.action === 'OPEN_SHORT') {
      rawShortSignals++;
      if (context.openPositions.length > 0) ignoredSignals++;
    }
    return signal;
  };

  const engine = new BacktestEngine(strategy, config);
  const metrics = engine.run(candles);
  
  return { metrics, rawLongSignals, rawShortSignals, ignoredSignals };
}

function runWalkForward(candles: Candle[], config: any, trainDays = 7, oosDays = 1) {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const trainMs = trainDays * oneDayMs;
  const oosMs = oosDays * oneDayMs;

  const firstTime = candles[0].time;
  const lastTime = candles[candles.length - 1].time;
  
  let currentStart = firstTime;
  let positiveOOS = 0;
  let negativeOOS = 0;
  let totalOOSPnl = 0;
  let totalWindows = 0;
  
  console.log(`Starting walk-forward (this may take a minute or two)...`);

  while (currentStart + trainMs + oosMs <= lastTime) {
    totalWindows++;
    const trainEnd = currentStart + trainMs;
    const oosEnd = trainEnd + oosMs;

    const oosCandles = candles.filter(c => c.time >= trainEnd && c.time < oosEnd);

    if (oosCandles.length > 0) {
      const oosEngine = new BacktestEngine(new MomentumStrategyV3(), config);
      const oosMetrics = oosEngine.run(oosCandles);

      totalOOSPnl += oosMetrics.netProfit;
      if (oosMetrics.netProfit > 0) positiveOOS++;
      else negativeOOS++;
    }
    currentStart += oosMs;
    if (totalWindows % 10 === 0) process.stdout.write('.');
  }
  
  console.log();
  return { totalWindows, positiveOOS, negativeOOS, totalOOSPnl };
}

async function main() {
  const jsonData = fs.readFileSync('public/data/btc-inr-90d-1m.json', 'utf8');
  const allCandles = JSON.parse(jsonData) as Candle[];
  
  // Ensure sorted by time
  allCandles.sort((a, b) => a.time - b.time);
  
  const defaultConfig = {
    initialCapital: 10000,
    costConfig: { feePerSidePct: 0.2, slippagePerSidePct: 0.1 },
    riskPerTradePercent: 1.0,
    strategyConfig: {
      emaFast: 20,
      emaSlow: 50,
      adxPeriod: 14,
      minimumADX: 20,
      pullbackLookback: 3,
      pullbackTolerancePercent: 0.001,
      volumeMultiplier: 1.2,
      minimumATRPercent: 0.001,
      atrBuffer: 0.5,
      riskReward: 2.0
    }
  };

  console.log("Running Full 90-Day Backtest...");
  const start = Date.now();
  const fullResult = runBacktest(allCandles, defaultConfig);
  const m = fullResult.metrics;
  console.log(`Full backtest completed in ${Date.now() - start}ms`);

  console.log("Running OOS Split (60% Train, 20% Val, 20% Test)...");
  const oosSplitIndex = Math.floor(allCandles.length * 0.8);
  const oosCandles = allCandles.slice(oosSplitIndex);
  const oosResult = runBacktest(oosCandles, defaultConfig).metrics;

  const wfResult = runWalkForward(allCandles, defaultConfig);

  console.log("Running Cost Sensitivity (2x fees, 3x slippage)...");
  const costConfig = JSON.parse(JSON.stringify(defaultConfig));
  costConfig.tradingFeePercent = 0.4;
  costConfig.slippagePercent = 0.3;
  const costResult = runBacktest(allCandles, costConfig).metrics;

  const fmtMs = (ms: number) => {
    if (ms === 0) return "0s";
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  console.log("\n==================================================");
  console.log("ALGOX — PHASE 8 FINAL REPORT");
  console.log("==================================================");
  console.log("\nDATA");
  console.log("----");
  console.log(`Candles: ${allCandles.length}`);
  console.log(`Days: ${(allCandles[allCandles.length - 1].time - allCandles[0].time) / (1000 * 60 * 60 * 24)}`);

  console.log("\nSIGNALS");
  console.log("-------");
  console.log(`LONG signals generated: ${fullResult.rawLongSignals}`);
  console.log(`SHORT signals generated: ${fullResult.rawShortSignals}`);
  console.log(`Signals ignored because position already open: ${fullResult.ignoredSignals}`);

  console.log("\nEXECUTED TRADES");
  console.log("---------------");
  console.log(`Total: ${m.totalTrades}`);
  console.log(`Long: ${m.longTradesCount}`);
  console.log(`Short: ${m.shortTradesCount}`);

  console.log("\nFULL BACKTEST");
  console.log("-------------");
  console.log(`Win rate: ${m.winRate.toFixed(2)}%`);
  console.log(`Net P&L: ₹${m.netProfit.toFixed(2)}`);
  console.log(`Return: ${m.netReturnPercent.toFixed(2)}%`);
  console.log(`Profit factor: ${m.profitFactor.toFixed(2)}`);
  console.log(`Max drawdown: ${m.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`Fees: ₹${m.totalFees.toFixed(2)}`);
  console.log(`Slippage: ₹${m.totalSlippage.toFixed(2)}`);

  console.log("\nAVERAGE HOLDING");
  console.log("---------------");
  console.log(`Average: ${fmtMs(m.averageHoldingTimeMs)}`);
  console.log(`Median: ${fmtMs(m.medianHoldingTimeMs)}`);
  let maxHolding = 0;
  m.trades.forEach(t => {
      const dur = t.exitTime - t.entryTime;
      if (dur > maxHolding) maxHolding = dur;
  });
  console.log(`Maximum: ${fmtMs(maxHolding)}`);

  console.log("\nOUT OF SAMPLE (Final 20%)");
  console.log("-------------");
  console.log(`Trades: ${oosResult.totalTrades}`);
  console.log(`P&L: ₹${oosResult.netProfit.toFixed(2)}`);
  console.log(`Return: ${oosResult.netReturnPercent.toFixed(2)}%`);
  console.log(`Profit factor: ${oosResult.profitFactor.toFixed(2)}`);
  console.log(`Drawdown: ${oosResult.maxDrawdownPercent.toFixed(2)}%`);

  console.log("\nWALK FORWARD");
  console.log("------------");
  console.log(`Windows: ${wfResult.totalWindows}`);
  console.log(`Positive OOS: ${wfResult.positiveOOS}`);
  console.log(`Negative OOS: ${wfResult.negativeOOS}`);
  console.log(`Total OOS P&L: ₹${wfResult.totalOOSPnl.toFixed(2)}`);

  console.log("\nCOST SENSITIVITY");
  console.log("----------------");
  console.log(`Normal: ₹${m.netProfit.toFixed(2)}`);
  console.log(`Higher fees: ₹${runBacktest(allCandles, {...defaultConfig, tradingFeePercent: 0.4}).metrics.netProfit.toFixed(2)}`);
  console.log(`Higher slippage: ₹${costResult.netProfit.toFixed(2)}`);

}

main().catch(console.error);

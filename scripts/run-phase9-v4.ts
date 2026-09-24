import fs from 'fs';
import { BacktestEngine } from '../lib/backtesting/engine';
import { MeanReversionStrategyV4 } from '../lib/strategy/meanReversionV4';
import { Candle } from '../types';

function runBacktest(candles: Candle[], config: any) {
  const strategy = new MeanReversionStrategyV4();
  
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
  
  console.log(`Starting walk-forward...`);

  while (currentStart + trainMs + oosMs <= lastTime) {
    totalWindows++;
    const trainEnd = currentStart + trainMs;
    const oosEnd = trainEnd + oosMs;

    const oosCandles = candles.filter(c => c.time >= trainEnd && c.time < oosEnd);

    if (oosCandles.length > 0) {
      const oosEngine = new BacktestEngine(new MeanReversionStrategyV4(), config);
      const oosMetrics = oosEngine.run(oosCandles);

      totalOOSPnl += oosMetrics.netProfit;
      if (oosMetrics.netProfit > 0) positiveOOS++;
      else negativeOOS++;
    }
    currentStart += oosMs;
  }
  
  return { totalWindows, positiveOOS, negativeOOS, totalOOSPnl };
}

async function main() {
  const jsonData = fs.readFileSync('public/data/btc-inr-90d-1m.json', 'utf8');
  const allCandles = JSON.parse(jsonData) as Candle[];
  allCandles.sort((a, b) => a.time - b.time);
  
  const defaultConfig = {
    initialCapital: 10000,
    costConfig: { feePerSidePct: 0.2, slippagePerSidePct: 0.1 },
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

  const fullResult = runBacktest(allCandles, defaultConfig);
  const m = fullResult.metrics;

  const oosSplitIndex = Math.floor(allCandles.length * 0.8);
  const oosCandles = allCandles.slice(oosSplitIndex);
  const oosResult = runBacktest(oosCandles, defaultConfig).metrics;

  const wfResult = runWalkForward(allCandles, defaultConfig);

  const costConfig = JSON.parse(JSON.stringify(defaultConfig));
  costConfig.tradingFeePercent = 0.4;
  costConfig.slippagePercent = 0.3;
  const costResult = runBacktest(allCandles, costConfig).metrics;
  
  const higherFeeConfig = JSON.parse(JSON.stringify(defaultConfig));
  higherFeeConfig.tradingFeePercent = 0.4;
  const higherFeeResult = runBacktest(allCandles, higherFeeConfig).metrics;

  console.log(`Candles: ${allCandles.length}`);
  console.log(`V4 trades: ${m.totalTrades}`);
  console.log(`LONG / SHORT: ${m.longTradesCount} / ${m.shortTradesCount}`);
  console.log(`Win rate: ${m.winRate.toFixed(2)}%`);
  console.log(`Net P&L: ₹${m.netProfit.toFixed(2)}`);
  console.log(`Return: ${m.netReturnPercent.toFixed(2)}%`);
  console.log(`Profit factor: ${m.profitFactor.toFixed(2)}`);
  console.log(`Max drawdown: ${m.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`OOS trades: ${oosResult.totalTrades}`);
  console.log(`OOS P&L: ₹${oosResult.netProfit.toFixed(2)}`);
  console.log(`OOS return: ${oosResult.netReturnPercent.toFixed(2)}%`);
  console.log(`OOS profit factor: ${oosResult.profitFactor.toFixed(2)}`);
  console.log(`Walk-forward windows: ${wfResult.totalWindows}`);
  console.log(`Positive OOS windows: ${wfResult.positiveOOS} / ${wfResult.totalWindows}`);
  console.log(`Normal-cost P&L: ₹${m.netProfit.toFixed(2)}`);
  console.log(`Higher-fee P&L: ₹${higherFeeResult.netProfit.toFixed(2)}`);
  console.log(`Higher-slippage P&L: ₹${costResult.netProfit.toFixed(2)}`);

}

main().catch(console.error);

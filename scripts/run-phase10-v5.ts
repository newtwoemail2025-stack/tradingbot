import fs from 'fs';
import { BacktestEngine } from '../lib/backtesting/engine';
import { MomentumStrategyV5 } from '../lib/strategy/momentumV5';
import { Candle } from '../types';

function runBacktest(candles: Candle[], config: any) {
  const strategy = new MomentumStrategyV5();
  
  const engine = new BacktestEngine(strategy, config);
  const metrics = engine.run(candles);
  
  return { metrics, diagnostics: strategy.diagnostics };
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
  
  while (currentStart + trainMs + oosMs <= lastTime) {
    totalWindows++;
    const trainEnd = currentStart + trainMs;
    const oosEnd = trainEnd + oosMs;

    const oosCandles = candles.filter(c => c.time >= trainEnd && c.time < oosEnd);

    if (oosCandles.length > 0) {
      const oosEngine = new BacktestEngine(new MomentumStrategyV5(), config);
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
      emaFast: 20,
      emaSlow: 50,
      rsiPeriod: 14,
      longRsiMin: 55,
      longRsiMax: 70,
      shortRsiMin: 30,
      shortRsiMax: 45,
      adxPeriod: 14,
      adxThreshold: 20,
      atrPeriod: 14,
      atrStopMultiplier: 1.5,
      rewardRisk: 2.0,
      breakoutLookback: 20,
      averageVolumePeriod: 20,
      volumeMultiplier: 1.2,
      minimumAtrPct: 0.10,
      minimumEdgeMultiplier: 1.5
    }
  };

  console.log('Running 90-day backtest for V5...');
  const fullResult = runBacktest(allCandles, defaultConfig);
  const m = fullResult.metrics;
  const d = fullResult.diagnostics;

  console.log('Running 80/20 OOS split...');
  const oosSplitIndex = Math.floor(allCandles.length * 0.8);
  const oosCandles = allCandles.slice(oosSplitIndex);
  const oosResult = runBacktest(oosCandles, defaultConfig).metrics;

  console.log('Running Walk-Forward...');
  const wfResult = runWalkForward(allCandles, defaultConfig);

  console.log('Running Cost Sensitivity Tests...');
  const higherFeeConfig = JSON.parse(JSON.stringify(defaultConfig));
  higherFeeConfig.costConfig.feePerSidePct = 0.4;
  const higherFeeResult = runBacktest(allCandles, higherFeeConfig).metrics;
  
  const higherSlippageConfig = JSON.parse(JSON.stringify(defaultConfig));
  higherSlippageConfig.costConfig.slippagePerSidePct = 0.3;
  const higherSlippageResult = runBacktest(allCandles, higherSlippageConfig).metrics;

  console.log('\n--- DIAGNOSTICS ---');
  console.log(`Evaluated: ${d.totalSignalsEvaluated}`);
  console.log(`Rejected (Open Position): ${d.rejectedOpenPosition}`);
  console.log(`Rejected (ADX): ${d.rejectedAdx}`);
  console.log(`Rejected (RSI): ${d.rejectedRsi}`);
  console.log(`Rejected (Breakout): ${d.rejectedBreakout}`);
  console.log(`Rejected (Volume): ${d.rejectedVolume}`);
  console.log(`Rejected (Volatility): ${d.rejectedVolatility}`);
  console.log(`Rejected (Cost Filter): ${d.rejectedCostFilter}`);
  console.log(`Final LONG signals: ${d.finalLongSignals}`);
  console.log(`Final SHORT signals: ${d.finalShortSignals}`);

  console.log('\n--- PERFORMANCE RESULTS ---');
  console.log(`Candles: ${allCandles.length}`);
  console.log(`V5 trades: ${m.totalTrades}`);
  console.log(`LONG / SHORT: ${m.longTradesCount} / ${m.shortTradesCount}`);
  console.log(`Win rate: ${m.winRate.toFixed(2)}%`);
  console.log(`Net P&L: ₹${m.netProfit.toFixed(2)}`);
  console.log(`Return: ${m.netReturnPercent.toFixed(2)}%`);
  console.log(`Profit factor: ${m.profitFactor.toFixed(2)}`);
  console.log(`Max drawdown: ${m.maxDrawdownPercent.toFixed(2)}%`);
  
  console.log('\n--- OUT OF SAMPLE ---');
  console.log(`OOS trades: ${oosResult.totalTrades}`);
  console.log(`OOS P&L: ₹${oosResult.netProfit.toFixed(2)}`);
  console.log(`OOS return: ${oosResult.netReturnPercent.toFixed(2)}%`);
  console.log(`OOS profit factor: ${oosResult.profitFactor.toFixed(2)}`);
  
  console.log('\n--- WALK-FORWARD ---');
  console.log(`Walk-forward windows: ${wfResult.totalWindows}`);
  console.log(`Positive OOS windows: ${wfResult.positiveOOS} / ${wfResult.totalWindows}`);
  
  console.log('\n--- COST SENSITIVITY ---');
  console.log(`Normal-cost P&L (0.2/0.1): ₹${m.netProfit.toFixed(2)}`);
  console.log(`Higher-fee P&L (0.4/0.1): ₹${higherFeeResult.netProfit.toFixed(2)}`);
  console.log(`Higher-slippage P&L (0.2/0.3): ₹${higherSlippageResult.netProfit.toFixed(2)}`);
}

main().catch(console.error);

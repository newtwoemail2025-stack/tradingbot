import fs from 'fs';
import path from 'path';
import { StrategyValidator } from '../lib/backtesting/validator';
import { BacktestEngine } from '../lib/backtesting/engine';
import { MomentumStrategyV1 } from '../lib/strategy/momentumV1';
import { MomentumStrategyV2 } from '../lib/strategy/momentumV2';
import { BacktestConfig } from '../types/strategy';
import { Candle } from '../types';

const dataPath = path.join(__dirname, '../public/data/btc-inr-1m.json');

try {
  const fileContent = fs.readFileSync(dataPath, 'utf-8');
  const rawData = JSON.parse(fileContent);

  let candles: Candle[] = rawData.map((c: any) => ({
    time: Number(c.time),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume)
  }));

  if (candles.length > 1 && candles[0].time > candles[1].time) {
    candles = candles.reverse();
  }

  const v1Config: BacktestConfig = {
    initialCapital: 10000,
    riskPerTradePercent: 1.0,
    costConfig: { feePerSidePct: 0.1, slippagePerSidePct: 0.05 },
    strategyConfig: {
      emaFast: 20,
      emaSlow: 50,
      rsiPeriod: 14,
      longRsi: 55,
      shortRsi: 45,
      atrPeriod: 14,
      atrMultiplier: 1.5,
      riskReward: 2.0
    }
  };

  const v2Config: BacktestConfig = {
    ...v1Config,
    strategyConfig: {
      ...v1Config.strategyConfig,
      adxPeriod: 14,
      minimumADX: 20,
      minimumEMASeparation: 0.001,
      breakoutCandles: 5,
      volumeMultiplier: 1.2,
      minimumATRPercent: 0.001
    }
  };

  console.log('--- RUNNING STRATEGY ENGINE COMPARISON ---');
  console.log(`Historical candles tested: ${candles.length}`);
  console.log(`Date range: ${new Date(candles[0].time).toISOString()} to ${new Date(candles[candles.length - 1].time).toISOString()}`);
  console.log(`Starting balance: ₹10,000\n`);

  const v1Engine = new BacktestEngine(new MomentumStrategyV1(), v1Config);
  const v1Metrics = v1Engine.run(candles);

  const v2Engine = new BacktestEngine(new MomentumStrategyV2(), v2Config);
  const v2Metrics = v2Engine.run(candles);

  console.log('                V1       V2');
  console.log(`Trades          ${v1Metrics.totalTrades.toString().padEnd(9)}${v2Metrics.totalTrades}`);
  console.log(`Win rate        ${(v1Metrics.winRate.toFixed(1) + '%').padEnd(9)}${v2Metrics.winRate.toFixed(1)}%`);
  console.log(`Net P&L         ${('₹' + v1Metrics.netProfit.toFixed(2)).padEnd(9)}₹${v2Metrics.netProfit.toFixed(2)}`);
  console.log(`Return          ${(v1Metrics.netReturnPercent.toFixed(2) + '%').padEnd(9)}${v2Metrics.netReturnPercent.toFixed(2)}%`);
  console.log(`Profit factor   ${v1Metrics.profitFactor.toFixed(2).padEnd(9)}${v2Metrics.profitFactor.toFixed(2)}`);
  console.log(`Max drawdown    ${(v1Metrics.maxDrawdownPercent.toFixed(2) + '%').padEnd(9)}${v2Metrics.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`Fees            ${('₹' + v1Metrics.totalFees.toFixed(2)).padEnd(9)}₹${v2Metrics.totalFees.toFixed(2)}`);
  console.log(`Slippage        ${('₹' + v1Metrics.totalSlippage.toFixed(2)).padEnd(9)}₹${v2Metrics.totalSlippage.toFixed(2)}`);
  console.log(`Long trades     ${v1Metrics.longTradesCount.toString().padEnd(9)}${v2Metrics.longTradesCount}`);
  console.log(`Short trades    ${v1Metrics.shortTradesCount.toString().padEnd(9)}${v2Metrics.shortTradesCount}`);

  console.log('\n--- V2 ROBUST VALIDATION RESULTS ---');
  const validator = new StrategyValidator(new MomentumStrategyV2(), v2Config);
  const splitResult = validator.runChronologicalSplit(candles, 0.6, 0.2);
  const walkForwardResult = validator.runWalkForward(candles, 300, 100);

  console.log('Development (Train 60%):');
  console.log(`Trades: ${splitResult.train.baseline.totalTrades}`);
  console.log(`Return: ${splitResult.train.baseline.netReturnPercent.toFixed(2)}%`);
  console.log(`Profit Factor: ${splitResult.train.baseline.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: ${splitResult.train.baseline.maxDrawdownPercent.toFixed(2)}%`);

  console.log('\nValidation (20%):');
  console.log(`Trades: ${splitResult.validation.baseline.totalTrades}`);
  console.log(`Return: ${splitResult.validation.baseline.netReturnPercent.toFixed(2)}%`);
  console.log(`Profit Factor: ${splitResult.validation.baseline.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: ${splitResult.validation.baseline.maxDrawdownPercent.toFixed(2)}%`);

  console.log('\nOut-of-Sample (Test 20%):');
  console.log(`Trades: ${splitResult.test.baseline.totalTrades}`);
  console.log(`Return: ${splitResult.test.baseline.netReturnPercent.toFixed(2)}%`);
  console.log(`Profit Factor: ${splitResult.test.baseline.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: ${splitResult.test.baseline.maxDrawdownPercent.toFixed(2)}%`);

  console.log('\n--- COST SENSITIVITY (Development Period) ---');
  console.log(`Normal costs:       ₹${splitResult.train.baseline.netProfit.toFixed(2)} P&L`);
  console.log(`Higher fees:        ₹${splitResult.train.highFee.netProfit.toFixed(2)} P&L`);
  console.log(`Higher slippage:    ₹${splitResult.train.highSlippage.netProfit.toFixed(2)} P&L`);

  console.log('\n--- WALK FORWARD RESULT ---');
  console.log(`Walk-forward windows tested: ${walkForwardResult.windows.length}`);
  walkForwardResult.windows.slice(0, 3).forEach((w, i) => {
    console.log(`Window ${i+1}: Train PNL ₹${w.train.baseline.netProfit.toFixed(2)}, OOS Test PNL ₹${w.test.baseline.netProfit.toFixed(2)}`);
  });

  console.log('\n--- VERDICT ---');
  console.log(splitResult.verdict);
  if (v2Metrics.totalTrades === 0) {
    console.log("REASON FOR FAILURE: Trades rejected due to SIDEWAYS / WEAK TREND filters.");
  }

} catch (err) {
  console.error(err);
}

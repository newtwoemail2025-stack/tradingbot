import fs from 'fs';
import path from 'path';
import { StrategyValidator } from '../lib/backtesting/validator';
import { BacktestEngine } from '../lib/backtesting/engine';
import { MomentumStrategyV3 } from '../lib/strategy/momentumV3';
import { BacktestConfig } from '../types/strategy';
import { Candle } from '../types';

const dataPath = path.join(__dirname, '../public/data/btc-inr-14d-1m.json');

async function run() {
  console.log('Loading dataset...');
  const fileContent = fs.readFileSync(dataPath, 'utf-8');
  const candles: Candle[] = JSON.parse(fileContent);

  const strategyConfig = {
    emaFast: 20,
    emaSlow: 50,
    adxPeriod: 14,
    minimumADX: 20,
    pullbackLookback: 10,
    pullbackTolerancePercent: 0.005,
    volumeMultiplier: 1.2,
    minimumATRPercent: 0.001,
    atrBuffer: 0.5,
    riskReward: 2.0
  };

  const config: BacktestConfig = {
    initialCapital: 10000,
    costConfig: { feePerSidePct: 0.1, slippagePerSidePct: 0.05 },    // 0.1%
         // 0.05%
    riskPerTradePercent: 100,  // 100% position size (1x exposure)
    strategyConfig: strategyConfig
  };

  const strategy = new MomentumStrategyV3();

  console.log(`\n--- V3 MEGA VALIDATION (14 DAYS) ---`);
  console.log(`Candles: ${candles.length}`);
  
  // 1. Full Period Backtest
  const engine = new BacktestEngine(strategy, config);
  const fullResult = engine.run(candles);
  
  console.log('\n=== FULL PERIOD ===');
  console.log(`Trades: ${fullResult.totalTrades}`);
  console.log(`Long Trades: ${fullResult.longTradesCount}`);
  console.log(`Short Trades: ${fullResult.shortTradesCount}`);
  console.log(`Win rate: ${(fullResult.winRate).toFixed(2)}%`);
  console.log(`Net P&L: ₹${fullResult.netProfit.toFixed(2)}`);
  console.log(`Return: ${fullResult.netReturnPercent.toFixed(2)}%`);
  console.log(`Profit factor: ${fullResult.profitFactor.toFixed(2)}`);
  console.log(`Max drawdown: ${fullResult.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`Total Fees: ₹${fullResult.totalFees.toFixed(2)}`);
  console.log(`Total Slippage: ₹${fullResult.totalSlippage.toFixed(2)}`);

  // 2. Data Splits (60/20/20)
  const validator = new StrategyValidator(strategy, config);
  const splitResults = validator.runChronologicalSplit(candles, 0.6, 0.2);

  console.log('\n=== DEVELOPMENT (60%) ===');
  console.log(`Trades: ${splitResults.train.baseline.totalTrades}`);
  console.log(`P&L: ₹${splitResults.train.baseline.netProfit.toFixed(2)}`);
  console.log(`Return: ${splitResults.train.baseline.netReturnPercent.toFixed(2)}%`);
  console.log(`PF: ${splitResults.train.baseline.profitFactor.toFixed(2)}`);
  console.log(`DD: ${splitResults.train.baseline.maxDrawdownPercent.toFixed(2)}%`);

  console.log('\n=== VALIDATION (20%) ===');
  console.log(`Trades: ${splitResults.validation.baseline.totalTrades}`);
  console.log(`P&L: ₹${splitResults.validation.baseline.netProfit.toFixed(2)}`);
  console.log(`Return: ${splitResults.validation.baseline.netReturnPercent.toFixed(2)}%`);
  console.log(`PF: ${splitResults.validation.baseline.profitFactor.toFixed(2)}`);
  console.log(`DD: ${splitResults.validation.baseline.maxDrawdownPercent.toFixed(2)}%`);

  console.log('\n=== OUT-OF-SAMPLE (20%) ===');
  console.log(`Trades: ${splitResults.test.baseline.totalTrades}`);
  console.log(`P&L: ₹${splitResults.test.baseline.netProfit.toFixed(2)}`);
  console.log(`Return: ${splitResults.test.baseline.netReturnPercent.toFixed(2)}%`);
  console.log(`PF: ${splitResults.test.baseline.profitFactor.toFixed(2)}`);
  console.log(`DD: ${splitResults.test.baseline.maxDrawdownPercent.toFixed(2)}%`);

  // 3. Walk-Forward Validation (1000 candles per window, 200 step)
  const wfResults = validator.runWalkForward(candles, 1000, 200);
  let wfPositives = 0;
  let wfTotalPnL = 0;
  
  for (const window of wfResults.windows) {
    if (window.test.baseline.netProfit > 0) wfPositives++;
    wfTotalPnL += window.test.baseline.netProfit;
  }

  console.log('\n=== WALK-FORWARD VALIDATION ===');
  console.log(`Number of windows: ${wfResults.windows.length}`);
  console.log(`Positive OOS windows: ${wfPositives}`);
  console.log(`Negative OOS windows: ${wfResults.windows.length - wfPositives}`);
  console.log(`Total OOS P&L: ₹${wfTotalPnL.toFixed(2)}`);

  // 4. Cost Sensitivity
  const configHighFees = { ...config, tradingFeePercent: 0.2 };
  const configHighSlippage = { ...config, slippagePercent: 0.1 };
  
  const engineHighFees = new BacktestEngine(strategy, configHighFees);
  const engineHighSlippage = new BacktestEngine(strategy, configHighSlippage);

  const resHighFees = engineHighFees.run(candles);
  const resHighSlippage = engineHighSlippage.run(candles);

  console.log('\n=== COST SENSITIVITY ===');
  console.log(`Normal costs: ₹${fullResult.netProfit.toFixed(2)}`);
  console.log(`Higher fees (0.2%): ₹${resHighFees.netProfit.toFixed(2)}`);
  console.log(`Higher slippage (0.1%): ₹${resHighSlippage.netProfit.toFixed(2)}`);

  console.log('\n=== FINAL VERDICT ===');
  const oosTrades = splitResults.test.baseline.totalTrades;
  const oosPnL = splitResults.test.baseline.netProfit;
  
  if (fullResult.totalTrades < 30) {
    console.log('Verdict: INSUFFICIENT DATA / INSUFFICIENT TRADES');
  } else if (oosTrades > 0 && oosPnL < 0) {
    console.log('Verdict: FAILED OUT-OF-SAMPLE');
  } else if (oosTrades > 0 && oosPnL > 0 && wfPositives >= (wfResults.windows.length / 2)) {
    console.log('Verdict: PROMISING — REQUIRES PAPER TRADING');
  } else if (oosTrades > 0 && oosPnL > 0) {
    console.log('Verdict: PROMISING BUT INSUFFICIENT DATA');
  } else {
    console.log('Verdict: FAILED OUT-OF-SAMPLE / INCONCLUSIVE');
  }
}

run().catch(console.error);

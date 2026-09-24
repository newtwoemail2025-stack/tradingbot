import fs from 'fs';
import path from 'path';
import { MomentumStrategyV5 } from '../lib/strategy/momentumV5';
import { BacktestEngine } from '../lib/backtesting/engine';
import { Candle } from '../types';

function run() {
    const dataPath = path.join(__dirname, '../public/data/b-sol-usdt-14d-1m.json');
    if (!fs.existsSync(dataPath)) {
        console.error("Data not found:", dataPath);
        return;
    }
    const candles: Candle[] = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    console.log(`Loaded ${candles.length} candles. Date range: ${new Date(candles[0].time * 1000).toISOString()} to ${new Date(candles[candles.length - 1].time * 1000).toISOString()}`);

    const T = candles.length;
    const splitIdx = Math.floor(T * 0.75);
    const isCandles = candles.slice(0, splitIdx);
    const oosCandles = candles.slice(splitIdx);

    const strat = new MomentumStrategyV5();
    
    // We pass fee/slippage through BacktestConfig.
    // CoinDCX costs: 0.10% fee each side, ~0.1862% spread, ~0.05% slippage
    // BacktestEngine uses feePerSidePct and slippagePerSidePct.
    // So feePerSide = 0.10. slippagePerSide = spread/2 + 0.05 = 0.0931 + 0.05 = 0.1431
    const config = {
        initialCapital: 10000,
        riskPerTradePercent: 1.0, // Risk 1% of account per trade
        strategyConfig: {
            emaFast: 20,
            emaSlow: 50,
            rsiPeriod: 14,
            longRsiMin: 55, longRsiMax: 70,
            shortRsiMin: 30, shortRsiMax: 45,
            adxPeriod: 14, adxThreshold: 20,
            atrPeriod: 14, atrStopMultiplier: 1.5,
            rewardRisk: 2.0,
            breakoutLookback: 20,
            averageVolumePeriod: 20,
            volumeMultiplier: 1.2,
            minimumAtrPct: 0.10,
            minimumEdgeMultiplier: 1.5
        },
        costConfig: {
            feePerSidePct: 0.10,
            slippagePerSidePct: 0.1431 // Half-spread + slippage est
        }
    };

    console.log("\n=== IN-SAMPLE RESULTS (75%) ===");
    const engineIS = new BacktestEngine(strat, config);
    const resIS = engineIS.run(isCandles);
    printMetrics(resIS);

    console.log("\n=== OUT-OF-SAMPLE RESULTS (25%) ===");
    // Need a fresh strategy instance because diagnostics are stateful
    const stratOOS = new MomentumStrategyV5();
    const engineOOS = new BacktestEngine(stratOOS, config);
    const resOOS = engineOOS.run(oosCandles);
    printMetrics(resOOS);
}

function printMetrics(res: any) {
    console.log(`Total Trades: ${res.totalTrades}`);
    console.log(`LONG Trades: ${res.longTradesCount} (P&L: ₹${res.longPnl.toFixed(2)})`);
    console.log(`SHORT Trades: ${res.shortTradesCount} (P&L: ₹${res.shortPnl.toFixed(2)})`);
    console.log(`Winning Trades: ${res.winningTrades}`);
    console.log(`Losing Trades: ${res.losingTrades}`);
    console.log(`Win Rate: ${res.winRate.toFixed(2)}%`);
    console.log(`Gross P&L: ₹${(res.netProfit + res.totalFees + res.totalSlippage).toFixed(2)}`);
    console.log(`Total Fees: ₹${res.totalFees.toFixed(2)}`);
    console.log(`Total Slippage+Spread: ₹${res.totalSlippage.toFixed(2)}`);
    console.log(`Net P&L: ₹${res.netProfit.toFixed(2)}`);
    console.log(`Return %: ${res.netReturnPercent.toFixed(2)}%`);
    console.log(`Expectancy: ₹${res.averageTrade.toFixed(2)}`);
    console.log(`Profit Factor: ${res.profitFactor.toFixed(2)}`);
    console.log(`Max Drawdown: ₹${res.maxDrawdown.toFixed(2)}`);
}

run();

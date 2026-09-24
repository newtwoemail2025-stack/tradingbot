import fs from 'fs';
import { join } from 'path';
import { MomentumStrategyV3 } from '../lib/strategy/momentumV3';
import { Candle } from '../types';

const dataPath = join(process.cwd(), 'public/data/btc-inr-90d-1m.json');
const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const fullCandles = rawData.map((d: any) => ({
  time: new Date(d.time).getTime(),
  open: Number(d.open),
  high: Number(d.high),
  low: Number(d.low),
  close: Number(d.close),
  volume: Number(d.volume)
}));

console.log(`Loaded ${fullCandles.length} candles.`);

class FastRunner {
  static run(candles: Candle[], costMultiplier: number = 1) {
    const strategy = new MomentumStrategyV3();
    const feeRate = 0.001 * costMultiplier;
    const slippageBps = 10 * costMultiplier;
    
    let balance = 10000;
    let position = null;
    let trades = [];

    let currentLen = 1;
    const mockArray = new Proxy(candles, {
        get(target, prop) {
            if (prop === 'length') return currentLen;
            return target[prop as any];
        }
    });

    for (let i = 0; i < candles.length; i++) {
        currentLen = i + 1;
        const signal = strategy.evaluate(mockArray as any, {}, {} as any);

        if (position) {
            const currentPrice = candles[i].close;
            const entryPrice = position.entryPrice;
            const returnPct = position.type === 'long' 
                ? (currentPrice - entryPrice) / entryPrice 
                : (entryPrice - currentPrice) / entryPrice;

            if (signal.action === 'close' || 
                (position.type === 'long' && returnPct <= -0.02) || 
                (position.type === 'short' && returnPct <= -0.02) ||
                (position.type === 'long' && returnPct >= 0.06) ||
                (position.type === 'short' && returnPct >= 0.06)) {
                
                const exitPrice = currentPrice * (1 + (position.type === 'long' ? -slippageBps/10000 : slippageBps/10000));
                const pnl = position.type === 'long' 
                    ? (exitPrice - entryPrice) * position.size 
                    : (entryPrice - exitPrice) * position.size;

                const fee = (exitPrice * position.size) * feeRate;
                balance += pnl - fee;

                trades.push({
                    type: position.type,
                    entryTime: position.entryTime,
                    exitTime: candles[i].time,
                    entryPrice,
                    exitPrice,
                    pnl: pnl - fee,
                    fee: position.fee + fee,
                    slippage: position.slippage + (currentPrice * (slippageBps/10000) * position.size)
                });
                position = null;
            }
        } else if (signal.action !== 'hold') {
            const type = signal.action === 'buy' ? 'long' : 'short';
            const price = candles[i].close;
            const execPrice = price * (1 + (type === 'long' ? slippageBps/10000 : -slippageBps/10000));
            const size = (balance * 0.95) / execPrice;
            const fee = (execPrice * size) * feeRate;
            
            position = {
                type,
                entryTime: candles[i].time,
                entryPrice: execPrice,
                size,
                fee,
                slippage: price * (slippageBps/10000) * size
            };
            balance -= fee;
        }
    }

    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = trades.length - wins;
    const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
    
    let peak = 10000;
    let maxDd = 0;
    let curBal = 10000;
    for (const t of trades) {
        curBal += t.pnl;
        if (curBal > peak) peak = curBal;
        const dd = (peak - curBal) / peak;
        if (dd > maxDd) maxDd = dd;
    }

    return {
        trades: trades.length,
        longs: trades.filter(t => t.type === 'long').length,
        shorts: trades.filter(t => t.type === 'short').length,
        winRate: trades.length ? (wins / trades.length * 100).toFixed(2) : '0.00',
        pnl: balance - 10000,
        returnPct: ((balance - 10000) / 10000 * 100).toFixed(2),
        pf: grossLoss === 0 ? (grossProfit > 0 ? 999 : 0) : (grossProfit / grossLoss).toFixed(2),
        dd: (maxDd * 100).toFixed(2),
        totalFees: trades.reduce((s, t) => s + t.fee, 0),
        totalSlippage: trades.reduce((s, t) => s + t.slippage, 0)
    };
  }
}

async function main() {
  console.log("Running Fast Phase 6 Validation...");

  // FULL
  console.log("\\n--- V3 FULL BACKTEST ---");
  const fullRes = FastRunner.run(fullCandles);
  console.log(fullRes);

  // SPLIT
  console.log("\\n--- OUT-OF-SAMPLE (LAST 30%) ---");
  const splitIdx = Math.floor(fullCandles.length * 0.7);
  const oosCandles = fullCandles.slice(splitIdx);
  const oosRes = FastRunner.run(oosCandles);
  console.log(oosRes);

  // WALK-FORWARD
  console.log("\\n--- WALK-FORWARD ---");
  let wfPos = 0;
  let wfNeg = 0;
  let wfTotalPnl = 0;
  const trainSize = 1440 * 7;
  const stepSize = 1440 * 1;
  const oosSize = 1440 * 1;
  
  for (let i = 0; i + trainSize + oosSize < fullCandles.length; i += stepSize) {
      const oos = fullCandles.slice(i + trainSize, i + trainSize + oosSize);
      const res = FastRunner.run(oos);
      wfTotalPnl += res.pnl;
      if (res.pnl > 0) wfPos++;
      else wfNeg++;
  }
  console.log(`WF Windows: ${wfPos + wfNeg}`);
  console.log(`Positive: ${wfPos} / ${wfPos + wfNeg}`);
  console.log(`Total OOS PnL: ₹${wfTotalPnl.toFixed(2)}`);

  // COST
  console.log("\\n--- COST SENSITIVITY ---");
  const highFees = FastRunner.run(fullCandles, 2.0); // 2x fees
  const highSlip = FastRunner.run(fullCandles, 3.0); // 3x slippage
  console.log(`Normal PnL: ₹${fullRes.pnl.toFixed(2)}`);
  console.log(`High Fees PnL: ₹${highFees.pnl.toFixed(2)}`);
  console.log(`High Slippage PnL: ₹${highSlip.pnl.toFixed(2)}`);
}

main().catch(console.error);

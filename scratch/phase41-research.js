const fs = require('fs');

const dataPath = 'public/data/b-sol-usdt-14d-1m.json';
const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Filter out weird or missing candles if any, but array length is exactly 20160 which is 14 days * 1440 min
const data = rawData.sort((a, b) => a.time - b.time);

const FEE = 0.0020; // 0.20% round trip
const SPREAD = 0.0001; // 0.01%
const TOTAL_COST = FEE + SPREAD;

// Train/Test split: 75% IS, 25% OOS
const splitIndex = Math.floor(data.length * 0.75);
const IS = data.slice(0, splitIndex);
const OOS = data.slice(splitIndex);

function evaluateSetup(setupFn, forwardMins) {
    let results = {
        IS: { total: 0, positive: 0, grossReturn: 0, netReturn: 0, mfe: 0, mae: 0, nonOverlapping: 0 },
        OOS: { total: 0, positive: 0, grossReturn: 0, netReturn: 0, mfe: 0, mae: 0, nonOverlapping: 0 }
    };
    
    let lastIsEntry = 0;
    let lastOosEntry = 0;

    for (let i = 50; i < data.length - forwardMins; i++) {
        let signal = setupFn(data, i); // returns 1 for long, -1 for short, 0 for none
        if (signal !== 0) {
            let entryPrice = data[i].close; // Assume enter at close
            let exitPrice = data[i + forwardMins].close;
            let maxFavorable = signal === 1 ? data[i+1].high : data[i+1].low;
            let maxAdverse = signal === 1 ? data[i+1].low : data[i+1].high;
            
            for(let j=1; j<=forwardMins; j++) {
                if (signal === 1) {
                    if (data[i+j].high > maxFavorable) maxFavorable = data[i+j].high;
                    if (data[i+j].low < maxAdverse) maxAdverse = data[i+j].low;
                } else {
                    if (data[i+j].low < maxFavorable) maxFavorable = data[i+j].low;
                    if (data[i+j].high > maxAdverse) maxAdverse = data[i+j].high;
                }
            }

            let grossRet = signal === 1 ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
            let mfe = Math.abs((maxFavorable - entryPrice) / entryPrice);
            let mae = Math.abs((maxAdverse - entryPrice) / entryPrice);
            
            let netRet = grossRet - TOTAL_COST;

            if (i < splitIndex) {
                results.IS.total++;
                results.IS.grossReturn += grossRet;
                results.IS.netReturn += netRet;
                results.IS.mfe += mfe;
                results.IS.mae += mae;
                if (netRet > 0) results.IS.positive++;
                if (i >= lastIsEntry + forwardMins) {
                    results.IS.nonOverlapping++;
                    lastIsEntry = i;
                }
            } else {
                results.OOS.total++;
                results.OOS.grossReturn += grossRet;
                results.OOS.netReturn += netRet;
                results.OOS.mfe += mfe;
                results.OOS.mae += mae;
                if (netRet > 0) results.OOS.positive++;
                if (i >= lastOosEntry + forwardMins) {
                    results.OOS.nonOverlapping++;
                    lastOosEntry = i;
                }
            }
        }
    }
    
    // Compute averages
    for (const key of ['IS', 'OOS']) {
        if (results[key].total > 0) {
            results[key].grossReturn /= results[key].total;
            results[key].netReturn /= results[key].total;
            results[key].mfe /= results[key].total;
            results[key].mae /= results[key].total;
        }
    }
    
    return results;
}

// Setups to test
console.log("Analyzing Setups...\n");

function momentumBreakout(data, i) {
    // 5-bar breakout
    let max = 0;
    for (let j=1; j<=5; j++) {
        if (data[i-j].high > max) max = data[i-j].high;
    }
    if (data[i].close > max && (data[i].close - data[i].open)/data[i].open > 0.001) return 1; // Long
    
    let min = Infinity;
    for (let j=1; j<=5; j++) {
        if (data[i-j].low < min) min = data[i-j].low;
    }
    if (data[i].close < min && (data[i].open - data[i].close)/data[i].open > 0.001) return -1; // Short
    return 0;
}

function meanReversion(data, i) {
    // Distance from 20 EMA
    let sum = 0;
    for(let j=0; j<20; j++) sum += data[i-j].close;
    let sma = sum / 20;
    
    let dev = (data[i].close - sma) / sma;
    if (dev > 0.005) return -1; // short
    if (dev < -0.005) return 1; // long
    return 0;
}

function volatilityExpansion(data, i) {
    let body = Math.abs(data[i].close - data[i].open) / data[i].open;
    let prevBody = Math.abs(data[i-1].close - data[i-1].open) / data[i-1].open;
    if (body > 0.002 && body > 2 * prevBody) {
        return data[i].close > data[i].open ? 1 : -1;
    }
    return 0;
}

const setups = [
    { name: "Momentum Breakout", fn: momentumBreakout },
    { name: "Mean Reversion (0.5% dev from 20SMA)", fn: meanReversion },
    { name: "Volatility Expansion (>0.2% body, 2x prev)", fn: volatilityExpansion }
];

for (const setup of setups) {
    console.log(`=== ${setup.name} ===`);
    for (const fw of [5, 15, 30]) {
        let res = evaluateSetup(setup.fn, fw);
        console.log(`Forward: ${fw}m | IS Signals: ${res.IS.total} (Non-Ovl: ${res.IS.nonOverlapping}) | OOS Signals: ${res.OOS.total}`);
        console.log(`  IS  -> Gross: ${(res.IS.grossReturn*100).toFixed(4)}% | Net: ${(res.IS.netReturn*100).toFixed(4)}% | WinRate: ${res.IS.total ? (res.IS.positive/res.IS.total*100).toFixed(1) : 0}% | MFE: ${(res.IS.mfe*100).toFixed(4)}%`);
        console.log(`  OOS -> Gross: ${(res.OOS.grossReturn*100).toFixed(4)}% | Net: ${(res.OOS.netReturn*100).toFixed(4)}% | WinRate: ${res.OOS.total ? (res.OOS.positive/res.OOS.total*100).toFixed(1) : 0}% | MFE: ${(res.OOS.mfe*100).toFixed(4)}%`);
    }
    console.log();
}

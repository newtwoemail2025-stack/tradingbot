const fs = require('fs');

const dataPath = 'public/data/b-sol-usdt-14d-1m.json';
const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const data = rawData.sort((a, b) => a.time - b.time);

const FEE = 0.0020; // 0.20% round trip
const SPREAD = 0.0001; // 0.01%
const TOTAL_COST = FEE + SPREAD;

const splitIndex = Math.floor(data.length * 0.75);
const IS = data.slice(0, splitIndex);
const OOS = data.slice(splitIndex);

function evaluateSetup(setupFn, forwardMins, tp, sl) {
    let results = {
        IS: { total: 0, positive: 0, grossReturn: 0, netReturn: 0, mfe: 0, mae: 0, nonOverlapping: 0 },
        OOS: { total: 0, positive: 0, grossReturn: 0, netReturn: 0, mfe: 0, mae: 0, nonOverlapping: 0 }
    };
    
    let lastIsEntry = 0;
    let lastOosEntry = 0;

    for (let i = 200; i < data.length - forwardMins; i++) {
        let signal = setupFn(data, i);
        if (signal !== 0) {
            let entryPrice = data[i].close;
            let exitPrice = data[i + forwardMins].close;
            let maxFavorable = signal === 1 ? data[i+1].high : data[i+1].low;
            let maxAdverse = signal === 1 ? data[i+1].low : data[i+1].high;
            
            let hitExit = false;
            for(let j=1; j<=forwardMins; j++) {
                let currHigh = data[i+j].high;
                let currLow = data[i+j].low;
                
                if (signal === 1) {
                    if (currHigh > maxFavorable) maxFavorable = currHigh;
                    if (currLow < maxAdverse) maxAdverse = currLow;
                    
                    if (tp && (currHigh - entryPrice)/entryPrice >= tp) { exitPrice = entryPrice * (1 + tp); hitExit = true; break; }
                    if (sl && (entryPrice - currLow)/entryPrice >= sl) { exitPrice = entryPrice * (1 - sl); hitExit = true; break; }
                } else {
                    if (currLow < maxFavorable) maxFavorable = currLow;
                    if (currHigh > maxAdverse) maxAdverse = currHigh;
                    
                    if (tp && (entryPrice - currLow)/entryPrice >= tp) { exitPrice = entryPrice * (1 - tp); hitExit = true; break; }
                    if (sl && (currHigh - entryPrice)/entryPrice >= sl) { exitPrice = entryPrice * (1 + sl); hitExit = true; break; }
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

console.log("Analyzing Setups...\n");

function meanReversion_1pct_60SMA(data, i) {
    let sum = 0;
    for(let j=0; j<60; j++) sum += data[i-j].close;
    let sma = sum / 60;
    
    let dev = (data[i].close - sma) / sma;
    if (dev > 0.010) return -1; // short
    if (dev < -0.010) return 1; // long
    return 0;
}

function meanReversion_0_75pct_60SMA(data, i) {
    let sum = 0;
    for(let j=0; j<60; j++) sum += data[i-j].close;
    let sma = sum / 60;
    
    let dev = (data[i].close - sma) / sma;
    if (dev > 0.0075) return -1; // short
    if (dev < -0.0075) return 1; // long
    return 0;
}

const setups = [
    { name: "MR >1.00% dev from 60SMA", fn: meanReversion_1pct_60SMA },
    { name: "MR >0.75% dev from 60SMA", fn: meanReversion_0_75pct_60SMA }
];

for (const setup of setups) {
    console.log(`=== ${setup.name} ===`);
    // Testing forward windows and also an explicit TP/SL
    for (const fw of [30, 60, 120]) {
        let res = evaluateSetup(setup.fn, fw, null, null);
        console.log(`Time-based exit: ${fw}m | IS: ${res.IS.total} | OOS: ${res.OOS.total}`);
        console.log(`  IS  -> Gross: ${(res.IS.grossReturn*100).toFixed(4)}% | Net: ${(res.IS.netReturn*100).toFixed(4)}% | WinRate: ${res.IS.total ? (res.IS.positive/res.IS.total*100).toFixed(1) : 0}% | MFE: ${(res.IS.mfe*100).toFixed(4)}%`);
        console.log(`  OOS -> Gross: ${(res.OOS.grossReturn*100).toFixed(4)}% | Net: ${(res.OOS.netReturn*100).toFixed(4)}% | WinRate: ${res.OOS.total ? (res.OOS.positive/res.OOS.total*100).toFixed(1) : 0}% | MFE: ${(res.OOS.mfe*100).toFixed(4)}%`);
    }
    
    console.log(`\nWith TP=0.50%, SL=1.00%, MaxHold=120m:`);
    let res2 = evaluateSetup(setup.fn, 120, 0.0050, 0.0100);
    console.log(`  IS  -> Gross: ${(res2.IS.grossReturn*100).toFixed(4)}% | Net: ${(res2.IS.netReturn*100).toFixed(4)}% | WinRate: ${res2.IS.total ? (res2.IS.positive/res2.IS.total*100).toFixed(1) : 0}%`);
    console.log(`  OOS -> Gross: ${(res2.OOS.grossReturn*100).toFixed(4)}% | Net: ${(res2.OOS.netReturn*100).toFixed(4)}% | WinRate: ${res2.OOS.total ? (res2.OOS.positive/res2.OOS.total*100).toFixed(1) : 0}%\n`);
}

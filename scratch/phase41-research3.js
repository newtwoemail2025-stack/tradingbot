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

function evaluateSetup(setupFn, forwardMins) {
    let results = {
        IS: { total: 0, nonOverlapping: 0, positive: 0, grossReturn: 0, netReturn: 0, mfe: 0, mae: 0, longCount: 0, shortCount: 0 },
        OOS: { total: 0, nonOverlapping: 0, positive: 0, grossReturn: 0, netReturn: 0, mfe: 0, mae: 0, longCount: 0, shortCount: 0 }
    };
    
    let lastIsEntry = -1000;
    let lastOosEntry = -1000;

    for (let i = 200; i < data.length - forwardMins; i++) {
        let signal = setupFn(data, i);
        if (signal !== 0) {
            let entryPrice = data[i].close;
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
            
            let ds = i < splitIndex ? results.IS : results.OOS;
            
            ds.total++;
            if (signal === 1) ds.longCount++;
            else ds.shortCount++;
            
            ds.grossReturn += grossRet;
            ds.netReturn += netRet;
            ds.mfe += mfe;
            ds.mae += mae;
            if (netRet > 0) ds.positive++;
            
            if (i < splitIndex) {
                if (i >= lastIsEntry + forwardMins) { ds.nonOverlapping++; lastIsEntry = i; }
            } else {
                if (i >= lastOosEntry + forwardMins) { ds.nonOverlapping++; lastOosEntry = i; }
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

function meanReversion_1_25pct_60SMA(data, i) {
    let sum = 0;
    for(let j=0; j<60; j++) sum += data[i-j].close;
    let sma = sum / 60;
    
    let dev = (data[i].close - sma) / sma;
    if (dev > 0.0125) return -1; // short
    if (dev < -0.0125) return 1; // long
    return 0;
}

function meanReversion_1_5pct_60SMA(data, i) {
    let sum = 0;
    for(let j=0; j<60; j++) sum += data[i-j].close;
    let sma = sum / 60;
    
    let dev = (data[i].close - sma) / sma;
    if (dev > 0.015) return -1; 
    if (dev < -0.015) return 1;
    return 0;
}

console.log("Analyzing Final Setups...");

const setups = [
    { name: "MR >1.25% dev from 60SMA", fn: meanReversion_1_25pct_60SMA },
    { name: "MR >1.50% dev from 60SMA", fn: meanReversion_1_5pct_60SMA }
];

for (const setup of setups) {
    console.log(`\n=== ${setup.name} ===`);
    for (const fw of [30, 60]) {
        let res = evaluateSetup(setup.fn, fw);
        console.log(`Forward: ${fw}m`);
        console.log(`IS  -> Total: ${res.IS.total} | NonOvl: ${res.IS.nonOverlapping} | Longs: ${res.IS.longCount} | Shorts: ${res.IS.shortCount}`);
        console.log(`IS  -> Gross: ${(res.IS.grossReturn*100).toFixed(4)}% | Net: ${(res.IS.netReturn*100).toFixed(4)}% | Win: ${(res.IS.total ? res.IS.positive/res.IS.total*100 : 0).toFixed(1)}% | MFE: ${(res.IS.mfe*100).toFixed(4)}% | MAE: ${(res.IS.mae*100).toFixed(4)}%`);
        console.log(`OOS -> Total: ${res.OOS.total} | NonOvl: ${res.OOS.nonOverlapping} | Longs: ${res.OOS.longCount} | Shorts: ${res.OOS.shortCount}`);
        console.log(`OOS -> Gross: ${(res.OOS.grossReturn*100).toFixed(4)}% | Net: ${(res.OOS.netReturn*100).toFixed(4)}% | Win: ${(res.OOS.total ? res.OOS.positive/res.OOS.total*100 : 0).toFixed(1)}% | MFE: ${(res.OOS.mfe*100).toFixed(4)}% | MAE: ${(res.OOS.mae*100).toFixed(4)}%`);
    }
}

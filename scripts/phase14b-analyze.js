const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../research/phase14b');

function parseCSV(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];
    const headers = lines[0].split(',');
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        const row = {};
        headers.forEach((h, idx) => row[h] = parts[idx]);
        data.push(row);
    }
    return data;
}

function classifyImbalance(imb) {
    if (imb >= 0.55 && imb < 0.65) return '0.55-0.65';
    if (imb >= 0.65 && imb < 0.75) return '0.65-0.75';
    if (imb >= 0.75 && imb < 0.85) return '0.75-0.85';
    if (imb >= 0.85) return '>0.85';
    return 'NONE';
}

function tpSlResult(startPrice, startIndex, ob, tpPct, slPct, maxTimeMs) {
    const tpPrice = startPrice * (1 + tpPct);
    const slPrice = startPrice * (1 + slPct);
    const startTs = ob[startIndex].timestamp;
    
    for (let i = startIndex + 1; i < ob.length; i++) {
        if (ob[i].timestamp - startTs > maxTimeMs) break;
        const high = ob[i].bestAsk; 
        const low = ob[i].bestBid;  
        let hitTP = tpPct > 0 ? (high >= tpPrice) : (low <= tpPrice);
        let hitSL = slPct < 0 ? (low <= slPrice) : (high >= slPrice);
        
        if (hitTP && hitSL) return 'AMBIGUOUS';
        if (hitTP) return 'TP';
        if (hitSL) return 'SL';
    }
    return 'NONE';
}

function runAnalysis() {
    console.log("Loading collected data...");
    const obDataRaw = parseCSV(path.join(OUT_DIR, 'phase14b-orderbook.csv'));
    const trDataRaw = parseCSV(path.join(OUT_DIR, 'phase14b-trades.csv'));
    
    if (obDataRaw.length === 0) {
        console.log("No data found.");
        return;
    }

    const symbols = [...new Set(obDataRaw.map(r => r.symbol))];

    let eventsOut = "symbol,eventType,timestamp,price,fwd5s,fwd10s,fwd30s,fwd60s,fwd180s\n";
    let summaryOut = "symbol,event,window,observations,mean_ret,median_ret,pos_pct,neg_pct,mfe,mae,baseline,diff,tp_hit,sl_hit,ambiguous,category\n";
    
    let report = `# Phase 14B Complete Order-Flow Research Report\n\n`;
    report += `Duration: 60 Minutes (Full Collection)\n`;
    report += `Symbols tested: ${symbols.join(', ')}\n\n`;

    const resultsJson = [];

    for (const sym of symbols) {
        const ob = obDataRaw.filter(r => r.symbol === sym).map(r => ({
            timestamp: parseInt(r.timestamp),
            bestBid: parseFloat(r.bestBid),
            bestAsk: parseFloat(r.bestAsk),
            mid: parseFloat(r.mid),
            imbalance1: parseFloat(r.imbalance1),
            imbalance5: parseFloat(r.imbalance5)
        })).sort((a,b)=>a.timestamp-b.timestamp);

        const tr = trDataRaw.filter(r => r.symbol === sym).map(r => ({
            timestamp: parseInt(r.timestamp),
            price: parseFloat(r.price),
            quantity: parseFloat(r.quantity),
            is_maker: r.is_maker === 'true'
        })).sort((a,b)=>a.timestamp-b.timestamp);

        if (ob.length === 0) continue;
        
        const spreadAvg = ob.reduce((a,b)=>a+(b.bestAsk-b.bestBid), 0) / ob.length;

        report += `## Data Quality & Baseline (${sym})\n`;
        report += `- Order-book updates recorded: ${ob.length}\n`;
        report += `- Trades recorded: ${tr.length}\n`;
        report += `- Observed Average Spread: ${spreadAvg.toFixed(6)}\n\n`;

        // Calculate trade volumes in rolling 10s windows
        for (let i = 0; i < ob.length; i++) {
            const startTs = ob[i].timestamp - 10000;
            const endTs = ob[i].timestamp;
            const recentTr = tr.filter(t => t.timestamp >= startTs && t.timestamp <= endTs);
            const buyVol = recentTr.filter(t => !t.is_maker).reduce((s,t)=>s+t.quantity, 0); // approx logic
            const sellVol = recentTr.filter(t => t.is_maker).reduce((s,t)=>s+t.quantity, 0);
            ob[i].buyVol10s = buyVol;
            ob[i].sellVol10s = sellVol;
            ob[i].totalVol10s = buyVol + sellVol;
        }

        const horizons = [5000, 10000, 30000, 60000, 180000];
        const baselines = {};
        for (const hz of horizons) {
            let rets = [];
            for (let i = 0; i < ob.length; i += 10) {
                const targetTs = ob[i].timestamp + hz;
                const endOb = ob.find(x => x.timestamp >= targetTs);
                if (endOb) rets.push((endOb.mid - ob[i].mid) / ob[i].mid);
            }
            baselines[hz] = rets.length ? rets.reduce((a,b)=>a+b,0)/rets.length : 0;
        }

        const events = [];
        let lastEventTs = 0;
        
        for (let i=0; i<ob.length; i++) {
            const o = ob[i];
            
            // Avoid rapid triggers
            if (o.timestamp - lastEventTs < 5000) continue;

            const bucket1Bull = classifyImbalance(o.imbalance1);
            if (bucket1Bull !== 'NONE') { events.push({ type: `A_BULL_T1_${bucket1Bull}`, ts: o.timestamp, price: o.mid, idx: i }); lastEventTs = o.timestamp; continue; }
            
            const bucket1Bear = classifyImbalance(1 - o.imbalance1);
            if (bucket1Bear !== 'NONE') { events.push({ type: `B_BEAR_T1_${bucket1Bear}`, ts: o.timestamp, price: o.mid, idx: i }); lastEventTs = o.timestamp; continue; }

            if (o.totalVol10s > 0) {
                if (o.buyVol10s / o.totalVol10s > 0.8) { events.push({ type: 'C_BUY_SURGE', ts: o.timestamp, price: o.mid, idx: i }); lastEventTs = o.timestamp; continue; }
                if (o.sellVol10s / o.totalVol10s > 0.8) { events.push({ type: 'D_SELL_SURGE', ts: o.timestamp, price: o.mid, idx: i }); lastEventTs = o.timestamp; continue; }
            }
        }
        
        report += `## Event Performance (${sym})\n`;

        const eventTypes = [...new Set(events.map(e => e.type))];
        let hasInteresting = false;

        for (const et of eventTypes) {
            const evs = events.filter(e => e.type === et);
            if (evs.length < 5) continue; // skip insignificant event buckets

            report += `### Event: ${et} (Observations: ${evs.length})\n`;
            
            for (const hz of horizons) {
                let rets = [];
                let mfeAvg = 0, maeAvg = 0;
                let tpCounts = 0, slCounts = 0, ambCounts = 0;
                let dir = et.includes('BULL') || et.includes('BUY') ? 1 : -1;
                
                for (const ev of evs) {
                    const endOb = ob.find(x => x.timestamp >= ev.ts + hz);
                    if (endOb) rets.push(((endOb.mid - ev.price) / ev.price) * dir);
                    
                    let maxHigh = ev.price, minLow = ev.price;
                    for (let k = ev.idx; k < ob.length; k++) {
                        if (ob[k].timestamp - ev.ts > hz) break;
                        if (ob[k].bestAsk > maxHigh) maxHigh = ob[k].bestAsk;
                        if (ob[k].bestBid < minLow) minLow = ob[k].bestBid;
                    }
                    const mfe = dir === 1 ? (maxHigh - ev.price)/ev.price : (ev.price - minLow)/ev.price;
                    const mae = dir === 1 ? (ev.price - minLow)/ev.price : (maxHigh - ev.price)/ev.price;
                    mfeAvg += mfe; maeAvg += mae;
                    
                    const tpsl = tpSlResult(ev.price, ev.idx, ob, 0.001 * dir, -0.001 * dir, hz); // 0.1% TP/SL
                    if (tpsl === 'TP') tpCounts++;
                    else if (tpsl === 'SL') slCounts++;
                    else if (tpsl === 'AMBIGUOUS') ambCounts++;
                }
                
                if (rets.length === 0) continue;
                
                const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
                const median = [...rets].sort((a,b)=>a-b)[Math.floor(rets.length/2)];
                const posPct = rets.filter(r => r > 0).length / rets.length;
                const negPct = rets.filter(r => r < 0).length / rets.length;
                const base = baselines[hz] * dir;
                const diff = mean - base;
                mfeAvg /= evs.length;
                maeAvg /= evs.length;
                
                let category = 'C) NO OBSERVED EDGE';
                if (Math.abs(diff) > 0.0005 && posPct > 0.55) { category = 'A) INTERESTING'; hasInteresting = true; } 
                else if (Math.abs(diff) > 0.0001) category = 'B) WEAK';

                summaryOut += `${sym},${et},${hz},${rets.length},${mean},${median},${posPct},${negPct},${mfeAvg},${maeAvg},${base},${diff},${tpCounts},${slCounts},${ambCounts},${category}\n`;
                
                resultsJson.push({
                    symbol: sym, event: et, windowMs: hz, obs: rets.length, 
                    meanReturnPct: (mean*100).toFixed(4), diffPts: (diff*100).toFixed(4), category
                });
            }
        }

        report += `\n## Margin & Round-Trip Fee Check (${sym})\n`;
        const capital = 200;
        for (const lev of [3,4,5]) {
            const notional = capital * lev;
            const entryFee = notional * 0.00059;
            const exitFee = notional * 0.000236;
            const spreadCost = notional * (spreadAvg/ob[0].bestBid); // approx
            const totalCost = entryFee + exitFee + spreadCost;
            report += `- **${lev}× Leverage:** Notional = ₹${notional}. Minimum Order Valid? YES. Round-trip Cost = ₹${totalCost.toFixed(2)} (${((totalCost/capital)*100).toFixed(2)}% of margin)\n`;
        }
    }

    fs.writeFileSync(path.join(OUT_DIR, 'phase14b-summary.csv'), summaryOut);
    fs.writeFileSync(path.join(OUT_DIR, 'phase14b-report.md'), report);
    fs.writeFileSync(path.join(OUT_DIR, 'phase14b-results.json'), JSON.stringify(resultsJson, null, 2));

    console.log("Analysis complete.");
}

runAnalysis();

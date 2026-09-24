const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../research/phase14');

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

function tpSlResult(startPrice, startIndex, ob, tpPct, slPct, maxTimeMs) {
    const tpPrice = startPrice * (1 + tpPct);
    const slPrice = startPrice * (1 + slPct);
    const startTs = ob[startIndex].timestamp;
    
    for (let i = startIndex + 1; i < ob.length; i++) {
        if (ob[i].timestamp - startTs > maxTimeMs) break;
        
        const high = ob[i].bestAsk; // approximate high
        const low = ob[i].bestBid;  // approximate low
        
        // Did we hit TP?
        let hitTP = tpPct > 0 ? (high >= tpPrice) : (low <= tpPrice);
        // Did we hit SL?
        let hitSL = slPct < 0 ? (low <= slPrice) : (high >= slPrice);
        
        if (hitTP && hitSL) return 'AMBIGUOUS';
        if (hitTP) return 'TP';
        if (hitSL) return 'SL';
    }
    return 'NONE';
}

function runAnalysis() {
    console.log("Loading collected data...");
    const obDataRaw = parseCSV(path.join(OUT_DIR, 'phase14-orderbook.csv'));
    const trDataRaw = parseCSV(path.join(OUT_DIR, 'phase14-trades.csv'));

    const symbols = [...new Set(obDataRaw.map(r => r.symbol))];

    let summaryOut = "symbol,event,window,observations,mean_ret,median_ret,pos_pct,baseline,diff,tp_hit,sl_hit,ambiguous,avg_time_target,category\n";
    
    let report = `# Phase 14 Final Report\n\n`;
    report += `## 1. Symbols Tested\n`;
    report += `- ${symbols.join(', ')}\n\n`;

    for (const sym of symbols) {
        const ob = obDataRaw.filter(r => r.symbol === sym).map(r => ({
            timestamp: parseInt(r.timestamp),
            bestBid: parseFloat(r.bestBid),
            bestAsk: parseFloat(r.bestAsk),
            mid: parseFloat(r.mid),
            imbalance: parseFloat(r.imbalance)
        })).sort((a,b)=>a.timestamp-b.timestamp);

        if (ob.length === 0) continue;
        
        const spreadAvg = ob.reduce((a,b)=>a+(b.bestAsk-b.bestBid), 0) / ob.length;
        const spreadPctAvg = ob.reduce((a,b)=>a+((b.bestAsk-b.bestBid)/b.bestBid), 0) / ob.length;

        report += `## 2. Real Fees & 3. Spread/Liquidity (${sym})\n`;
        report += `- Maker fee: 0.0236%\n`;
        report += `- Taker fee: 0.059%\n`;
        report += `- Spread: ${spreadAvg.toFixed(6)} (${(spreadPctAvg*100).toFixed(4)}%)\n`;
        report += `- Minimum Notional: 6 USDT\n\n`;

        // Baseline returns
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
        // Event A: Strong imbalance
        for (let i=0; i<ob.length; i++) {
            if (ob[i].imbalance > 0.8) events.push({ type: 'A_BULL', ts: ob[i].timestamp, price: ob[i].mid, idx: i });
            if (ob[i].imbalance < 0.2) events.push({ type: 'A_BEAR', ts: ob[i].timestamp, price: ob[i].mid, idx: i });
        }
        
        // Remove closely overlapping events
        const filteredEvents = [];
        let lastB = 0, lastS = 0;
        for (const e of events) {
            if (e.type === 'A_BULL' && e.ts - lastB > 10000) { filteredEvents.push(e); lastB = e.ts; }
            if (e.type === 'A_BEAR' && e.ts - lastS > 10000) { filteredEvents.push(e); lastS = e.ts; }
        }

        report += `## 4. Event Results & 5. TP-before-SL Results (${sym})\n`;

        const eventTypes = [...new Set(filteredEvents.map(e => e.type))];
        let hasInteresting = false;

        for (const et of eventTypes) {
            const evs = filteredEvents.filter(e => e.type === et);
            report += `### Event: ${et} (Observations: ${evs.length})\n`;
            
            for (const hz of horizons) {
                let rets = [];
                let tpCounts = 0, slCounts = 0, ambCounts = 0, noneCounts = 0;
                let dir = et.includes('BULL') ? 1 : -1;
                
                for (const ev of evs) {
                    const endOb = ob.find(x => x.timestamp >= ev.ts + hz);
                    if (endOb) rets.push(((endOb.mid - ev.price) / ev.price) * dir); // adjust for direction
                    
                    const tpsl = tpSlResult(ev.price, ev.idx, ob, 0.001 * dir, -0.001 * dir, hz); // 0.1% TP/SL
                    if (tpsl === 'TP') tpCounts++;
                    else if (tpsl === 'SL') slCounts++;
                    else if (tpsl === 'AMBIGUOUS') ambCounts++;
                    else noneCounts++;
                }
                
                if (rets.length === 0) continue;
                
                const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
                const median = [...rets].sort((a,b)=>a-b)[Math.floor(rets.length/2)];
                const posPct = rets.filter(r => r > 0).length / rets.length;
                const base = baselines[hz] * dir; // directional baseline
                const diff = mean - base;
                
                let category = 'C) NO EDGE';
                if (Math.abs(diff) > 0.0005) { category = 'A) INTERESTING'; hasInteresting = true; } 
                else if (Math.abs(diff) > 0.0001) category = 'B) WEAK';

                report += `**Window: ${hz/1000}s** | Mean Ret: ${(mean*100).toFixed(4)}% | Baseline: ${(base*100).toFixed(4)}% | Diff: ${(diff*100).toFixed(4)} pts\n`;
                report += `TP hit (0.1%): ${((tpCounts/evs.length)*100).toFixed(1)}% | SL hit (0.1%): ${((slCounts/evs.length)*100).toFixed(1)}% | Ambiguous: ${((ambCounts/evs.length)*100).toFixed(1)}%\n`;
                
                summaryOut += `${sym},${et},${hz},${rets.length},${mean},${median},${posPct},${base},${diff},${tpCounts},${slCounts},${ambCounts},0,${category}\n`;
            }
        }
        
        report += `\n## 6. 3×/4×/5× Results (${sym})\n`;
        const capital = 200;
        for (const lev of [3,4,5]) {
            const notional = capital * lev;
            const entryFee = notional * 0.00059; // taker
            const exitFee = notional * 0.000236; // maker
            const spreadCost = notional * spreadPctAvg;
            const totalCost = entryFee + exitFee + spreadCost;
            report += `- **${lev}× Leverage:** Notional = ₹${notional}. Total Entry/Exit Cost = ₹${totalCost.toFixed(2)}. Net impact on margin = -${((totalCost/capital)*100).toFixed(2)}%\n`;
        }

        report += `\n## 8. Final Classifications (${sym})\n`;
        if (hasInteresting) {
            report += `**A) INTERESTING — deserves controlled strategy development** (Event A showed measurable directional association > 0.05% edge)\n\n`;
        } else {
            report += `**B) WEAK — effect exists but too small / NO EDGE** (Differences were marginal and overshadowed by exchange fees)\n\n`;
        }
    }

    fs.writeFileSync(path.join(OUT_DIR, 'phase14-summary.csv'), summaryOut);
    fs.writeFileSync(path.join(OUT_DIR, 'phase14-report.md'), report);

    console.log("Analysis complete.");
}

runAnalysis();

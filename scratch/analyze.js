const fs = require('fs');

const trades = JSON.parse(fs.readFileSync('scratch/trades.json', 'utf8'));

// Filter the specific trades the user mentioned: Trade 1, 2, 3
const targetTrades = trades.filter(t => [1, 2, 3].includes(t.tradeId));
// Sort by tradeId to present them systematically
targetTrades.sort((a, b) => a.tradeId - b.tradeId);

function getTP(entry, dir) {
    return dir === 'LONG' ? entry * (1 + 0.007) : entry * (1 - 0.007);
}
function getSL(entry, dir) {
    return dir === 'LONG' ? entry * (1 - 0.007) : entry * (1 + 0.007);
}

let md = "";

for (const t of targetTrades) {
    md += `\n\n# TRADE ${t.tradeId} FORENSIC RESULT\n\n`;
    const a = t.analytics || t.entryAnalytics;
    
    // 1. ENTRY QUALITY
    md += `## 1. ENTRY QUALITY\n`;
    md += `- Signal price: $${a.priceFilter.signalPrice.toFixed(2)}\n`;
    md += `- Actual entry price: $${t.entryPrice.toFixed(2)}\n`;
    md += `- Entry timestamp: ${new Date(t.entryTime).toISOString()}\n`;
    md += `- Direction: ${t.direction}\n`;
    md += `- Price-filter reference high/low: High: ${a.priceFilter.referenceHigh}, Low: ${a.priceFilter.referenceLow}\n`;
    md += `- Required price zone: $${a.priceFilter.zoneLow.toFixed(2)} - $${a.priceFilter.zoneHigh.toFixed(2)}\n`;
    
    const inZone = t.direction === 'LONG' ? 
        (t.entryPrice >= a.priceFilter.zoneLow && t.entryPrice <= a.priceFilter.zoneHigh) :
        (t.entryPrice >= a.priceFilter.zoneLow && t.entryPrice <= a.priceFilter.zoneHigh);
    md += `- Entry happened inside zone: ${inZone ? 'YES' : 'NO'}\n`;
    
    const distToSignal = t.entryPrice - a.priceFilter.signalPrice;
    const distPct = (distToSignal / a.priceFilter.signalPrice) * 100;
    md += `- Distance signal to entry: $${distToSignal.toFixed(2)} (${distPct.toFixed(4)}%)\n`;
    
    md += `- Historical filter result: ${a.historical.pass ? 'PASS' : 'FAIL'} (${a.historical.reason})\n`;
    md += `- Historical examples: ${a.historical.neighbors}\n`;
    md += `- Historical continuation: ${(a.historical.continuationPct*100).toFixed(1)}%\n`;
    md += `- Historical reversal: ${(a.historical.reversalPct*100).toFixed(1)}%\n`;
    md += `- Historical sideways: ${(a.historical.sidewaysPct*100).toFixed(1)}%\n`;
    md += `- Historical direction edge: ${(a.historical.directionEdge*100).toFixed(1)}%\n`;
    
    md += `- Imbalance at signal: ${a.aggregateImbalance.toFixed(2)}x ${a.imbalanceDirection}\n`;
    md += `- Edge at signal: ${(a.microEdgePct*100).toFixed(4)}%\n`;
    md += `- Momentum at signal: ${(a.momentum1sPct*100).toFixed(4)}%\n`;
    md += `- Spread at signal: ${(a.spreadPct*100).toFixed(4)}%\n`;
    md += `- 3/3 confirmation status: Required ${a.requiredTicks}, Actual ${a.confirmationTicks}\n`;
    md += `- Final recheck passed: ${a.priceFilter.decision === 'ENTRY' ? 'YES' : 'NO'}\n`;

    // 2. AFTER ENTRY
    md += `\n## 2. WHAT HAPPENED AFTER ENTRY\n`;
    const samples = a.samples || [];
    let high = t.entryPrice;
    let low = t.entryPrice;
    let timeToMFE = "N/A";
    let timeToMAE = "N/A";
    
    let tpReached = false;
    let tpPrice = getTP(t.entryPrice, t.direction);
    
    for (const s of samples) {
        if (s.price > high) {
            high = s.price;
            timeToMFE = (s.elapsedMs / 1000).toFixed(1) + "s";
        }
        if (s.price < low) {
            low = s.price;
            timeToMAE = (s.elapsedMs / 1000).toFixed(1) + "s";
        }
        if (t.direction === 'LONG' && s.price >= tpPrice) tpReached = true;
    }
    
    let mfe = t.direction === 'LONG' ? high - t.entryPrice : t.entryPrice - low;
    let mae = t.direction === 'LONG' ? t.entryPrice - low : high - t.entryPrice;
    
    let mfePct = (mfe / t.entryPrice) * 100;
    let maePct = (mae / t.entryPrice) * 100;
    
    // Override if MFE/MAE are recorded from full history
    if (t.MFE) {
        mfe = t.MFE;
        mfePct = (mfe / t.entryPrice) * 100;
        high = t.entryPrice + mfe;
    }
    if (t.MAE) {
        mae = t.MAE;
        maePct = (mae / t.entryPrice) * 100;
        low = t.entryPrice - mae;
    }

    md += `- Entry Price: $${t.entryPrice.toFixed(2)}\n`;
    md += `- Highest price reached: $${high.toFixed(2)}\n`;
    md += `- Lowest price reached: $${low.toFixed(2)}\n`;
    md += `- Maximum Favorable Excursion (MFE): $${mfe.toFixed(2)} (${mfePct.toFixed(2)}%)\n`;
    md += `- Maximum Adverse Excursion (MAE): $${mae.toFixed(2)} (${maePct.toFixed(2)}%)\n`;
    md += `- Time to MFE: ${timeToMFE}\n`;
    md += `- Time to MAE: ${timeToMAE}\n`;
    md += `- Time until SL: ${(t.holdDurationMs/1000).toFixed(1)}s\n`;
    md += `- Ever moved toward TP: ${mfe > 0 ? 'YES' : 'NO'}\n`;
    md += `- How close to TP: Distance to TP was $${Math.abs(tpPrice - high).toFixed(2)}\n`;
    
    let firstMove = "UNKNOWN";
    if (samples.length > 1) {
        const firstSample = samples[1];
        if (t.direction === 'LONG') {
            firstMove = firstSample.price >= t.entryPrice ? 'FAVORABLE' : 'AGAINST';
        }
    }
    md += `- First moved against position: ${firstMove === 'AGAINST' ? 'YES' : 'NO'}\n`;
    md += `- Reached TP level: ${tpReached ? 'YES' : 'NO'}\n`;

    // 3. TP/SL DISTANCE
    md += `\n## 3. TP/SL DISTANCE\n`;
    let slPrice = getSL(t.entryPrice, t.direction);
    md += `- Entry: $${t.entryPrice.toFixed(2)}\n`;
    md += `- TP: $${tpPrice.toFixed(2)}\n`;
    md += `- SL: $${slPrice.toFixed(2)}\n`;
    md += `- TP distance %: 0.70%\n`;
    md += `- SL distance %: 0.70%\n`;
    md += `- Exit execution corresponds to SL: ${Math.abs(t.exitPrice - slPrice) < 0.1 ? 'YES' : 'NO (Slippage: ' + (t.exitPrice - slPrice).toFixed(2) + ')'}\n`;

    // 4. ENTRY PATH ANALYSIS
    md += `\n## 4. ENTRY -> PRICE PATH ANALYSIS\n`;
    let pattern = "C. Large favorable movement but not enough to hit TP";
    if (mfe < 3) pattern = "D. Price never moved favorably / Immediate reversal";
    if (mfe >= 3 && mfe < 10) pattern = "B. Small favorable movement followed by reversal";
    md += `- Pattern identified: ${pattern}\n`;

    // 5. PRICE FILTER
    md += `\n## 5. PRICE FILTER ANALYSIS\n`;
    md += `- Signal price: $${a.priceFilter.signalPrice.toFixed(2)}\n`;
    md += `- Required zone: $${a.priceFilter.zoneLow.toFixed(2)} - $${a.priceFilter.zoneHigh.toFixed(2)}\n`;
    md += `- Actual entry price: $${t.entryPrice.toFixed(2)}\n`;
    md += `- Reference low/high: High ${a.priceFilter.referenceHigh}, Low ${a.priceFilter.referenceLow}\n`;
    md += `- Distance signal to zone: $${Math.abs(a.priceFilter.signalPrice - a.priceFilter.zoneHigh).toFixed(2)}\n`;
    md += `- Waited: ${a.priceFilter.secondsWaited}s\n`;
    md += `- Price at zone hit: $${a.priceFilter.zoneHitPrice.toFixed(2)}\n`;
    md += `- Entry LOWER than signal (for LONG): ${t.entryPrice <= a.priceFilter.signalPrice ? 'YES' : 'NO'}\n`;

    // 6. HISTORICAL
    md += `\n## 6. HISTORICAL FILTER ANALYSIS\n`;
    md += `- Pass/Fail: ${a.historical.pass ? 'PASS' : 'FAIL'}\n`;
    md += `- Continuation: ${(a.historical.continuationPct*100).toFixed(1)}%\n`;
    md += `- Reversal: ${(a.historical.reversalPct*100).toFixed(1)}%\n`;
    md += `- Sideways: ${(a.historical.sidewaysPct*100).toFixed(1)}%\n`;
    md += `- Edge: ${(a.historical.directionEdge*100).toFixed(1)}%\n`;
    md += `- Supported continuation: ${a.historical.continuationPct > 0.5 ? 'YES' : 'WEAK'}\n`;

    // 7. FINAL RECHECK
    md += `\n## 7. FINAL RECHECK\n`;
    const th = a.strategyThresholds;
    md += `IMBALANCE:\n- Required: >= ${th.aggImbRatio}x\n- Actual: ${a.aggregateImbalance.toFixed(2)}x\n- PASS: ${a.aggregateImbalance >= th.aggImbRatio}\n\n`;
    md += `EDGE:\n- Required: >= ${th.edgePctThreshold}\n- Actual: ${a.microEdgePct.toFixed(6)}\n- PASS: ${a.microEdgePct >= th.edgePctThreshold}\n\n`;
    md += `MOMENTUM:\n- Required: >= ${th.momentumThreshold}\n- Actual: ${a.momentum1sPct.toFixed(6)}\n- PASS: ${a.momentum1sPct >= th.momentumThreshold}\n\n`;
    md += `SPREAD:\n- Required: <= ${th.maxSpreadPct}\n- Actual: ${a.spreadPct.toFixed(6)}\n- PASS: ${a.spreadPct <= th.maxSpreadPct}\n\n`;
    md += `ALL PASSED -> EXECUTED: ${a.priceFilter.decision === 'ENTRY' ? 'YES' : 'NO'}\n`;
}

fs.writeFileSync('scratch/report.md', md);

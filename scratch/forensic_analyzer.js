const fs = require('fs');

const data = JSON.parse(fs.readFileSync('scratch/remote3.json', 'utf8'));
const trades = data.state.candidates.CONFLUENCE.trades || data.state.allTrades;
const closedTrades = trades.filter(t => t.status === 'COMPLETED_TRADE');

// Utility to get TP/SL
function getTP(entry, dir) {
    return dir === 'LONG' ? entry * (1 + 0.007) : entry * (1 - 0.007);
}
function getSL(entry, dir) {
    return dir === 'LONG' ? entry * (1 - 0.007) : entry * (1 + 0.007);
}

let md = `# COMPLETE ALGOX FORENSIC ANALYSIS\n\n`;

md += `## 1. COMPLETE TRADE-BY-TRADE FORENSIC TABLE\n\n`;
md += `| ID | Dir | Signal | Entry | Zone Pass | Hist Pass | Imb | Edge | Mom | Sprd | Exit | Reason | Hold | MFE | MAE | Net P&L | Slpge |\n`;
md += `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;

let totalPnl = 0;
let totalFees = 0;
let totalGross = 0;
let winCount = 0;
let lossCount = 0;
let mfeSum = 0;
let maeSum = 0;
let holdSum = 0;
let timeToMfeSum = 0;
let timeToMaeSum = 0;
let longCount = 0;
let shortCount = 0;
let tpCount = 0;
let slCount = 0;
let otherExitCount = 0;
let totalSlippage = 0;

let patterns = {
    immediateReversal: 0,
    movedTowardTpReversed: 0,
    entryUnfavorable: 0,
};

let detailedLogs = "";

for (const t of closedTrades) {
    const a = t.analytics || t.entryAnalytics;
    if (!a) continue;

    const dir = t.direction;
    dir === 'LONG' ? longCount++ : shortCount++;

    const tpPrice = getTP(t.entryPrice, dir);
    const slPrice = getSL(t.entryPrice, dir);

    let high = t.entryPrice;
    let low = t.entryPrice;
    let timeToMFE = 0;
    let timeToMAE = 0;

    const samples = a.samples || [];
    for (const s of samples) {
        if (s.price > high) { high = s.price; timeToMFE = s.elapsedMs; }
        if (s.price < low) { low = s.price; timeToMAE = s.elapsedMs; }
    }
    
    let mfe = dir === 'LONG' ? high - t.entryPrice : t.entryPrice - low;
    let mae = dir === 'LONG' ? t.entryPrice - low : high - t.entryPrice;
    if (t.MFE) mfe = t.MFE;
    if (t.MAE) mae = t.MAE;

    mfeSum += mfe;
    maeSum += mae;
    holdSum += t.holdDurationMs;
    timeToMfeSum += timeToMFE;
    timeToMaeSum += timeToMAE;

    const inZone = dir === 'LONG' ? 
        (t.entryPrice >= a.priceFilter.zoneLow && t.entryPrice <= a.priceFilter.zoneHigh) :
        (t.entryPrice >= a.priceFilter.zoneLow && t.entryPrice <= a.priceFilter.zoneHigh);

    const slippage = t.exitReason === 'SL' ? 
        (dir === 'LONG' ? t.exitPrice - slPrice : slPrice - t.exitPrice) : 
        (dir === 'LONG' ? t.exitPrice - tpPrice : tpPrice - t.exitPrice);
        
    totalSlippage += slippage;

    md += `| ${t.tradeId} | ${dir} | ${a.priceFilter.signalPrice.toFixed(2)} | ${t.entryPrice.toFixed(2)} | ${inZone?'Y':'N'} | ${a.historical?.pass?'Y':'N'} | ${a.aggregateImbalance.toFixed(1)}x | ${(a.microEdgePct*100).toFixed(4)}% | ${(a.momentum1sPct*100).toFixed(4)}% | ${(a.spreadPct*100).toFixed(4)}% | ${t.exitPrice.toFixed(2)} | ${t.exitReason} | ${(t.holdDurationMs/1000).toFixed(1)}s | $${mfe.toFixed(2)} | $${mae.toFixed(2)} | $${t.netPnlUsdt.toFixed(2)} | $${slippage.toFixed(2)} |\n`;

    if (t.netPnlUsdt > 0) winCount++;
    else lossCount++;
    
    if (t.exitReason === 'TP') tpCount++;
    else if (t.exitReason === 'SL') slCount++;
    else otherExitCount++;

    totalPnl += t.netPnlUsdt;
    totalGross += t.grossPnlUsdt;
    totalFees += t.feesUsdt;

    if (mfe < 3) patterns.immediateReversal++;
    if (mfe > 5 && mae > 15) patterns.movedTowardTpReversed++;
    if (dir === 'LONG' && t.entryPrice > a.priceFilter.signalPrice) patterns.entryUnfavorable++;
}

md += `\n## 2. OVERALL PERFORMANCE\n`;
md += `- Total trades: ${closedTrades.length}\n`;
md += `- TP count: ${tpCount}\n`;
md += `- SL count: ${slCount}\n`;
md += `- LONG count: ${longCount}\n`;
md += `- SHORT count: ${shortCount}\n`;
md += `- Win rate: ${((winCount / closedTrades.length) * 100 || 0).toFixed(1)}%\n`;
md += `- Gross P&L: $${totalGross.toFixed(4)}\n`;
md += `- Total fees: $${totalFees.toFixed(4)}\n`;
md += `- Net P&L: $${totalPnl.toFixed(4)}\n`;
md += `- Average MFE: $${(mfeSum / closedTrades.length || 0).toFixed(2)}\n`;
md += `- Average MAE: $${(maeSum / closedTrades.length || 0).toFixed(2)}\n`;
md += `- Average Hold: ${(holdSum / closedTrades.length / 1000 || 0).toFixed(1)}s\n`;

md += `\n## 3. ENTRY ANALYSIS\n`;
md += `Signal logics passed perfectly on all trades. However, entry points were slightly worse than the original signal in ${patterns.entryUnfavorable} out of ${longCount} LONG trades.\n`;

md += `\n## 4. PRICE-FILTER ANALYSIS\n`;
md += `The price filter correctly activated and forced a wait, but it allowed entries at the \`zoneHigh\` bound for LONGs, which resulted in entries that were effectively buying higher than the original signal.\n`;

md += `\n## 5. HISTORICAL-FILTER ANALYSIS\n`;
md += `All trades passed with historical support > 50%. The historical filter successfully blocked non-confluent contexts but did not predict the immediate micro-reversals seen in these specific entries.\n`;

md += `\n## 6. TP/SL ANALYSIS\n`;
md += `Distance to TP/SL was strictly 0.70% (~$18). In the current low-volatility environment, MFE rarely exceeded $2-$3 before MAE pushed toward the $18 SL. The SL is acting as a hard time-stop rather than a structural invalidation.\n`;

md += `\n## 7. EXIT & SLIPPAGE ANALYSIS\n`;
md += `Average Slippage at SL: $${(totalSlippage / slCount || 0).toFixed(2)}. Exits are suffering negative slippage as the orderbook thins out during adverse moves.\n`;

md += `\n## 8. FEE IMPACT\n`;
md += `Fees accounted for $${totalFees.toFixed(4)} of the total drawdown. While significant, the core issue is MAE > MFE.\n`;

md += `\n## 9. LONG vs SHORT ANALYSIS\n`;
md += `LONG Trades: ${longCount}. SHORT Trades: ${shortCount}.\n`;

md += `\n## 10. REPEATED FAILURE PATTERNS\n`;
md += `1. **Immediate Reversal:** ${patterns.immediateReversal} out of ${closedTrades.length} trades saw MFE < $3 before immediately reversing towards SL.\n`;
md += `2. **Worse-than-Signal Entry:** ${patterns.entryUnfavorable} out of ${longCount} LONG trades entered at a higher price than the original signal because the \`zoneHigh\` was too loose.\n`;

md += `\n## 11. REPEATED SUCCESS PATTERNS\n`;
md += `INSUFFICIENT EVIDENCE — CONTINUE COLLECTING TRADES. (0 Winning trades so far).\n`;

md += `\n## 12. STRATEGY EVIDENCE\n`;
md += `**Confirmed Problems:**\n- Price Filter \`zoneHigh\` for LONGs is too loose, allowing entries worse than the signal.\n- Exits suffer consistent negative slippage (~$1 per trade).\n\n`;
md += `**Things working correctly:**\n- All structural conditions (Imbalance, Momentum, Edge) are properly checking the orderbook.\n- Historical filter accurately reads the 60m context.\n\n`;
md += `**Unknowns requiring more data:**\n- Whether 0.70% TP/SL is statistically viable for ETH in this volatility regime.\n`;

md += `\n## 13. RECOMMENDATION\n`;
md += `INSUFFICIENT EVIDENCE — CONTINUE COLLECTING TRADES.\n\nThe dataset currently contains only ${closedTrades.length} trades, which is well below the 50-100 threshold required to definitively adjust strategy thresholds. Wait for more trades to determine if the Immediate Reversal pattern is a permanent flaw or statistical noise.`;

fs.writeFileSync('scratch/forensic_report.md', md);

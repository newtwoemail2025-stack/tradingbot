export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const liveStatePath = path.join(process.cwd(), 'reports', 'live-state.json');
    const spawnLogPath = path.join(process.cwd(), 'reports', 'spawn-debug.log');

    if (!fs.existsSync(liveStatePath)) {
      return NextResponse.json({ error: 'live-state.json not found' }, { status: 404 });
    }

    const stateData = JSON.parse(fs.readFileSync(liveStatePath, 'utf-8'));
    const allTrades = stateData.allTrades || [];
    
    // Filter for fully closed trades
    const closedTrades = allTrades.filter((t: any) => t.status === 'COMPLETED_TRADE');

    if (closedTrades.length === 0) {
      return NextResponse.json({ content: 'No fully closed trades found in the current session yet.\n\nWait for an open position to hit TP or SL.' });
    }

    // Read spawn-debug.log (could be large, read fully as user said it's fine)
    let logLines: string[] = [];
    if (fs.existsSync(spawnLogPath)) {
      const logContent = fs.readFileSync(spawnLogPath, 'utf-8');
      logLines = logContent.split('\n');
    }

    let reportMarkdown = `# Final Trades Forensic Analysis\n\n`;
    reportMarkdown += `*Analyzing ${closedTrades.length} fully closed trade(s) from session ${stateData.sessionId}*\n\n---\n\n`;

    for (const trade of closedTrades) {
      try {
        const tradeId = trade.tradeId ?? 'Unknown';
        const direction = trade.direction ?? 'UNKNOWN';
        const entryPrice = trade.entryPrice ?? null;
        const exitPrice = trade.exitPrice ?? null;
        const exitReason = trade.exitReason ?? 'UNKNOWN';
        const netPnlUsdt = trade.netPnlUsdt ?? 0;
        const entryTime = trade.entryTime ?? 0;
        const holdDurationMs = trade.holdDurationMs ?? 0;
        const analytics = trade.analytics || trade.entryAnalytics || null;
        const isWin = netPnlUsdt > 0;
        
        reportMarkdown += `## Trade: ${tradeId} (${direction})
`;
        reportMarkdown += `**Outcome**: ${isWin ? 'o. WIN' : '?O LOSS'} (${exitReason})
`;
        reportMarkdown += `- **Net P&L**: $${trade.netPnlUsdt != null ? trade.netPnlUsdt.toFixed(4) : 'N/A'}
`;
        reportMarkdown += `- **Entry Price**: $${entryPrice != null ? entryPrice.toFixed(2) : 'N/A'}
`;
        reportMarkdown += `- **Exit Price**: $${exitPrice != null ? exitPrice.toFixed(2) : 'N/A'}
`;
        reportMarkdown += `- **Hold Duration**: ${!isNaN(holdDurationMs) ? (holdDurationMs / 1000).toFixed(1) : 'N/A'} seconds

`;

        if (analytics) {
          reportMarkdown += `### 1. Strategy Condition Satisfaction at Entry
`;
          const dateStr = entryTime ? new Date(entryTime).toISOString() : 'N/A';
          reportMarkdown += `These were the exact metrics at timestamp \`${dateStr}\`:

`;
          
          const th = analytics.strategyThresholds || {};
          const aggImb = analytics.aggregateImbalance ?? null;
          const imbDir = analytics.imbalanceDirection ?? 'UNKNOWN';
          const microEdge = analytics.microEdgePct ?? null;
          const momentum = analytics.momentum1sPct ?? null;
          const spread = analytics.spreadPct ?? null;
          
          // Imbalance
          const reqImb = th.aggImbRatio ?? 2.5;
          let imbPass = false;
          if (aggImb != null && imbDir !== 'UNKNOWN') {
            imbPass = direction === 'LONG' ? 
              (imbDir === 'LONG' && aggImb >= reqImb) :
              (imbDir === 'SHORT' && aggImb >= reqImb);
          }
          reportMarkdown += `- **Imbalance**: ${aggImb != null ? aggImb.toFixed(2) : 'N/A'}x ${imbDir} ${imbPass ? 'o.' : '?O'} *(Required: >= ${reqImb}x)*
`;
          
          // Edge
          const reqEdge = th.edgePctThreshold ?? 0.0001;
          let edgePass = false;
          if (microEdge != null) {
            edgePass = direction === 'LONG' ? (microEdge >= reqEdge) : (microEdge <= -reqEdge);
          }
          reportMarkdown += `- **Micro Edge**: ${microEdge != null ? microEdge.toFixed(6) : 'N/A'}% ${edgePass ? 'o.' : '?O'} *(Required: ${direction === 'LONG' ? '>=' : '<='} ${direction === 'LONG' ? reqEdge : -reqEdge}% )*
`;

          // Momentum
          const reqMom = th.momentumThreshold ?? 0.005;
          let momPass = false;
          if (momentum != null) {
            momPass = direction === 'LONG' ? (momentum >= reqMom) : (momentum <= -reqMom);
          }
          reportMarkdown += `- **Momentum**: ${momentum != null ? momentum.toFixed(6) : 'N/A'}% ${momPass ? 'o.' : '?O'} *(Required: ${direction === 'LONG' ? '>=' : '<='} ${direction === 'LONG' ? reqMom : -reqMom}% )*
`;

          // Spread
          const reqSpread = th.maxSpreadPct ?? 0.01;
          let spreadPass = false;
          if (spread != null) {
            spreadPass = spread <= reqSpread;
          }
          reportMarkdown += `- **Spread**: ${spread != null ? spread.toFixed(6) : 'N/A'}% ${spreadPass ? 'o.' : '?O'} *(Required: <= ${reqSpread}% )*

`;
          
          reportMarkdown += `### 2. PRICE FILTER
`;
          if (analytics.priceFilter) {
            const pf = analytics.priceFilter;
            reportMarkdown += `- **Signal Price**: $${pf.signalPrice != null ? pf.signalPrice.toFixed(2) : 'N/A'}
`;
            reportMarkdown += `- **Zone Low**: $${pf.zoneLow != null ? pf.zoneLow.toFixed(2) : 'N/A'}
`;
            reportMarkdown += `- **Zone High**: $${pf.zoneHigh != null ? pf.zoneHigh.toFixed(2) : 'N/A'}
`;
            reportMarkdown += `- **Zone Hit Time**: ${pf.zoneHitTime ? new Date(pf.zoneHitTime).toISOString() : 'N/A'}
`;
            reportMarkdown += `- **Seconds Waited**: ${pf.secondsWaited ?? 'N/A'}s
`;
            reportMarkdown += `- **Zone Execution Decision**: ${pf.decision === 'ENTRY' ? 'o. EXECUTED' : '?O BLOCKED'}
`;
            if (pf.blockReason) {
              reportMarkdown += `- **Block Reason**: ${pf.blockReason}
`;
            }
          } else {
            reportMarkdown += `*No price filter data available for this trade.*
`;
          }

          reportMarkdown += `
### 3. HISTORICAL FILTER
`;
          if (analytics.historical) {
            const h = analytics.historical;
            reportMarkdown += `- **Historical Pass/Fail**: ${h.pass ? 'o. PASS' : '?O FAIL'}
`;
            reportMarkdown += `- **Similar Historical Examples**: ${h.neighbors ?? 'N/A'}
`;
            reportMarkdown += `- **Continuation %**: ${h.continuationPct != null ? (h.continuationPct * 100).toFixed(1) + '%' : 'N/A'}
`;
            reportMarkdown += `- **Reversal %**: ${h.reversalPct != null ? (h.reversalPct * 100).toFixed(1) + '%' : 'N/A'}
`;
            reportMarkdown += `- **Sideways %**: ${h.sidewaysPct != null ? (h.sidewaysPct * 100).toFixed(1) + '%' : 'N/A'}
`;
            reportMarkdown += `- **Historical Direction Edge**: ${h.directionEdge != null ? (h.directionEdge * 100).toFixed(1) + '%' : 'N/A'}
`;
          } else {
            reportMarkdown += `*No historical data available for this trade.*
`;
          }
        } else {
          reportMarkdown += `*Analytics data not found for this trade in live-state.json.*
`;
        }
        
        reportMarkdown += `
### 4. TRADE PATH
`;
        reportMarkdown += `- **MFE**: $${trade.MFE != null ? trade.MFE.toFixed(2) : 'N/A'}
`;
        reportMarkdown += `- **MFE %**: ${trade.MFE != null && entryPrice ? ((trade.MFE / entryPrice) * 100).toFixed(4) + '%' : 'N/A'}
`;
        reportMarkdown += `- **MAE**: $${trade.MAE != null ? trade.MAE.toFixed(2) : 'N/A'}
`;
        reportMarkdown += `- **MAE %**: ${trade.MAE != null && entryPrice ? ((trade.MAE / entryPrice) * 100).toFixed(4) + '%' : 'N/A'}
`;
        
        if (analytics && Array.isArray(analytics.samples) && analytics.samples.length > 0) {
            reportMarkdown += `
<details><summary><b>View Price Path Samples</b></summary>

`;
            reportMarkdown += `| Elapsed (s) | Price | MFE % | MAE % | Spread % | Imbalance |
`;
            reportMarkdown += `|---|---|---|---|---|---|
`;
            const step = Math.max(1, Math.ceil(analytics.samples.length / 30));
            for (let i = 0; i < analytics.samples.length; i += step) {
                const s = analytics.samples[i];
                if (!s) continue;
                reportMarkdown += `| ${s.elapsedSec ?? 'N/A'} | $${s.price != null ? s.price.toFixed(2) : 'N/A'} | ${s.mfePct != null ? (s.mfePct*100).toFixed(4) : 'N/A'}% | ${s.maePct != null ? (s.maePct*100).toFixed(4) : 'N/A'}% | ${s.spreadPct != null ? (s.spreadPct*100).toFixed(4) : 'N/A'}% | ${s.aggregateImbalance != null ? s.aggregateImbalance.toFixed(1) : 'N/A'}x |
`;
            }
            reportMarkdown += `
</details>
`;
        } else {
            reportMarkdown += `
*No price samples recorded.*
`;
        }

        reportMarkdown += `
### 5. TP/SL
`;
        reportMarkdown += `- **TP Price**: $${trade.tpPrice != null ? trade.tpPrice.toFixed(2) : 'N/A'}
`;
        reportMarkdown += `- **SL Price**: $${trade.slPrice != null ? trade.slPrice.toFixed(2) : 'N/A'}
`;

        reportMarkdown += `
### 6. POSITION / ACCOUNTING
`;
        reportMarkdown += `- **Quantity**: ${trade.quantity ?? 'N/A'}
`;
        reportMarkdown += `- **Margin Used**: $${trade.usedMargin != null ? trade.usedMargin.toFixed(2) : 'N/A'}
`;
        reportMarkdown += `- **Entry Fee**: $${trade.entryFeeUsdt != null ? trade.entryFeeUsdt.toFixed(4) : 'N/A'}
`;
        reportMarkdown += `- **Exit Fee**: $${trade.exitFeeUsdt != null ? trade.exitFeeUsdt.toFixed(4) : 'N/A'}
`;
        const totalFees = trade.feesUsdt ?? ((trade.entryFeeUsdt || 0) + (trade.exitFeeUsdt || 0));
        reportMarkdown += `- **Total Fees**: $${totalFees != null ? totalFees.toFixed(4) : 'N/A'}
`;
        reportMarkdown += `- **Gross P&L**: $${trade.grossPnlUsdt != null ? trade.grossPnlUsdt.toFixed(4) : 'N/A'}
`;
        reportMarkdown += `- **Net P&L**: $${trade.netPnlUsdt != null ? trade.netPnlUsdt.toFixed(4) : 'N/A'}
`;
        reportMarkdown += `- **Account Balance Before**: *Unavailable in individual trade record*
`;
        reportMarkdown += `- **Account Balance After**: *Unavailable in individual trade record*
`;
        if (trade.grossPnlUsdt != null && trade.netPnlUsdt != null) {
            const calcNet = trade.grossPnlUsdt - totalFees;
            const diff = Math.abs(calcNet - trade.netPnlUsdt);
            reportMarkdown += `- **Accounting Check**: ${diff < 0.0001 ? 'o. PASSED (Gross - Fees = Net)' : '?O FAILED'}
`;
        } else {
            reportMarkdown += `- **Accounting Check**: *N/A*
`;
        }
        
        reportMarkdown += `
---

`;
      } catch (err: any) {
        reportMarkdown += `

**ERROR RENDERING TRADE ${trade.tradeId ?? 'Unknown'}**: ${err.message}

---

`;
      }
    }

    return NextResponse.json({ content: reportMarkdown });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

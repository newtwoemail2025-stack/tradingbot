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
      const { tradeId, direction, entryPrice, exitPrice, exitReason, netPnlUsdt, entryTime, holdDurationMs } = trade;
      const analytics = trade.analytics || trade.entryAnalytics;
      const isWin = netPnlUsdt > 0;
      
      reportMarkdown += `## Trade: ${tradeId} (${direction})\n`;
      reportMarkdown += `**Outcome**: ${isWin ? '✅ WIN' : '❌ LOSS'} (${exitReason})\n`;
      reportMarkdown += `- **Net P&L**: $${netPnlUsdt?.toFixed(4) || 'N/A'}\n`;
      reportMarkdown += `- **Entry Price**: $${entryPrice?.toFixed(2) || 'N/A'}\n`;
      reportMarkdown += `- **Exit Price**: $${exitPrice?.toFixed(2) || 'N/A'}\n`;
      reportMarkdown += `- **Hold Duration**: ${(holdDurationMs / 1000).toFixed(1)} seconds\n\n`;

      if (analytics) {
        reportMarkdown += `### 1. Strategy Condition Satisfaction at Entry\n`;
        reportMarkdown += `These were the exact metrics at timestamp \`${new Date(entryTime).toISOString()}\`:\n\n`;
        
        const th = analytics.strategyThresholds || {};
        
        // Imbalance
        const imbPass = direction === 'LONG' ? 
          (analytics.imbalanceDirection === 'LONG' && analytics.aggregateImbalance >= (th.aggImbRatio || 2.5)) :
          (analytics.imbalanceDirection === 'SHORT' && analytics.aggregateImbalance >= (th.aggImbRatio || 2.5));
        reportMarkdown += `- **Imbalance**: ${analytics.aggregateImbalance?.toFixed(2) || 'N/A'}x ${analytics.imbalanceDirection} ${imbPass ? '✅' : '❌'} *(Required: >= ${th.aggImbRatio}x)*\n`;
        
        // Edge
        const edgePass = direction === 'LONG' ?
          (analytics.microEdgePct >= (th.edgePctThreshold || 0.0001)) :
          (analytics.microEdgePct <= -(th.edgePctThreshold || 0.0001));
        reportMarkdown += `- **Micro Edge**: ${analytics.microEdgePct != null ? analytics.microEdgePct.toFixed(6) : 'N/A'}% ${edgePass ? '✅' : '❌'} *(Required: ${direction === 'LONG' ? '>=' : '<='} ${direction === 'LONG' ? th.edgePctThreshold : -th.edgePctThreshold}% )*\n`;

        // Momentum
        const momPass = direction === 'LONG' ?
          (analytics.momentum1sPct >= (th.momentumThreshold || 0.005)) :
          (analytics.momentum1sPct <= -(th.momentumThreshold || 0.005));
        reportMarkdown += `- **Momentum**: ${analytics.momentum1sPct != null ? analytics.momentum1sPct.toFixed(6) : 'N/A'}% ${momPass ? '✅' : '❌'} *(Required: ${direction === 'LONG' ? '>=' : '<='} ${direction === 'LONG' ? th.momentumThreshold : -th.momentumThreshold}% )*\n`;

        // Spread
        const spreadPass = analytics.spreadPct <= (th.maxSpreadPct || 0.01);
        reportMarkdown += `- **Spread**: ${analytics.spreadPct != null ? analytics.spreadPct.toFixed(6) : 'N/A'}% ${spreadPass ? '✅' : '❌'} *(Required: <= ${th.maxSpreadPct}% )*\n\n`;
        
        reportMarkdown += `### 2. PRICE FILTER\n`;
        if (analytics.priceFilter) {
          reportMarkdown += `- **Signal Price**: $${analytics.priceFilter.signalPrice?.toFixed(2) || 'N/A'}\n`;
          reportMarkdown += `- **Zone Low**: $${analytics.priceFilter.zoneLow?.toFixed(2) || 'N/A'}\n`;
          reportMarkdown += `- **Zone High**: $${analytics.priceFilter.zoneHigh?.toFixed(2) || 'N/A'}\n`;
          reportMarkdown += `- **Zone Hit Time**: ${analytics.priceFilter.zoneHitTime ? new Date(analytics.priceFilter.zoneHitTime).toISOString() : 'N/A'}\n`;
          reportMarkdown += `- **Seconds Waited**: ${analytics.priceFilter.secondsWaited ?? 'N/A'}s\n`;
          reportMarkdown += `- **Zone Execution Decision**: ${analytics.priceFilter.decision === 'ENTRY' ? '✅ EXECUTED' : '❌ BLOCKED'}\n`;
          if (analytics.priceFilter.blockReason) {
            reportMarkdown += `- **Block Reason**: ${analytics.priceFilter.blockReason}\n`;
          }
        } else {
          reportMarkdown += `*No price filter data available for this trade.*\n`;
        }

        reportMarkdown += `\n### 3. HISTORICAL FILTER\n`;
        if (analytics.historical) {
          reportMarkdown += `- **Historical Pass/Fail**: ${analytics.historical.pass ? '✅ PASS' : '❌ FAIL'}\n`;
          reportMarkdown += `- **Similar Historical Examples**: ${analytics.historical.neighbors ?? 'N/A'}\n`;
          reportMarkdown += `- **Continuation %**: ${analytics.historical.continuationPct != null ? (analytics.historical.continuationPct * 100).toFixed(1) + '%' : 'N/A'}\n`;
          reportMarkdown += `- **Reversal %**: ${analytics.historical.reversalPct != null ? (analytics.historical.reversalPct * 100).toFixed(1) + '%' : 'N/A'}\n`;
          reportMarkdown += `- **Sideways %**: ${analytics.historical.sidewaysPct != null ? (analytics.historical.sidewaysPct * 100).toFixed(1) + '%' : 'N/A'}\n`;
          reportMarkdown += `- **Historical Direction Edge**: ${analytics.historical.directionEdge != null ? (analytics.historical.directionEdge * 100).toFixed(1) + '%' : 'N/A'}\n`;
        } else {
          reportMarkdown += `*No historical data available for this trade.*\n`;
        }
      } else {
        reportMarkdown += `*Analytics data not found for this trade in live-state.json.*\n`;
      }
      
      reportMarkdown += `\n### 4. TRADE PATH\n`;
      reportMarkdown += `- **MFE**: $${trade.MFE != null ? trade.MFE.toFixed(2) : 'N/A'}\n`;
      reportMarkdown += `- **MFE %**: ${trade.MFE != null && entryPrice ? ((trade.MFE / entryPrice) * 100).toFixed(4) + '%' : 'N/A'}\n`;
      reportMarkdown += `- **MAE**: $${trade.MAE != null ? trade.MAE.toFixed(2) : 'N/A'}\n`;
      reportMarkdown += `- **MAE %**: ${trade.MAE != null && entryPrice ? ((trade.MAE / entryPrice) * 100).toFixed(4) + '%' : 'N/A'}\n`;
      
      if (analytics && analytics.samples && analytics.samples.length > 0) {
          reportMarkdown += `\n<details><summary><b>View Price Path Samples</b></summary>\n\n`;
          reportMarkdown += `| Elapsed (s) | Price | MFE % | MAE % | Spread % | Imbalance |\n`;
          reportMarkdown += `|---|---|---|---|---|---|\n`;
          const step = Math.max(1, Math.ceil(analytics.samples.length / 30));
          for (let i = 0; i < analytics.samples.length; i += step) {
              const s = analytics.samples[i];
              reportMarkdown += `| ${s.elapsedSec} | $${s.price.toFixed(2)} | ${(s.mfePct*100).toFixed(4)}% | ${(s.maePct*100).toFixed(4)}% | ${(s.spreadPct*100).toFixed(4)}% | ${s.aggregateImbalance.toFixed(1)}x |\n`;
          }
          reportMarkdown += `\n</details>\n`;
      } else {
          reportMarkdown += `\n*No price samples recorded.*\n`;
      }

      reportMarkdown += `\n### 5. TP/SL\n`;
      reportMarkdown += `- **TP Price**: $${trade.tpPrice?.toFixed(2) || 'N/A'}\n`;
      reportMarkdown += `- **SL Price**: $${trade.slPrice?.toFixed(2) || 'N/A'}\n`;

      reportMarkdown += `\n### 6. POSITION / ACCOUNTING\n`;
      reportMarkdown += `- **Quantity**: ${trade.quantity ?? 'N/A'}\n`;
      reportMarkdown += `- **Margin Used**: $${trade.usedMargin?.toFixed(2) || 'N/A'}\n`;
      reportMarkdown += `- **Entry Fee**: $${trade.entryFeeUsdt?.toFixed(4) || 'N/A'}\n`;
      reportMarkdown += `- **Exit Fee**: $${trade.exitFeeUsdt?.toFixed(4) || 'N/A'}\n`;
      const totalFees = trade.feesUsdt ?? ((trade.entryFeeUsdt || 0) + (trade.exitFeeUsdt || 0));
      reportMarkdown += `- **Total Fees**: $${totalFees?.toFixed(4) || 'N/A'}\n`;
      reportMarkdown += `- **Gross P&L**: $${trade.grossPnlUsdt?.toFixed(4) || 'N/A'}\n`;
      reportMarkdown += `- **Net P&L**: $${trade.netPnlUsdt?.toFixed(4) || 'N/A'}\n`;
      reportMarkdown += `- **Account Balance Before**: *Unavailable in individual trade record*\n`;
      reportMarkdown += `- **Account Balance After**: *Unavailable in individual trade record*\n`;
      if (trade.grossPnlUsdt != null && trade.netPnlUsdt != null) {
          const calcNet = trade.grossPnlUsdt - totalFees;
          const diff = Math.abs(calcNet - trade.netPnlUsdt);
          reportMarkdown += `- **Accounting Check**: ${diff < 0.0001 ? '✅ PASSED (Gross - Fees = Net)' : '❌ FAILED'}\n`;
      } else {
          reportMarkdown += `- **Accounting Check**: *N/A*\n`;
      }
      
      reportMarkdown += `\n---\n\n`;
    }

    return NextResponse.json({ content: reportMarkdown });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

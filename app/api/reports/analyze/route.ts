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
      reportMarkdown += `- **Net P&L**: $${netPnlUsdt.toFixed(4)}\n`;
      reportMarkdown += `- **Entry Price**: $${entryPrice.toFixed(2)}\n`;
      reportMarkdown += `- **Exit Price**: $${exitPrice.toFixed(2)}\n`;
      reportMarkdown += `- **Hold Duration**: ${(holdDurationMs / 1000).toFixed(1)} seconds\n\n`;

      if (analytics) {
        reportMarkdown += `### 1. Strategy Condition Satisfaction at Entry\n`;
        reportMarkdown += `These were the exact metrics at timestamp \`${new Date(entryTime).toISOString()}\`:\n\n`;
        
        const th = analytics.strategyThresholds || {};
        
        // Imbalance
        const imbPass = direction === 'LONG' ? 
          (analytics.imbalanceDirection === 'BUY' && analytics.aggregateImbalance >= (th.aggImbRatio || 2.5)) :
          (analytics.imbalanceDirection === 'SHORT' && analytics.aggregateImbalance >= (th.aggImbRatio || 2.5));
        reportMarkdown += `- **Imbalance**: ${analytics.aggregateImbalance.toFixed(2)}x ${analytics.imbalanceDirection} ${imbPass ? '✅' : '❌'} *(Required: >= ${th.aggImbRatio}x)*\n`;
        
        // Edge
        const edgePass = direction === 'LONG' ?
          (analytics.microEdgePct >= (th.edgePctThreshold || 0.0001)) :
          (analytics.microEdgePct <= -(th.edgePctThreshold || 0.0001));
        reportMarkdown += `- **Micro Edge**: ${analytics.microEdgePct.toFixed(6)}% ${edgePass ? '✅' : '❌'} *(Required: ${direction === 'LONG' ? '>=' : '<='} ${direction === 'LONG' ? th.edgePctThreshold : -th.edgePctThreshold}% )*\n`;

        // Momentum
        const momPass = direction === 'LONG' ?
          (analytics.momentum1sPct >= (th.momentumThreshold || 0.005)) :
          (analytics.momentum1sPct <= -(th.momentumThreshold || 0.005));
        reportMarkdown += `- **Momentum**: ${analytics.momentum1sPct.toFixed(6)}% ${momPass ? '✅' : '❌'} *(Required: ${direction === 'LONG' ? '>=' : '<='} ${direction === 'LONG' ? th.momentumThreshold : -th.momentumThreshold}% )*\n`;

        // Spread
        const spreadPass = analytics.spreadPct <= (th.maxSpreadPct || 0.01);
        reportMarkdown += `- **Spread**: ${analytics.spreadPct.toFixed(6)}% ${spreadPass ? '✅' : '❌'} *(Required: <= ${th.maxSpreadPct}% )*\n`;
        
        reportMarkdown += `\n### 2. Timing & Zone Execution\n`;
        if (analytics.priceFilter) {
          reportMarkdown += `- **Zone Hit Time**: ${new Date(analytics.priceFilter.zoneHitTime).toISOString()}\n`;
          reportMarkdown += `- **Seconds Waited in Zone**: ${analytics.priceFilter.secondsWaited}s\n`;
        }

        reportMarkdown += `\n### 3. Log Forensics (from spawn-debug.log)\n`;
        
        // Find log lines around this entry time
        // We will look for lines matching RECHECK between zoneHitTime and entryTime + 2000ms
        const startTime = analytics.priceFilter ? analytics.priceFilter.zoneHitTime : entryTime - 30000;
        const endTime = entryTime + 2000;
        
        let foundLogs = false;
        let failReasons: Record<string, number> = {};
        
        for (const line of logLines) {
          // Attempt to extract timestamp if line has one like "2026-09-23T12:29:35.069Z"
          const match = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
          if (match) {
            const lineTs = new Date(match[0]).getTime();
            if (lineTs >= startTime && lineTs <= endTime) {
              if (line.includes('[RECHECK_FAIL]')) {
                const parts = line.split('[RECHECK_FAIL]');
                const reason = parts[1].trim();
                failReasons[reason] = (failReasons[reason] || 0) + 1;
              }
              if (line.includes('[RECHECK_PASS]')) {
                foundLogs = true;
                reportMarkdown += `**Successful Recheck**: \`${line.trim()}\`\n`;
              }
            }
          }
        }

        if (Object.keys(failReasons).length > 0) {
          foundLogs = true;
          reportMarkdown += `**Failed Rechecks while waiting in zone**:\n`;
          for (const [reason, count] of Object.entries(failReasons)) {
            reportMarkdown += `- ${reason} (Failed ${count} times)\n`;
          }
        }
        
        if (!foundLogs) {
          reportMarkdown += `*No specific recheck logs found in spawn-debug.log for this exact timeframe.*\n`;
        }
      } else {
        reportMarkdown += `*Analytics data not found for this trade in live-state.json.*\n`;
      }
      
      reportMarkdown += `\n---\n\n`;
    }

    return NextResponse.json({ content: reportMarkdown });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

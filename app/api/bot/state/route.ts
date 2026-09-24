export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function GET() {
  try {
    const pidFile = path.join(process.cwd(), 'reports', 'bot.pid');
    const stateFile = path.join(process.cwd(), 'reports', 'live-state.json');
    
    let isRunning = false;
    
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
        process.kill(pid, 0); 
        isRunning = true;
      } catch (e) {
        fs.unlinkSync(pidFile);
      }
    }

    let state = null;
    if (fs.existsSync(stateFile)) {
      try {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        
        // Strip samples to save bandwidth and prevent dashboard freezing
        if (state && state.allTrades) {
            state.allTrades = state.allTrades.map((trade: any) => {
                if (trade.analytics && trade.analytics.samples) {
                    const { samples, ...restAnalytics } = trade.analytics;
                    return { ...trade, analytics: restAnalytics };
                }
                if (trade.entryAnalytics && trade.entryAnalytics.samples) {
                    const { samples, ...restAnalytics } = trade.entryAnalytics;
                    return { ...trade, entryAnalytics: restAnalytics };
                }
                return trade;
            });
        }
      } catch(e) {}
    }

    if (!isRunning) {
      try {
        const binanceRes = await fetch('https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=ETHUSDT', { cache: 'no-store' });
        const binanceData = await binanceRes.json();
        if (binanceData.askPrice && binanceData.bidPrice) {
          if (!state) state = {};
          state.currentAsk = parseFloat(binanceData.askPrice);
          state.currentBid = parseFloat(binanceData.bidPrice);
        }
      } catch(e) {}
    }

    return NextResponse.json({
      success: true,
      isRunning,
      state
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

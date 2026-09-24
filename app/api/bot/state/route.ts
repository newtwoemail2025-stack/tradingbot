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

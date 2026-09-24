import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function POST(request: Request) {
  try {
    const { durationMs, startBalanceInr } = await request.json();

    const pidFile = path.join(process.cwd(), 'reports', 'bot.pid');
    
    // Check if already running
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
        process.kill(pid, 0); // test if process exists
        return NextResponse.json({ success: false, error: 'Bot is already running' }, { status: 400 });
      } catch (e) {
        // process doesn't exist, stale pid file
        fs.unlinkSync(pidFile);
      }
    }

    // Completely hide all fs and child_process execution from Turbopack using new Function
    const spawnBot = new Function('durationMs', 'startBalanceInr', 'cwd', `
      const cp = require('child_process');
      const fs = require('fs');
      const path = require('path');
      
      // Ensure reports directory exists
      const reportsDir = path.join(cwd, 'reports');
      if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
      }
      
      const out = fs.openSync(path.join(reportsDir, 'spawn-debug.log'), 'a');
      const err = fs.openSync(path.join(reportsDir, 'spawn-debug.err'), 'a');
      
      const child = cp.spawn('node', [path.join(cwd, 'scripts', 'phase51-15m-live-runner.js')], {
        detached: true,
        stdio: ['ignore', out, err],
        env: Object.assign({}, process.env, {
          DURATION_MS: durationMs.toString(),
          START_BALANCE_INR: startBalanceInr ? startBalanceInr.toString() : '1000'
        })
      });
      
      child.unref();
      return child.pid;
    `);

    const childPid = spawnBot(durationMs, startBalanceInr, process.cwd());
    
    // Write the PID file so the backend state tracker knows the bot is alive
    if (childPid) {
        fs.writeFileSync(pidFile, childPid.toString());
    }

    // small delay to ensure PID is written
    await new Promise(r => setTimeout(r, 1000));

    return NextResponse.json({ success: true, message: 'Bot started' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

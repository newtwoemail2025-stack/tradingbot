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

    // Evade Turbopack static analysis completely
    const s1 = 'scrip';
    const s2 = 'ts';
    const folder = s1 + s2;
    const f1 = 'phase51-15m-live';
    const f2 = '-runner.js';
    const file = f1 + f2;
    const finalPath = path.join(process.cwd(), folder, file);
    
    const out = fs.openSync(path.join(process.cwd(), 'reports', 'spawn-debug.log'), 'a');
    const err = fs.openSync(path.join(process.cwd(), 'reports', 'spawn-debug.err'), 'a');

    const cmd = 'node';
    const spawnArgs = [finalPath];
    const spawnOpts: any = {
      detached: true,
      stdio: ['ignore', out, err],
      env: {
        ...process.env,
        DURATION_MS: durationMs.toString(),
        START_BALANCE_INR: startBalanceInr ? startBalanceInr.toString() : '1000'
      }
    };

    // Use bracket notation to prevent static analysis of spawn
    const cp = require('child_process');
    const child = cp['spawn'](cmd, spawnArgs, spawnOpts);

    child.unref(); // Let the child run independently
    
    // Write the PID file so the backend state tracker knows the bot is alive
    if (child.pid) {
        fs.writeFileSync(pidFile, child.pid.toString());
    }

    // small delay to ensure PID is written
    await new Promise(r => setTimeout(r, 1000));

    return NextResponse.json({ success: true, message: 'Bot started' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

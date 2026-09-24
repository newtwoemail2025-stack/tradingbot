import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function POST() {
  try {
    const pidFile = path.join(process.cwd(), 'reports', 'bot.pid');
    
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
      try {
        process.kill(pid, 'SIGTERM'); // gently kill the node process
      } catch (e) {
        // process might already be dead
      }
      fs.unlinkSync(pidFile);
      return NextResponse.json({ success: true, message: 'Bot stopped' });
    }

    return NextResponse.json({ success: true, message: 'Bot was not running' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

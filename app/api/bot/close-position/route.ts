import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const CLOSE_SIGNAL_FILE = path.join(REPORTS_DIR, 'close-signal.json');

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // body: { tradeId: number } or { closeAll: true }
    fs.writeFileSync(CLOSE_SIGNAL_FILE, JSON.stringify(body));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

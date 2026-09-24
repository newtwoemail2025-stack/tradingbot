import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pair = searchParams.get('pair');
  const interval = searchParams.get('interval');

  if (!pair || !interval) {
    return NextResponse.json({ error: 'Missing pair or interval' }, { status: 400 });
  }

  try {
    // Next.js server acts as a proxy to bypass CORS policies enforced by the browser
    const response = await fetch(`https://public.coindcx.com/market_data/candles?pair=${pair}&interval=${interval}`, {
      headers: {
        'User-Agent': 'AlgoX/1.0',
      }
    });

    if (!response.ok) {
      throw new Error(`CoinDCX API responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error proxying CoinDCX API:", error);
    return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

export const revalidate = 0; // Disable caching for this route

export async function GET() {
  try {
    const response = await fetch('https://api.coindcx.com/exchange/ticker', {
      headers: {
        'User-Agent': 'AlgoX/1.0',
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`CoinDCX API responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error proxying CoinDCX Ticker API:", error);
    return NextResponse.json({ error: 'Failed to fetch ticker data' }, { status: 500 });
  }
}

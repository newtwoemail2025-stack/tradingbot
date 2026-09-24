// Fetch real CoinDCX instrument parameters for BTCINR spot and futures
const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'AlgoX-Research/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log("Fetching CoinDCX instrument parameters...\n");

  // 1. Get all markets
  try {
    const markets = await get('https://api.coindcx.com/exchange/v1/markets_details');
    const btc = Array.isArray(markets) 
      ? markets.filter(m => m.symbol && m.symbol.includes('BTC') && m.symbol.includes('INR'))
      : [];
    console.log("BTC/INR markets found:", btc.length);
    btc.slice(0, 3).forEach(m => {
      console.log(JSON.stringify({
        symbol: m.symbol,
        coindcx_name: m.coindcx_name,
        base_currency: m.base_currency,
        quote_currency: m.quote_currency,
        min_quantity: m.min_quantity,
        max_quantity: m.max_quantity,
        min_notional: m.min_notional,
        step: m.step,
        order_types: m.order_types,
        maker_fee: m.maker_fee,
        taker_fee: m.taker_fee,
      }, null, 2));
    });
  } catch(e) {
    console.log("markets_details FAILED:", e.message);
  }

  // 2. Get current ticker for BTCINR
  try {
    const tickers = await get('https://api.coindcx.com/exchange/ticker');
    const ticker = Array.isArray(tickers)
      ? tickers.find(t => t.market === 'BTCINR')
      : null;
    if (ticker) {
      console.log("\nBTCINR ticker:", JSON.stringify({
        market: ticker.market,
        bid: ticker.bid,
        ask: ticker.ask,
        last_price: ticker.last_price,
        volume: ticker.volume,
        timestamp: ticker.timestamp,
      }, null, 2));
    } else {
      console.log("\nBTCINR ticker not found in ticker list");
    }
  } catch(e) {
    console.log("ticker FAILED:", e.message);
  }

  // 3. Futures info
  try {
    const futures = await get('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments');
    const fbtc = Array.isArray(futures)
      ? futures.filter(f => f.symbol && f.symbol.includes('BTC'))
      : [];
    console.log("\nBTC futures instruments:", fbtc.length);
    if (fbtc.length > 0) {
      const f = fbtc[0];
      console.log(JSON.stringify({
        symbol: f.symbol,
        underlying_asset: f.underlying_asset,
        contract_type: f.contract_type,
        tick_size: f.tick_size,
        lot_size: f.lot_size,
        max_leverage: f.max_leverage,
        maintenance_margin: f.maintenance_margin,
        initial_margin: f.initial_margin,
        maker_fee: f.maker_fee,
        taker_fee: f.taker_fee,
        funding_rate: f.funding_rate,
      }, null, 2));
    }
  } catch(e) {
    console.log("futures FAILED:", e.message);
  }
}

main();

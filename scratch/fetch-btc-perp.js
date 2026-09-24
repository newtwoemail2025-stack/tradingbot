const https = require('https');
const fs = require('fs');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, {headers:{'User-Agent':'AlgoX-Research/1.0'}}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch{res(d)}});
    }).on('error',rej);
  });
}

async function run() {
  console.log("Fetching active futures instruments...");
  const data = await get('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments');
  
  if (!Array.isArray(data)) {
    console.log("Error: Expected array, got", typeof data);
    return;
  }
  
  const btcPerps = data.filter(i => i.symbol && i.symbol.includes('BTC') && i.symbol.includes('USDT'));
  console.log(`Found ${btcPerps.length} BTC/USDT futures instruments:`);
  
  btcPerps.forEach(inst => {
    console.log("\n--- " + inst.symbol + " ---");
    console.log("Base Asset:", inst.base_currency_short_name);
    console.log("Quote Asset:", inst.target_currency_short_name);
    console.log("Margin Asset:", "USDT"); // usually
    console.log("Instrument Type/Contract:", inst.contract_type || "Perpetual");
    console.log("Min Notional:", inst.min_notional);
    console.log("Min Quantity:", inst.min_quantity);
    console.log("Quantity Step:", inst.step);
    console.log("Price Step (Tick Size):", inst.tick_size);
    console.log("Max Leverage:", inst.max_leverage);
    console.log("Maker Fee:", inst.maker_fee);
    console.log("Taker Fee:", inst.taker_fee);
    console.log("3x, 4x, 5x Allowed?:", inst.max_leverage >= 5 ? "YES" : "NO");
    
    // Log the whole object to file for reference
    fs.writeFileSync('scratch/btc-perp-instrument.json', JSON.stringify(inst, null, 2));
  });
}

run();

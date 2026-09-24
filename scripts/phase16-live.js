const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../research/phase16');
if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, {headers:{'User-Agent':'AlgoX-Research/1.0'}}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch{res(d)}});
    }).on('error',rej);
  });
}

const DURATION = 60 * 60 * 1000; 
const POLL_INTERVAL = 2000; 

async function run() {
    console.log("Discovering symbols for Phase 16...");
    const activeInstruments = await get('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT');
    
    if (!Array.isArray(activeInstruments)) {
        console.error("Failed to fetch instruments");
        return;
    }

    const TARGET_CAPITAL = 200;
    const USDT_INR = 99.6; 
    let candidates = [];

    for (const inst of activeInstruments) {
        if (inst.margin_currency_short_name !== 'USDT') continue;
        const minNotionalInr = inst.min_notional * USDT_INR;
        const margin3x = minNotionalInr / 3;
        const margin4x = minNotionalInr / 4;
        const margin5x = minNotionalInr / 5;

        if ((inst.max_leverage_long >= 3 && margin3x <= TARGET_CAPITAL) ||
            (inst.max_leverage_long >= 4 && margin4x <= TARGET_CAPITAL) ||
            (inst.max_leverage_long >= 5 && margin5x <= TARGET_CAPITAL)) {
            candidates.push(inst);
        }
    }

    // Sort by lowest notional, pick 4
    candidates.sort((a,b) => a.min_notional - b.min_notional);
    const testPairs = candidates.slice(0, 4);

    console.log(`Selected pairs: ${testPairs.map(p=>p.pair).join(', ')}`);
    fs.writeFileSync(path.join(OUT_DIR, 'phase16_symbols.json'), JSON.stringify(testPairs, null, 2));

    const data = {};
    for (const p of testPairs) {
        data[p.pair] = { orderbook: [], trades: [], knownTradeIds: new Set() };
    }

    const start = Date.now();
    let msgs = 0;
    console.log("Starting 60-minute live polling...");

    while (Date.now() - start < DURATION) {
        for (const p of testPairs) {
            try {
                const obData = await get(`https://public.coindcx.com/market_data/v3/orderbook/${p.pair}-futures/10`);
                let obRecord = { timestamp: Date.now() };
                if (obData && obData.bids && obData.asks) {
                    let bids = Array.isArray(obData.bids) ? obData.bids.map(x=>({price:parseFloat(x.price||x[0]), qty:parseFloat(x.quantity||x[1])})) : Object.keys(obData.bids).map(k=>({price:parseFloat(k), qty:parseFloat(obData.bids[k])}));
                    let asks = Array.isArray(obData.asks) ? obData.asks.map(x=>({price:parseFloat(x.price||x[0]), qty:parseFloat(x.quantity||x[1])})) : Object.keys(obData.asks).map(k=>({price:parseFloat(k), qty:parseFloat(obData.asks[k])}));
                    bids.sort((a,b)=>b.price-a.price);
                    asks.sort((a,b)=>a.price-b.price);
                    
                    if (bids.length > 0 && asks.length > 0) {
                        const spread = asks[0].price - bids[0].price;
                        const spreadPct = spread / bids[0].price;
                        obRecord = { ...obRecord, bestBid: bids[0].price, bestAsk: asks[0].price, mid: (bids[0].price+asks[0].price)/2, spread, spreadPct };
                        data[p.pair].orderbook.push(obRecord);
                    }
                }
                const trData = await get(`https://api.coindcx.com/exchange/v1/derivatives/futures/data/trades?pair=${p.pair}`);
                if (Array.isArray(trData)) {
                    for (const t of trData) {
                        const id = `${t.price}_${t.quantity}_${t.timestamp}`;
                        if (!data[p.pair].knownTradeIds.has(id)) {
                            data[p.pair].knownTradeIds.add(id);
                            data[p.pair].trades.push({ timestamp: t.timestamp, price: parseFloat(t.price), quantity: parseFloat(t.quantity), is_maker: t.is_maker });
                        }
                    }
                }
            } catch(e) {}
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        msgs++;
        if (msgs % 100 === 0) console.log(`Time elapsed: ${Math.floor((Date.now()-start)/1000)}s`);
    }

    console.log("Finished polling. Saving data...");
    
    let obCsv = "symbol,timestamp,bestBid,bestAsk,mid,spread,spreadPct\n";
    let trCsv = "symbol,timestamp,price,quantity,is_maker\n";

    for (const p of testPairs) {
        data[p.pair].trades.sort((a,b) => a.timestamp - b.timestamp);
        for (const ob of data[p.pair].orderbook) {
            obCsv += `${p.pair},${ob.timestamp},${ob.bestBid},${ob.bestAsk},${ob.mid},${ob.spread},${ob.spreadPct}\n`;
        }
        for (const tr of data[p.pair].trades) {
            trCsv += `${p.pair},${tr.timestamp},${tr.price},${tr.quantity},${tr.is_maker}\n`;
        }
    }

    fs.writeFileSync(path.join(OUT_DIR, 'phase16_orderbook.csv'), obCsv);
    fs.writeFileSync(path.join(OUT_DIR, 'phase16_trades.csv'), trCsv);
    console.log("Phase 16 live data saved.");
}
run();

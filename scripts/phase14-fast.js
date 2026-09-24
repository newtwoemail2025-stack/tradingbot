const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../research/phase14');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, {headers:{'User-Agent':'AlgoX-Research/1.0'}}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch{res(d)}});
    }).on('error',rej);
  });
}

const testPairs = [{pair: 'B-STX_USDT'}, {pair: 'B-TIA_USDT'}];
const DURATION = 60 * 1000; 

async function run() {
    const data = {};
    for (const p of testPairs) {
        data[p.pair] = { orderbook: [], trades: [], knownTradeIds: new Set() };
    }

    const start = Date.now();
    let msgs = 0;
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
                        const bidQty1 = bids[0].qty;
                        const askQty1 = asks[0].qty;
                        const bidQty5 = bids.slice(0,5).reduce((s,b)=>s+b.qty,0);
                        const askQty5 = asks.slice(0,5).reduce((s,a)=>s+a.qty,0);
                        const imbalance = bidQty5 / (bidQty5 + askQty5);
                        obRecord = { ...obRecord, bestBid: bids[0].price, bestAsk: asks[0].price, mid: (bids[0].price+asks[0].price)/2, spread, spreadPct, bidQty1, askQty1, bidQty5, askQty5, imbalance };
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
        await new Promise(r => setTimeout(r, 1000));
    }
    
    let obCsv = "symbol,timestamp,bestBid,bestAsk,mid,spread,spreadPct,bidQty1,askQty1,bidQty5,askQty5,imbalance\n";
    let trCsv = "symbol,timestamp,price,quantity,is_maker\n";

    for (const p of testPairs) {
        data[p.pair].trades.sort((a,b) => a.timestamp - b.timestamp);
        for (const ob of data[p.pair].orderbook) {
            obCsv += `${p.pair},${ob.timestamp},${ob.bestBid},${ob.bestAsk},${ob.mid},${ob.spread},${ob.spreadPct},${ob.bidQty1},${ob.askQty1},${ob.bidQty5},${ob.askQty5},${ob.imbalance}\n`;
        }
        for (const tr of data[p.pair].trades) {
            trCsv += `${p.pair},${tr.timestamp},${tr.price},${tr.quantity},${tr.is_maker}\n`;
        }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'phase14-orderbook.csv'), obCsv);
    fs.writeFileSync(path.join(OUT_DIR, 'phase14-trades.csv'), trCsv);
    console.log("60s polling finished.");
}
run();

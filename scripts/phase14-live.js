const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../research/phase14');
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

// 30 minutes in milliseconds
const DURATION = 30 * 60 * 1000;
const POLL_INTERVAL = 2000; // 2 seconds to avoid rate limits when polling multiple pairs

async function run() {
    let allInstruments = [];
    try {
        allInstruments = JSON.parse(fs.readFileSync(path.join(__dirname, '../research/phase13/phase13-futures-universe.json')));
    } catch(e) {
        console.error("Universe not found.");
        return;
    }

    const TARGET_CAPITAL = 200;
    const USDT_INR = 99.6; // Approximated
    let candidates = [];

    for (const inst of allInstruments) {
        const minNotionalInr = (inst.margin_currency_short_name === 'USDT' ? inst.min_notional * USDT_INR : inst.min_notional);
        const margin3x = minNotionalInr / 3;
        const margin4x = minNotionalInr / 4;
        const margin5x = minNotionalInr / 5;

        if ((inst.max_leverage_long >= 3 && margin3x <= TARGET_CAPITAL) ||
            (inst.max_leverage_long >= 4 && margin4x <= TARGET_CAPITAL) ||
            (inst.max_leverage_long >= 5 && margin5x <= TARGET_CAPITAL)) {
            candidates.push(inst);
        }
    }

    console.log(`Found ${candidates.length} candidates for ₹200. Picking top 2 by lowest notional for 30 min test.`);
    candidates.sort((a,b) => a.min_notional - b.min_notional);
    const testPairs = candidates.slice(0, 2);

    console.log(`Selected pairs: ${testPairs.map(p=>p.pair).join(', ')}`);

    const data = {};
    for (const p of testPairs) {
        data[p.pair] = {
            orderbook: [],
            trades: [],
            knownTradeIds: new Set()
        };
    }

    const start = Date.now();
    let msgs = 0;

    console.log("Starting 30-minute live polling...");

    while (Date.now() - start < DURATION) {
        for (const p of testPairs) {
            try {
                // Fetch OB
                const obData = await get(`https://public.coindcx.com/market_data/v3/orderbook/${p.pair}-futures/10`);
                msgs++;
                let obRecord = { timestamp: Date.now() };

                if (obData && obData.bids && obData.asks) {
                    let bids = Array.isArray(obData.bids) ? obData.bids.map(x=>({price:parseFloat(x.price||x[0]), qty:parseFloat(x.quantity||x[1])})) : Object.keys(obData.bids).map(k=>({price:parseFloat(k), qty:parseFloat(obData.bids[k])}));
                    let asks = Array.isArray(obData.asks) ? obData.asks.map(x=>({price:parseFloat(x.price||x[0]), qty:parseFloat(x.quantity||x[1])})) : Object.keys(obData.asks).map(k=>({price:parseFloat(k), qty:parseFloat(obData.asks[k])}));
                    bids.sort((a,b)=>b.price-a.price);
                    asks.sort((a,b)=>a.price-b.price);
                    
                    if (bids.length > 0 && asks.length > 0) {
                        const bestBid = bids[0].price;
                        const bestAsk = asks[0].price;
                        const spread = bestAsk - bestBid;
                        const spreadPct = spread / bestBid;
                        
                        const top5Bids = bids.slice(0, 5);
                        const top5Asks = asks.slice(0, 5);
                        
                        const bidQty1 = top5Bids[0].qty;
                        const askQty1 = top5Asks[0].qty;
                        const bidQty5 = top5Bids.reduce((s,b)=>s+b.qty,0);
                        const askQty5 = top5Asks.reduce((s,a)=>s+a.qty,0);
                        const imbalance = bidQty5 / (bidQty5 + askQty5);
                        
                        obRecord = { ...obRecord, bestBid, bestAsk, mid: (bestBid+bestAsk)/2, spread, spreadPct, bidQty1, askQty1, bidQty5, askQty5, imbalance };
                        data[p.pair].orderbook.push(obRecord);
                    }
                }

                // Fetch Trades
                const trData = await get(`https://api.coindcx.com/exchange/v1/derivatives/futures/data/trades?pair=${p.pair}`);
                msgs++;
                if (Array.isArray(trData)) {
                    for (const t of trData) {
                        const id = `${t.price}_${t.quantity}_${t.timestamp}`;
                        if (!data[p.pair].knownTradeIds.has(id)) {
                            data[p.pair].knownTradeIds.add(id);
                            data[p.pair].trades.push({
                                timestamp: t.timestamp,
                                price: parseFloat(t.price),
                                quantity: parseFloat(t.quantity),
                                is_maker: t.is_maker
                            });
                        }
                    }
                }
            } catch(e) {}
        }

        // Wait
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        if (msgs % 100 === 0) {
            console.log(`Time elapsed: ${Math.floor((Date.now()-start)/1000)}s, Msgs: ${msgs}`);
        }
    }

    console.log("Data collection finished. Running analysis...");
    
    // Sort trades
    for (const p of testPairs) {
        data[p.pair].trades.sort((a,b) => a.timestamp - b.timestamp);
    }

    // Process events (simplified simulation)
    // We will save raw data and summarize
    fs.writeFileSync(path.join(OUT_DIR, 'phase14-live-market.json'), JSON.stringify({
        durationMs: DURATION,
        msgsReceived: msgs,
        pairs: testPairs.map(p => p.pair)
    }, null, 2));

    let obCsv = "symbol,timestamp,bestBid,bestAsk,mid,spread,spreadPct,bidQty1,askQty1,bidQty5,askQty5,imbalance\n";
    let trCsv = "symbol,timestamp,price,quantity,is_maker\n";

    for (const p of testPairs) {
        for (const ob of data[p.pair].orderbook) {
            obCsv += `${p.pair},${ob.timestamp},${ob.bestBid},${ob.bestAsk},${ob.mid},${ob.spread},${ob.spreadPct},${ob.bidQty1},${ob.askQty1},${ob.bidQty5},${ob.askQty5},${ob.imbalance}\n`;
        }
        for (const tr of data[p.pair].trades) {
            trCsv += `${p.pair},${tr.timestamp},${tr.price},${tr.quantity},${tr.is_maker}\n`;
        }
    }

    fs.writeFileSync(path.join(OUT_DIR, 'phase14-orderbook.csv'), obCsv);
    fs.writeFileSync(path.join(OUT_DIR, 'phase14-trades.csv'), trCsv);

    // Run short-term logic (Events and simulation)
    // Since 30 minutes is short, we might not get many events.
    let report = `# Phase 14 Real-Time Futures Scalping Research\n\n`;
    report += `Pairs tested: ${testPairs.map(p=>p.pair).join(', ')}\n`;
    report += `Duration: 30 minutes\n`;
    report += `Capital: ₹200\n`;

    fs.writeFileSync(path.join(OUT_DIR, 'phase14-report.md'), report);

    console.log("Phase 14 data saved.");
}

run();

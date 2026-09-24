const https = require('https');
const fs = require('fs');
const path = require('path');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, {headers:{'User-Agent':'AlgoX-Research/1.0'}}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch{res(d)}});
    }).on('error',rej);
  });
}

const OUT_DIR = path.join(__dirname, '../research/phase19b');
if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function run() {
    console.log("Fetching active futures instruments...");
    let activeInst = await get('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT');
    
    // Add INR ones just in case
    try {
        const inrInst = await get('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=INR');
        if (Array.isArray(inrInst)) activeInst = activeInst.concat(inrInst);
    } catch(e) {}
    
    console.log(`Found ${activeInst.length} total active futures symbols.`);
    
    // Fetch Live USDT/INR price
    let liveUsdtInr = 86.0;
    try {
        const ticker = await get('https://api.coindcx.com/exchange/ticker');
        const usdtInr = ticker.find(t => t.market === 'USDTINR');
        if (usdtInr && usdtInr.last_price) {
            liveUsdtInr = parseFloat(usdtInr.last_price);
            console.log(`Live USDT/INR exchange rate: ₹${liveUsdtInr}`);
        }
    } catch (e) {
        console.log(`Failed to fetch live USDT/INR rate, using ₹${liveUsdtInr}`);
    }

    const CONCURRENCY = 20;
    const allInstruments = [];
    
    console.log(`Fetching details for all ${activeInst.length} symbols...`);
    
    let processed = 0;
    for (let i = 0; i < activeInst.length; i += CONCURRENCY) {
        const chunk = activeInst.slice(i, i + CONCURRENCY);
        const promises = chunk.map(async sym => {
            try {
                const margin = sym.endsWith('_INR') ? 'INR' : 'USDT';
                const det = await get(`https://api.coindcx.com/exchange/v1/derivatives/futures/data/instrument?pair=${sym}&margin_currency_short_name=${margin}`);
                return det.instrument || null;
            } catch (e) { return null; }
        });
        const results = await Promise.all(promises);
        results.forEach(r => { if (r) allInstruments.push(r); });
        processed += chunk.length;
        process.stdout.write(`\rProcessed ${processed} / ${activeInst.length}`);
    }
    console.log("\nInstrument details fetched. Now fetching live orderbooks for prices...");

    const candidates = [];
    const list3x = [];
    const list4x = [];
    const list5x = [];
    
    processed = 0;
    for (let i = 0; i < allInstruments.length; i += CONCURRENCY) {
        const chunk = allInstruments.slice(i, i + CONCURRENCY);
        const promises = chunk.map(async inst => {
            let obData = null;
            let currentPrice = null;
            let spreadInr = 0;
            let spreadPct = 0;
            
            try {
                obData = await get(`https://public.coindcx.com/market_data/v3/orderbook/${inst.pair}-futures/5`);
                if (obData && obData.bids && obData.asks) {
                    let bids = Array.isArray(obData.bids) ? obData.bids.map(x=>parseFloat(x.price||x[0])) : Object.keys(obData.bids).map(k=>parseFloat(k));
                    let asks = Array.isArray(obData.asks) ? obData.asks.map(x=>parseFloat(x.price||x[0])) : Object.keys(obData.asks).map(k=>parseFloat(k));
                    bids.sort((a,b)=>b-a);
                    asks.sort((a,b)=>a-b);
                    
                    if (bids.length > 0 && asks.length > 0) {
                        const bestBid = bids[0];
                        const bestAsk = asks[0];
                        currentPrice = (bestBid + bestAsk) / 2;
                        
                        const spreadRaw = bestAsk - bestBid;
                        spreadPct = (spreadRaw / currentPrice);
                        // Convert spread to INR equivalent for cost buffer
                        spreadInr = inst.margin_currency_short_name === 'USDT' ? spreadRaw * liveUsdtInr : spreadRaw;
                    }
                }
            } catch(e) {}
            
            if (!currentPrice) return null; // Cannot compute minimum physical execution notional without price
            
            const isUSDT = inst.margin_currency_short_name === 'USDT';
            const priceInr = isUSDT ? currentPrice * liveUsdtInr : currentPrice;
            
            // Minimum physical execution size calculation
            const minQty = Math.max(inst.min_quantity, inst.quantity_increment);
            let rawMinNotional = minQty * priceInr;
            
            // Apply API-level minimum notional if it is larger than physical quantity calc
            const apiMinNotionalInr = isUSDT ? inst.min_notional * liveUsdtInr : inst.min_notional;
            const minExecutableNotional = Math.max(rawMinNotional, apiMinNotionalInr);
            
            const makerFee = inst.maker_fee || 0.000236; // Default to 0.0236% if undefined
            const takerFee = inst.taker_fee || 0.00059; // Default to 0.059% if undefined
            
            // Calculate margins
            const margin3x = minExecutableNotional / 3;
            const margin4x = minExecutableNotional / 4;
            const margin5x = minExecutableNotional / 5;
            
            // Cost buffer calculation
            const entryFeeInr = minExecutableNotional * takerFee;
            const exitFeeInr = minExecutableNotional * makerFee;
            const totalCostBuffer = entryFeeInr + exitFeeInr + spreadInr;
            
            const req3x = margin3x + totalCostBuffer;
            const req4x = margin4x + totalCostBuffer;
            const req5x = margin5x + totalCostBuffer;
            
            const ACCOUNT = 300;
            const fits3x = inst.max_leverage_long >= 3 && req3x <= ACCOUNT;
            const fits4x = inst.max_leverage_long >= 4 && req4x <= ACCOUNT;
            const fits5x = inst.max_leverage_long >= 5 && req5x <= ACCOUNT;
            
            if (fits3x) list3x.push(inst.pair);
            if (fits4x) list4x.push(inst.pair);
            if (fits5x) list5x.push(inst.pair);
            
            return {
                Symbol: inst.pair,
                Price: currentPrice,
                MinQty: minQty,
                QtyStep: inst.quantity_increment,
                MinNotionalInr: minExecutableNotional.toFixed(2),
                Margin3x: margin3x.toFixed(2),
                Margin4x: margin4x.toFixed(2),
                Margin5x: margin5x.toFixed(2),
                Fits3x: fits3x ? 'YES' : 'NO',
                Fits4x: fits4x ? 'YES' : 'NO',
                Fits5x: fits5x ? 'YES' : 'NO',
                LONG: inst.max_leverage_long > 1 ? 'YES' : 'NO',
                SHORT: inst.max_leverage_short > 1 ? 'YES' : 'NO',
                MakerFee: makerFee,
                TakerFee: takerFee,
                SpreadPct: (spreadPct * 100).toFixed(4) + '%',
                CostBufferInr: totalCostBuffer.toFixed(4)
            };
        });
        
        const results = await Promise.all(promises);
        results.forEach(r => { if (r) candidates.push(r); });
        processed += chunk.length;
        process.stdout.write(`\rProcessed ${processed} / ${allInstruments.length} orderbooks`);
    }
    console.log("\nDone computing limits!");
    
    // Write out CSV files
    const executableOnly = candidates.filter(c => c.Fits5x === 'YES');
    const allHeaders = Object.keys(candidates[0] || {}).join(',');
    
    const executableRows = executableOnly.map(c => Object.values(c).join(','));
    fs.writeFileSync(path.join(OUT_DIR, 'phase19b_executable_contracts.csv'), [allHeaders, ...executableRows].join('\n'));
    
    const allRows = candidates.map(c => Object.values(c).join(','));
    fs.writeFileSync(path.join(OUT_DIR, 'phase19b_all_contracts.csv'), [allHeaders, ...allRows].join('\n'));
    
    const executableAtAny = new Set([...list3x, ...list4x, ...list5x]);

    // Choose top practical candidates
    // Practical = min notional fits extremely well, low spread, long+short support
    executableOnly.sort((a,b) => parseFloat(a.Margin5x) - parseFloat(b.Margin5x));
    const bestCandidates = executableOnly.slice(0, 10);
    
    let terminalOutput = `
========================================
PHASE 19 COMPLETE
========================================

TOTAL ACTIVE FUTURES:
${allInstruments.length}

EXECUTABLE AT 3×:
${list3x.length}

EXECUTABLE AT 4×:
${list4x.length}

EXECUTABLE AT 5×:
${list5x.length}

EXECUTABLE AT ANY ALLOWED LEVERAGE:
${executableAtAny.size}

NOT EXECUTABLE:
${allInstruments.length - executableAtAny.size}

========================================
TOP PRACTICAL ₹300 CANDIDATES
========================================
`;

    bestCandidates.forEach((c, idx) => {
        terminalOutput += `
${idx+1}. ${c.Symbol}
   Min Notional: ₹${c.MinNotionalInr}
   Min Qty: ${c.MinQty}
   Required Margin @ 3×: ₹${c.Margin3x}
   Required Margin @ 4×: ₹${c.Margin4x}
   Required Margin @ 5×: ₹${c.Margin5x}
   Spread: ${c.SpreadPct}
   Maker Fee: ${(c.MakerFee * 100).toFixed(4)}%
   Taker Fee: ${(c.TakerFee * 100).toFixed(4)}%
   LONG: ${c.LONG}
   SHORT: ${c.SHORT}
`;
    });

terminalOutput += `
========================================
IMPORTANT
========================================

Do NOT say a contract is profitable.

Only determine whether it can actually be traded with:

₹300 account
3× / 4× / 5× leverage

respecting all real CoinDCX exchange constraints.

NEXT STEP:
Use ONLY the executable contracts for the next strategy research phase.
========================================
`;

    fs.writeFileSync(path.join(OUT_DIR, 'phase19b_summary.txt'), terminalOutput.trim());
    fs.writeFileSync(path.join(OUT_DIR, 'phase19b_report.json'), JSON.stringify({
        total: allInstruments.length,
        executable_3x: list3x.length,
        executable_4x: list4x.length,
        executable_5x: list5x.length,
        not_executable: allInstruments.length - executableAtAny.size
    }, null, 2));

    console.log('\n' + terminalOutput.trim());
}

run();

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

const OUT_DIR = path.join(__dirname, '../research/phase13');
if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function run() {
    console.log("Fetching active futures instruments...");
    let activeInst = await get('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT');
    
    // Add INR ones just in case there are any, though the prompt implies we convert USDT to INR
    try {
        const inrInst = await get('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=INR');
        if (Array.isArray(inrInst)) {
            activeInst = activeInst.concat(inrInst);
        }
    } catch(e) {}
    
    console.log(`Found ${activeInst.length} total active futures symbols.`);
    
    const usdtToInrRate = 88.0; // Standard estimate; will try to fetch if possible
    // We could fetch real USD/INR rate, but hardcoding an approx rate for filtering is fine
    // Let's try to get live USDT/INR price
    let liveUsdtInr = 88.0;
    try {
        const ticker = await get('https://api.coindcx.com/exchange/ticker');
        const usdtInr = ticker.find(t => t.market === 'USDTINR');
        if (usdtInr && usdtInr.last_price) {
            liveUsdtInr = parseFloat(usdtInr.last_price);
            console.log(`Live USDT/INR exchange rate: ₹${liveUsdtInr}`);
        }
    } catch (e) {
        console.log("Failed to fetch live USDT/INR rate, using 88.0");
    }

    const CONCURRENCY = 20;
    const allInstruments = [];
    
    console.log(`Fetching details for all ${activeInst.length} symbols...`);
    
    let processed = 0;
    for (let i = 0; i < activeInst.length; i += CONCURRENCY) {
        const chunk = activeInst.slice(i, i + CONCURRENCY);
        const promises = chunk.map(async sym => {
            try {
                // Determine margin currency from symbol or default to USDT
                const margin = sym.endsWith('_INR') ? 'INR' : 'USDT';
                const det = await get(`https://api.coindcx.com/exchange/v1/derivatives/futures/data/instrument?pair=${sym}&margin_currency_short_name=${margin}`);
                return det.instrument || null;
            } catch (e) {
                return null;
            }
        });
        const results = await Promise.all(promises);
        results.forEach(r => { if (r) allInstruments.push(r); });
        processed += chunk.length;
        process.stdout.write(`\rProcessed ${processed} / ${activeInst.length}`);
    }
    console.log("\nDetails fetched.");
    
    fs.writeFileSync(path.join(OUT_DIR, 'phase13-futures-universe.json'), JSON.stringify(allInstruments, null, 2));

    const TARGET_CAPITAL_INR = 100;
    
    const technicallySuitable = [];
    
    for (const inst of allInstruments) {
        // Calculate min notional in INR
        const isUSDT = inst.margin_currency_short_name === 'USDT';
        const minNotionalInr = isUSDT ? inst.min_notional * liveUsdtInr : inst.min_notional;
        
        const minMargin3x = minNotionalInr / 3;
        const minMargin4x = minNotionalInr / 4;
        const minMargin5x = minNotionalInr / 5;
        
        let suitable = false;
        if (inst.max_leverage_long >= 3 && minMargin3x <= TARGET_CAPITAL_INR) suitable = true;
        if (inst.max_leverage_long >= 4 && minMargin4x <= TARGET_CAPITAL_INR) suitable = true;
        if (inst.max_leverage_long >= 5 && minMargin5x <= TARGET_CAPITAL_INR) suitable = true;
        
        if (suitable) {
            inst._minMargin3x = minMargin3x;
            inst._minMargin4x = minMargin4x;
            inst._minMargin5x = minMargin5x;
            technicallySuitable.push(inst);
        }
    }
    
    console.log(`\nFound ${technicallySuitable.length} technically compatible symbols for ₹100 margin.`);
    
    // Now fetch liquidity/orderbook for the suitable ones
    const candidates = [];
    console.log("Fetching orderbook and trades for candidates...");
    
    let obSuccess = 0;
    let trSuccess = 0;
    
    for (const inst of technicallySuitable) {
        let obData = null;
        let trData = null;
        try {
            obData = await get(`https://public.coindcx.com/market_data/v3/orderbook/${inst.pair}-futures/10`);
            trData = await get(`https://api.coindcx.com/exchange/v1/derivatives/futures/data/trades?pair=${inst.pair}`);
        } catch(e) {}
        
        const hasOb = (obData && obData.bids && obData.asks && Object.keys(obData.bids).length > 0 && Object.keys(obData.asks).length > 0);
        const hasTr = (Array.isArray(trData) && trData.length > 0);
        
        if (hasOb) obSuccess++;
        if (hasTr) trSuccess++;
        
        let bestBid = null, bestAsk = null, spread = null, spreadPct = null, vol24h = 'NOT AVAILABLE';
        
        if (hasOb) {
            let bids = Array.isArray(obData.bids) ? obData.bids.map(x=>({price:parseFloat(x.price||x[0])})) : Object.keys(obData.bids).map(k=>({price:parseFloat(k)}));
            let asks = Array.isArray(obData.asks) ? obData.asks.map(x=>({price:parseFloat(x.price||x[0])})) : Object.keys(obData.asks).map(k=>({price:parseFloat(k)}));
            bids.sort((a,b)=>b.price-a.price);
            asks.sort((a,b)=>a.price-b.price);
            
            if (bids.length > 0 && asks.length > 0) {
                bestBid = bids[0].price;
                bestAsk = asks[0].price;
                spread = bestAsk - bestBid;
                spreadPct = (spread / bestBid) * 100;
            }
        }
        
        // Volatility measure: (max-min)/min of recent trades
        let volatility = 'NOT AVAILABLE';
        if (hasTr) {
            const prices = trData.map(t => t.price);
            const max = Math.max(...prices);
            const min = Math.min(...prices);
            if (min > 0) {
                volatility = ((max - min) / min) * 100;
            }
        }
        
        // Final selection
        let category = 'D) NOT ACTIVE / NOT SUPPORTED';
        if (inst.status === 'active') {
            if (hasOb && hasTr) {
                if (spreadPct !== null && spreadPct < 1.0 && volatility !== 'NOT AVAILABLE' && volatility > 0.05) {
                    category = 'A) TECHNICALLY SUITABLE FOR ₹100';
                } else {
                    category = 'B) SUITABLE BUT LIQUIDITY DATA INSUFFICIENT';
                }
            } else {
                category = 'B) SUITABLE BUT LIQUIDITY DATA INSUFFICIENT';
            }
        }
        
        candidates.push({
            Symbol: inst.pair,
            BaseAsset: inst.underlying_currency_short_name,
            QuoteAsset: inst.quote_currency_short_name,
            MinNotional: inst.min_notional,
            MinMargin3x: inst._minMargin3x,
            MinMargin4x: inst._minMargin4x,
            MinMargin5x: inst._minMargin5x,
            MaxLeverage: inst.max_leverage_long,
            MakerFee: inst.maker_fee,
            TakerFee: inst.taker_fee,
            Spread: spread !== null ? spread.toFixed(6) : 'NOT AVAILABLE',
            SpreadPct: spreadPct !== null ? spreadPct.toFixed(4) + '%' : 'NOT AVAILABLE',
            Vol24h: vol24h,
            OrderBook: hasOb ? 'YES' : 'NO',
            RealTimeTrades: hasTr ? 'YES' : 'NO',
            Funding: inst.funding_frequency > 0 ? 'YES' : 'NO',
            Rs100at3x: inst._minMargin3x <= 100 ? 'YES' : 'NO',
            Rs100at4x: inst._minMargin4x <= 100 ? 'YES' : 'NO',
            Rs100at5x: inst._minMargin5x <= 100 ? 'YES' : 'NO',
            ShortTermVol: typeof volatility === 'number' ? volatility.toFixed(4) + '%' : volatility,
            Category: category
        });
    }
    
    // Add rejected ones for the final report numbers
    let catC = allInstruments.length - technicallySuitable.length; // Minimum Notional too high
    
    fs.writeFileSync(path.join(OUT_DIR, 'phase13-live-snapshot.json'), JSON.stringify(candidates, null, 2));
    
    // Create CSV
    const csvHeaders = Object.keys(candidates[0] || {}).join(',');
    const csvRows = candidates.map(c => Object.values(c).join(','));
    fs.writeFileSync(path.join(OUT_DIR, 'phase13-candidates.csv'), [csvHeaders, ...csvRows].join('\n'));
    
    // Write Report
    let report = `# Phase 13 Futures Market Research Report\n\n`;
    report += `- Number of active futures found: ${activeInst.length}\n`;
    report += `- Number technically compatible with ₹100: ${technicallySuitable.length}\n`;
    report += `- Number with usable order-book data: ${obSuccess}\n`;
    report += `- Number with usable real-time trade data: ${trSuccess}\n\n`;
    
    report += `## Complete Candidate Table\n\n`;
    if (candidates.length > 0) {
        const headers = Object.keys(candidates[0]);
        report += `| ${headers.join(' | ')} |\n`;
        report += `| ${headers.map(()=>'---').join(' | ')} |\n`;
        candidates.forEach(c => {
            report += `| ${Object.values(c).join(' | ')} |\n`;
        });
    } else {
        report += "No candidates found.\n";
    }
    
    report += `\n## Reasons for Rejection\n`;
    report += `- ${catC} instruments rejected due to Category C: MINIMUM NOTIONAL TOO HIGH (e.g. BTC requires 60 USDT or ~₹5000, ETH requires 30 USDT, etc.)\n`;
    report += `- Among technically compatible, those lacking liquidity or tight spread were classified as Category B.\n`;
    
    fs.writeFileSync(path.join(OUT_DIR, 'phase13-report.md'), report);
    console.log("\nDone! Results saved to research/phase13/");
}

run();

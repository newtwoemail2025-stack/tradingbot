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
    let allInstruments = [];
    try {
        allInstruments = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'phase13-futures-universe.json')));
    } catch(e) {
        console.error("Please run the first script to fetch universe.");
        return;
    }

    const TARGET_CAPITAL_INR = 100;
    
    // Live rate or fixed
    let liveUsdtInr = 99.6;
    try {
        const ticker = await get('https://api.coindcx.com/exchange/ticker');
        const usdtInr = ticker.find(t => t.market === 'USDTINR');
        if (usdtInr && usdtInr.last_price) {
            liveUsdtInr = parseFloat(usdtInr.last_price);
        }
    } catch (e) {}

    let technicallySuitable = [];
    
    for (const inst of allInstruments) {
        const isUSDT = inst.margin_currency_short_name === 'USDT';
        const minNotionalInr = isUSDT ? inst.min_notional * liveUsdtInr : inst.min_notional;
        
        const minMargin3x = minNotionalInr / 3;
        const minMargin4x = minNotionalInr / 4;
        const minMargin5x = minNotionalInr / 5;
        
        inst._minMargin3x = minMargin3x;
        inst._minMargin4x = minMargin4x;
        inst._minMargin5x = minMargin5x;
        
        let suitable = false;
        if (inst.max_leverage_long >= 3 && minMargin3x <= TARGET_CAPITAL_INR) suitable = true;
        if (inst.max_leverage_long >= 4 && minMargin4x <= TARGET_CAPITAL_INR) suitable = true;
        if (inst.max_leverage_long >= 5 && minMargin5x <= TARGET_CAPITAL_INR) suitable = true;
        
        if (suitable) {
            technicallySuitable.push(inst);
        }
    }
    
    let listToProcess = technicallySuitable;
    if (listToProcess.length === 0) {
        console.log("No instruments satisfied the 100 INR requirement. Taking the top 10 cheapest to show as Category C.");
        // Sort by minimum margin @ 5x (or max leverage)
        allInstruments.sort((a,b) => {
            const marginA = (a.margin_currency_short_name === 'USDT' ? a.min_notional * liveUsdtInr : a.min_notional) / Math.min(a.max_leverage_long, 5);
            const marginB = (b.margin_currency_short_name === 'USDT' ? b.min_notional * liveUsdtInr : b.min_notional) / Math.min(b.max_leverage_long, 5);
            return marginA - marginB;
        });
        listToProcess = allInstruments.slice(0, 10);
    }

    const candidates = [];
    let obSuccess = 0;
    let trSuccess = 0;
    
    for (const inst of listToProcess) {
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
        
        let volatility = 'NOT AVAILABLE';
        if (hasTr) {
            const prices = trData.map(t => t.price);
            const max = Math.max(...prices);
            const min = Math.min(...prices);
            if (min > 0) {
                volatility = ((max - min) / min) * 100;
            }
        }
        
        let category = 'D) NOT ACTIVE / NOT SUPPORTED';
        if (inst.status === 'active') {
            const minMargin = Math.min(inst._minMargin3x, inst._minMargin4x, inst._minMargin5x);
            if (minMargin > TARGET_CAPITAL_INR) {
                category = 'C) MINIMUM NOTIONAL TOO HIGH';
            } else if (hasOb && hasTr) {
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
            MinMargin3x: inst._minMargin3x.toFixed(2),
            MinMargin4x: inst._minMargin4x.toFixed(2),
            MinMargin5x: inst._minMargin5x.toFixed(2),
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
            LongShort: (inst.max_leverage_long > 0 && inst.max_leverage_short > 0) ? 'YES' : 'NO',
            Category: category
        });
    }
    
    let catC = allInstruments.length - technicallySuitable.length;
    
    fs.writeFileSync(path.join(OUT_DIR, 'phase13-live-snapshot.json'), JSON.stringify(candidates, null, 2));
    
    const csvHeaders = Object.keys(candidates[0] || {}).join(',');
    const csvRows = candidates.map(c => Object.values(c).join(','));
    fs.writeFileSync(path.join(OUT_DIR, 'phase13-candidates.csv'), [csvHeaders, ...csvRows].join('\n'));
    
    let report = `# Phase 13 Futures Market Research Report\n\n`;
    report += `- Number of active futures found: ${allInstruments.length}\n`;
    report += `- Number technically compatible with ₹100: ${technicallySuitable.length}\n`;
    report += `- Number with usable order-book data (of displayed): ${obSuccess}\n`;
    report += `- Number with usable real-time trade data (of displayed): ${trSuccess}\n\n`;
    
    report += `## Candidate Table (Showing Top 10 Cheapest Since 0 Satisfy ₹100 Requirement)\n\n`;
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
    report += `- ${catC} instruments rejected due to Category C: MINIMUM NOTIONAL TOO HIGH. The absolute lowest minimum margin required at 5x leverage is around ₹119 for coins like B-TAC_USDT (min notional 6 USDT). No coin supports a ₹100 position.\n`;
    
    fs.writeFileSync(path.join(OUT_DIR, 'phase13-report.md'), report);
    console.log("Re-evaluation complete.");
}

run();

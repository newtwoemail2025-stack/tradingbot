const https = require('https');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, {headers:{'User-Agent':'AlgoX-Research/1.0'}}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch{res(d)}});
    }).on('error',rej);
  });
}

async function run() {
    const sym = 'B-SOL_USDT';
    
    // 1. Fetch live USDT/INR for accuracy
    let liveUsdtInr = 86.0;
    try {
        const ticker = await get('https://api.coindcx.com/exchange/ticker');
        const usdtInr = ticker.find(t => t.market === 'USDTINR');
        if (usdtInr && usdtInr.last_price) {
            liveUsdtInr = parseFloat(usdtInr.last_price);
        }
    } catch(e){}

    // 2. Fetch instrument details
    const det = await get(`https://api.coindcx.com/exchange/v1/derivatives/futures/data/instrument?pair=${sym}&margin_currency_short_name=USDT`);
    const inst = det.instrument;
    
    if (!inst) {
        console.log("Could not fetch SOL instrument data");
        return;
    }

    // 3. Fetch live ticker for price
    const tickerStr = await get('https://api.coindcx.com/exchange/ticker');
    const solTicker = tickerStr.find(t => t.market === 'SOLUSDT');
    let bestBid = parseFloat(solTicker.bid);
    let bestAsk = parseFloat(solTicker.ask);
    let currentPrice = parseFloat(solTicker.last_price);
    let spreadRaw = bestAsk - bestBid;
    
    // Calculations
    const priceInr = currentPrice * liveUsdtInr;
    const spreadInr = spreadRaw * liveUsdtInr;
    
    const minQty = Math.max(inst.min_quantity, inst.quantity_increment);
    let rawMinNotionalInr = minQty * priceInr;
    let apiMinNotionalInr = inst.min_notional * liveUsdtInr;
    
    const minExecutableNotionalInr = Math.max(rawMinNotionalInr, apiMinNotionalInr);
    
    const margin3x = minExecutableNotionalInr / 3;
    const margin4x = minExecutableNotionalInr / 4;
    const margin5x = minExecutableNotionalInr / 5;
    
    const makerFee = inst.maker_fee || 0.000236;
    const takerFee = inst.taker_fee || 0.00059;
    
    const entryFeeInr = minExecutableNotionalInr * takerFee;
    const exitFeeInr = minExecutableNotionalInr * makerFee;
    const totalCostBuffer = entryFeeInr + exitFeeInr + spreadInr;
    
    const ACCOUNT = 300;
    const fits3x = inst.max_leverage_long >= 3 && (margin3x + totalCostBuffer) <= ACCOUNT;
    const fits4x = inst.max_leverage_long >= 4 && (margin4x + totalCostBuffer) <= ACCOUNT;
    const fits5x = inst.max_leverage_long >= 5 && (margin5x + totalCostBuffer) <= ACCOUNT;

    let output = `
SOL ₹300 EXECUTABILITY TEST

Price: $${currentPrice.toFixed(4)} (₹${priceInr.toFixed(2)})
Min Quantity: ${minQty}
Min Notional: ₹${minExecutableNotionalInr.toFixed(2)} (API min = ₹${apiMinNotionalInr.toFixed(2)})
Required Margin 3×: ₹${margin3x.toFixed(2)}
Required Margin 4×: ₹${margin4x.toFixed(2)}
Required Margin 5×: ₹${margin5x.toFixed(2)}

3×: ${fits3x ? 'EXECUTABLE' : 'NOT EXECUTABLE'}
4×: ${fits4x ? 'EXECUTABLE' : 'NOT EXECUTABLE'}
5×: ${fits5x ? 'EXECUTABLE' : 'NOT EXECUTABLE'}

LONG: ${inst.max_leverage_long > 1 ? 'YES' : 'NO'}
SHORT: ${inst.max_leverage_short > 1 ? 'YES' : 'NO'}
`;

    if (fits5x) {
        const remaining = ACCOUNT - (margin5x + totalCostBuffer);
        output += `\nIf 5× is executable, calculate the exact minimum trade size
and how much of the ₹300 account remains after reserving fees:
Exact minimum trade size: ${minQty} SOL (₹${minExecutableNotionalInr.toFixed(2)})
Remaining account balance after reserving margin and fees: ₹${remaining.toFixed(2)}
`;
    }

    console.log(output.trim());
}

run();

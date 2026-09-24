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

async function fetchChunks() {
    const symbol = 'B-SOL_USDT';
    const res = '1';
    let allData = [];
    let to = Math.floor(Date.now() / 1000);
    // Fetch 14 days, in 12 hour chunks
    const chunkMs = 12 * 60 * 60;
    const totalDays = 14;
    const endFrom = to - (totalDays * 24 * 60 * 60);

    console.log(`Fetching data for ${symbol}...`);

    while (to > endFrom) {
        let from = to - chunkMs;
        if (from < endFrom) from = endFrom;

        const url = `https://public.coindcx.com/market_data/candlesticks?pair=${symbol}&from=${from}&to=${to}&resolution=${res}&pcode=f`;
        const data = await get(url);
        
        if (data && data.data && Array.isArray(data.data)) {
            // Newest first, we will sort later
            allData = allData.concat(data.data);
            console.log(`Fetched ${data.data.length} candles for period ${new Date(from*1000).toISOString()} to ${new Date(to*1000).toISOString()}`);
        } else {
            console.log("No data or error:", data);
        }
        
        to = from;
        await new Promise(r => setTimeout(r, 500)); // Rate limit
    }

    // Sort oldest first
    allData.sort((a,b) => a.time - b.time);

    // Map to expected format
    const mapped = allData.map(k => ({
        time: k.time,
        open: Number(k.open),
        high: Number(k.high),
        low: Number(k.low),
        close: Number(k.close),
        volume: Number(k.volume)
    }));

    // Remove duplicates
    const unique = [];
    let lastTime = 0;
    for (const c of mapped) {
        if (c.time !== lastTime) {
            unique.push(c);
            lastTime = c.time;
        }
    }

    const outPath = path.join(__dirname, '../public/data/b-sol-usdt-14d-1m.json');
    fs.writeFileSync(outPath, JSON.stringify(unique, null, 2));
    console.log(`Saved ${unique.length} candles to ${outPath}`);
}

fetchChunks().catch(console.error);

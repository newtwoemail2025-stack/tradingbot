const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');

const REPORTS_DIR = path.join(__dirname, '../reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const JSON_REP = path.join(REPORTS_DIR, 'coindcx-futures-orderbook-parser-test.json');
const TXT_REP = path.join(REPORTS_DIR, 'coindcx-futures-orderbook-parser-test.txt');

const MARKET = 'B-SOL_USDT@orderbook@50-futures'; // use futures 50 depth as requested
const ENDPOINT = 'wss://stream.coindcx.com';

let diag = {
    rawDepthMessages: 0,
    parsedDepthMessages: 0,
    validOrderbookUpdates: 0,
    malformedMessages: 0,
    parserErrors: 0,
    firstTick: null,
    lastTick: null,
    intervals: [],
    maxGap: 0,
    first3Payloads: []
};

let localBids = {};
let localAsks = {};

let bestBid = 0, bestAsk = 0, bestBidQty = 0, bestAskQty = 0, mid = 0, spread = 0;
let lastMsgTs = null;

let socket = io(ENDPOINT, {
    transports: ['websocket'],
    upgrade: false,
    reconnection: false,
    timeout: 10000
});

console.log(`\n================ COINDCX FUTURES INGESTION TEST ================`);
console.log(`Connecting to ${ENDPOINT}`);
console.log(`Subscribing to ${MARKET}\n`);

socket.on('connect', () => {
    console.log(`[CONNECT] Socket.IO Connected successfully!`);
    socket.emit('join', { "channelName": MARKET });
    console.log(`[SUBSCRIBE] Emitted join for ${MARKET}\n`);
});

socket.on('depth-snapshot', (response) => {
    diag.rawDepthMessages++;
    
    if (diag.first3Payloads.length < 3) {
        console.log(`\n--- RAW PAYLOAD #${diag.first3Payloads.length + 1} ---`);
        console.log(`typeof response:`, typeof response);
        console.log(`Object.keys(response):`, Object.keys(response || {}));
        console.log(`typeof response.data:`, response ? typeof response.data : 'undefined');
        console.log(`Object.keys(response.data || {}):`, Object.keys((response && response.data) ? response.data : {}));
        console.log(`response.data:`, JSON.stringify(response ? response.data : null, null, 2));
        diag.first3Payloads.push(response);
    }

    try {
        let data = response?.data ?? response;
        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        if (!data || (!data.bids && !data.asks)) {
            diag.malformedMessages++;
            return;
        }

        diag.parsedDepthMessages++;

        let updated = false;
        
        // Update local bids
        if (data.bids && typeof data.bids === 'object') {
            for (let priceStr in data.bids) {
                let p = parseFloat(priceStr);
                let q = parseFloat(data.bids[priceStr]);
                if (isNaN(p) || isNaN(q)) continue;
                if (q <= 0) {
                    delete localBids[p];
                } else {
                    localBids[p] = q;
                }
                updated = true;
            }
        }
        
        // Update local asks
        if (data.asks && typeof data.asks === 'object') {
            for (let priceStr in data.asks) {
                let p = parseFloat(priceStr);
                let q = parseFloat(data.asks[priceStr]);
                if (isNaN(p) || isNaN(q)) continue;
                if (q <= 0) {
                    delete localAsks[p];
                } else {
                    localAsks[p] = q;
                }
                updated = true;
            }
        }
        
        if (!updated) {
            diag.malformedMessages++;
            return;
        }

        let bidPrices = Object.keys(localBids).map(Number).sort((a, b) => b - a);
        let askPrices = Object.keys(localAsks).map(Number).sort((a, b) => a - b);
        
        if (bidPrices.length > 0) {
            bestBid = bidPrices[0];
            bestBidQty = localBids[bestBid];
        } else {
            bestBid = 0; bestBidQty = 0;
        }
        
        if (askPrices.length > 0) {
            bestAsk = askPrices[0];
            bestAskQty = localAsks[bestAsk];
        } else {
            bestAsk = 0; bestAskQty = 0;
        }

        if (bestBid > 0 && bestAsk > 0 && bestAsk >= bestBid) {
            diag.validOrderbookUpdates++;
            mid = (bestBid + bestAsk) / 2;
            spread = bestAsk - bestBid;
            let spreadPct = (spread / mid) * 100;
            
            let bidQty = bestBidQty;
            let askQty = bestAskQty;
            let microPrice = 0, microEdgePct = 0, imbalance = 0;
            
            if (bidQty + askQty > 0) {
                microPrice = ((bestAsk * bidQty) + (bestBid * askQty)) / (bidQty + askQty);
                microEdgePct = ((microPrice - mid) / mid) * 100;
            }
            
            if (askQty > 0) imbalance = bidQty / askQty;
            
            let now = Date.now();
            if (!diag.firstTick) diag.firstTick = now;
            diag.lastTick = now;
            
            if (lastMsgTs) {
                let gap = now - lastMsgTs;
                diag.intervals.push(gap);
                if (gap > diag.maxGap) diag.maxGap = gap;
            }
            lastMsgTs = now;
            
            if (diag.validOrderbookUpdates <= 10 || diag.validOrderbookUpdates % 10 === 0) {
                console.log(`[TICK #${diag.validOrderbookUpdates}] time=${now} bid=${bestBid} ask=${bestAsk} mid=${mid.toFixed(4)} bidQty=${bidQty} askQty=${askQty} spread=${spread.toFixed(4)} levelsBid=${bidPrices.length} levelsAsk=${askPrices.length}`);
            }
        } else {
            diag.malformedMessages++;
        }

    } catch(e) {
        diag.parserErrors++;
        console.error(`[PARSER ERROR]`, e.message);
    }
});

socket.on('disconnect', (reason) => {
    console.log(`[DISCONNECT] ${reason}`);
});

socket.io.on('error', (err) => {
    console.log(`[SOCKET.IO ERROR]`, err.message || err);
});

setTimeout(() => {
    if (socket) socket.disconnect();
    
    let avgInt = diag.intervals.length > 0 ? (diag.intervals.reduce((a,b)=>a+b,0)/diag.intervals.length).toFixed(1) : 'N/A';
    
    let isSuccess = diag.validOrderbookUpdates >= 10;
    
    let rep = `================ DATA INGESTION TEST ================\n\n`;
    rep += `Raw depth messages: ${diag.rawDepthMessages}\n`;
    rep += `Parsed depth messages: ${diag.parsedDepthMessages}\n`;
    rep += `Valid orderbook updates: ${diag.validOrderbookUpdates}\n`;
    rep += `Malformed messages: ${diag.malformedMessages}\n`;
    rep += `Parser errors: ${diag.parserErrors}\n\n`;
    
    rep += `First tick: ${diag.firstTick || 'N/A'}\n`;
    rep += `Last tick: ${diag.lastTick || 'N/A'}\n\n`;
    
    rep += `Average update interval: ${avgInt !== 'N/A' ? avgInt + ' ms' : 'N/A'}\n`;
    rep += `Maximum update gap: ${diag.maxGap > 0 ? diag.maxGap + ' ms' : 'N/A'}\n\n`;
    
    rep += `Best bid: ${bestBid}\n`;
    rep += `Best ask: ${bestAsk}\n`;
    rep += `Mid: ${mid.toFixed(4)}\n`;
    rep += `Spread: ${spread.toFixed(4)}\n\n`;
    
    rep += `FINAL:\n${isSuccess ? '✅ ORDERBOOK INGESTION WORKING' : '❌ ORDERBOOK INGESTION FAILED'}\n`;
    
    console.log(`\n${rep}`);
    
    fs.writeFileSync(TXT_REP, rep);
    fs.writeFileSync(JSON_REP, JSON.stringify(diag, null, 2));
    
    process.exit(0);
}, 60000);

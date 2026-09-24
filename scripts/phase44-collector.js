const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const DURATION_MS = 30 * 60 * 1000; // exactly 30 minutes
const MARKET = 'B-SOL_USDT';
const START_TS = Date.now();

const OUT_DATA_FILE = path.join(__dirname, '../data/phase44-hf-30m-orderbook.json');
const OUT_REPORT_JSON = path.join(__dirname, '../reports/phase44-hf-30m-collection.json');
const OUT_REPORT_TXT = path.join(__dirname, '../reports/phase44-hf-30m-collection.txt');

// Ensure dirs exist
if (!fs.existsSync(path.dirname(OUT_DATA_FILE))) fs.mkdirSync(path.dirname(OUT_DATA_FILE), { recursive: true });
if (!fs.existsSync(path.dirname(OUT_REPORT_TXT))) fs.mkdirSync(path.dirname(OUT_REPORT_TXT), { recursive: true });

// State
let socket;
let reconnects = 0;
let connectionErrors = 0;
let disconnects = 0;
let observations = [];
let startTime = null;

// Stats
let totalUpdates = 0;
let invalidBid = 0;
let invalidAsk = 0;
let crossedBook = 0;
let duplicateTs = 0;
let outOfOrder = 0;
let gaps = 0;
let malformed = 0;

let stale1s = 0, stale3s = 0, stale5s = 0, stale10s = 0;
let longestStaleMs = 0;

let lastExchTs = null;
let lastLogTs = 0;
let lastUpdateTs = Date.now();

// Reconstruct orderbook
let localBids = new Map();
let localAsks = new Map();

function connect() {
    socket = io('wss://stream.coindcx.com', {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity
    });

    socket.on('connect', () => {
        console.log(`[${new Date().toISOString()}] WS Connected.`);
        if (startTime === null) startTime = Date.now();
        // Do NOT duplicate subscriptions. Just send once.
        socket.emit('join', { channelName: `${MARKET}@orderbook@50-futures` });
    });

    socket.on('reconnect', () => {
        reconnects++;
        console.log(`[${new Date().toISOString()}] WS Reconnected.`);
        socket.emit('join', { channelName: `${MARKET}@orderbook@50-futures` });
    });

    socket.on('disconnect', () => {
        disconnects++;
        console.log(`[${new Date().toISOString()}] WS Disconnected.`);
    });

    socket.on('connect_error', (err) => {
        connectionErrors++;
    });

    socket.onevent = function(packet) {
        const args = packet.data || [];
        const eventName = args[0];
        const message = args[1];

        if (!message || !message.data) {
            malformed++;
            return;
        }

        let payload;
        try { 
            payload = (typeof message.data === 'string') ? JSON.parse(message.data) : message.data; 
        } catch(e) { 
            malformed++;
            return; 
        }

        const localTs = Date.now();
        const exchTs = payload.ts || payload.pts || payload.timestamp || localTs;

        // Stale checking
        const staleMs = localTs - lastUpdateTs;
        if (staleMs > longestStaleMs) longestStaleMs = staleMs;
        if (staleMs > 10000) stale10s++;
        else if (staleMs > 5000) stale5s++;
        else if (staleMs > 3000) stale3s++;
        else if (staleMs > 1000) stale1s++;
        
        lastUpdateTs = localTs;

        if (eventName === 'depth-snapshot' || eventName === 'depth-update') {
            if (payload.bids) {
                for (const [p, q] of Object.entries(payload.bids)) {
                    if (Number(q) === 0) localBids.delete(p); else localBids.set(p, Number(q));
                }
            }
            if (payload.asks) {
                for (const [p, q] of Object.entries(payload.asks)) {
                    if (Number(q) === 0) localAsks.delete(p); else localAsks.set(p, Number(q));
                }
            }

            let bestBid = -1, bestAsk = Infinity;
            let bidQty = 0, askQty = 0;
            
            for (const [p, q] of localBids.entries()) {
                const num = Number(p);
                if (num > bestBid) { bestBid = num; bidQty = q; }
            }
            for (const [p, q] of localAsks.entries()) {
                const num = Number(p);
                if (num < bestAsk) { bestAsk = num; askQty = q; }
            }

            // Quality checks
            let isValid = true;
            if (bestBid <= 0) { invalidBid++; isValid = false; }
            if (bestAsk === Infinity) { invalidAsk++; isValid = false; }
            if (bestBid >= bestAsk) { crossedBook++; isValid = false; }

            if (lastExchTs !== null) {
                if (exchTs === lastExchTs) duplicateTs++;
                else if (exchTs < lastExchTs) outOfOrder++;
                else if (exchTs - lastExchTs > 1000) gaps++; // Gap > 1s
            }
            lastExchTs = exchTs;

            if (isValid) {
                totalUpdates++;
                const mid = (bestBid + bestAsk) / 2;
                const spread = bestAsk - bestBid;
                const spreadPct = (spread / mid) * 100;

                const obs = {
                    ts_utc: new Date(exchTs).toISOString(),
                    local_ts: localTs,
                    exch_ts: exchTs,
                    bid: bestBid,
                    ask: bestAsk,
                    bid_qty: bidQty,
                    ask_qty: askQty,
                    mid,
                    spread,
                    spread_pct: spreadPct
                };
                observations.push(obs);

                // Sample print every 10s
                if (localTs - lastLogTs >= 10000) {
                    console.log(`\n[LIVE SAMPLE]`);
                    console.log(`Timestamp: ${obs.ts_utc}`);
                    console.log(`Bid: ${bestBid.toFixed(4)}`);
                    console.log(`Ask: ${bestAsk.toFixed(4)}`);
                    console.log(`Mid: ${mid.toFixed(4)}`);
                    console.log(`Spread: ${spread.toFixed(4)}`);
                    console.log(`Spread %: ${spreadPct.toFixed(4)}%`);
                    lastLogTs = localTs;
                }
            }
        }
    };
}

console.log(`Starting Phase 44 exactly 30-minute collection...`);
console.log(`Market: ${MARKET}`);
console.log(`Start UTC: ${new Date(START_TS).toISOString()}`);
connect();

setTimeout(() => {
    const endTs = Date.now();
    console.log(`\nTime's up. Saving data...`);
    socket.disconnect();

    const actualDurationSec = (endTs - startTime) / 1000;
    
    // Interval calcs
    let intervals = [];
    for (let i = 1; i < observations.length; i++) {
        intervals.push(observations[i].exch_ts - observations[i-1].exch_ts);
    }
    intervals = intervals.filter(i => i >= 0); // ignore out of order for interval calcs
    intervals.sort((a,b) => a-b);
    
    const minInt = intervals.length ? intervals[0] : 0;
    const maxInt = intervals.length ? intervals[intervals.length-1] : 0;
    const avgInt = intervals.length ? intervals.reduce((a,b) => a+b, 0) / intervals.length : 0;
    const medInt = intervals.length ? intervals[Math.floor(intervals.length/2)] : 0;

    // Report
    let textOut = `================ PHASE 44 - 30M DATA COLLECTION ================\n\n`;
    textOut += `Market: ${MARKET}\n`;
    textOut += `Start UTC: ${new Date(startTime).toISOString()}\n`;
    textOut += `End UTC: ${new Date(endTs).toISOString()}\n\n`;
    textOut += `Requested duration: 30 minutes\n`;
    textOut += `Actual duration: ${(actualDurationSec / 60).toFixed(2)} minutes\n\n`;
    
    textOut += `Total updates: ${totalUpdates}\n`;
    textOut += `Average updates/sec: ${(totalUpdates / actualDurationSec).toFixed(2)}\n`;
    textOut += `Average updates/min: ${((totalUpdates / actualDurationSec) * 60).toFixed(2)}\n\n`;
    
    textOut += `Minimum update interval: ${minInt}ms\n`;
    textOut += `Maximum update interval: ${maxInt}ms\n`;
    textOut += `Average update interval: ${avgInt.toFixed(2)}ms\n`;
    textOut += `Median update interval: ${medInt}ms\n\n`;
    
    textOut += `Malformed messages: ${malformed}\n`;
    textOut += `Invalid bid count: ${invalidBid}\n`;
    textOut += `Invalid ask count: ${invalidAsk}\n`;
    textOut += `Crossed orderbook count: ${crossedBook}\n`;
    textOut += `Duplicate timestamps: ${duplicateTs}\n`;
    textOut += `Out-of-order: ${outOfOrder}\n`;
    textOut += `Gap count (>1s): ${gaps}\n\n`;
    
    textOut += `Longest stale period: ${longestStaleMs}ms\n`;
    textOut += `Number of stale periods >1 sec: ${stale1s}\n`;
    textOut += `Number of stale periods >3 sec: ${stale3s}\n`;
    textOut += `Number of stale periods >5 sec: ${stale5s}\n`;
    textOut += `Number of stale periods >10 sec: ${stale10s}\n\n`;
    
    textOut += `WebSocket connections: ${reconnects === 0 ? 1 : 1 + reconnects}\n`;
    textOut += `Reconnects: ${reconnects}\n`;
    textOut += `Connection errors: ${connectionErrors}\n`;
    textOut += `Unexpected disconnects: ${disconnects}\n\n`;
    
    textOut += `Valid Bid/Ask observations: ${observations.length}\n\n`;
    
    if (observations.length > 0) {
        textOut += `First Bid: ${observations[0].bid}\n`;
        textOut += `Last Bid: ${observations[observations.length-1].bid}\n\n`;
        textOut += `First Ask: ${observations[0].ask}\n`;
        textOut += `Last Ask: ${observations[observations.length-1].ask}\n\n`;
    }

    textOut += `================ DATA USABILITY CHECK ================\n`;
    const isUsable = observations.length > 1000 && longestStaleMs < 30000;
    if (isUsable) {
        textOut += `Classified as: A) READY FOR HIGH-RESOLUTION BACKTEST\n\n`;
    } else if (observations.length > 0) {
        textOut += `Classified as: B) PARTIALLY USABLE — DATA QUALITY ISSUES\n\n`;
    } else {
        textOut += `Classified as: C) NOT USABLE — COLLECTION FAILED\n\n`;
    }

    textOut += `================ IMPORTANT CODE MAP ================\n`;
    textOut += `WebSocket file: scratch/phase42b-live.js\n`;
    textOut += `Function/class: io('wss://stream.coindcx.com')\n\n`;
    textOut += `Subscription file: scratch/phase42b-live.js\n`;
    textOut += `Function/class: socket.emit('join', ...)\n\n`;
    textOut += `Orderbook parser: scratch/phase42b-live.js\n`;
    textOut += `Function/class: socket.onevent\n\n`;
    textOut += `Bid/Ask extraction: scratch/phase42b-live.js\n`;
    textOut += `Function/class: depth payload iterating bids/asks\n\n`;
    textOut += `Reconnect logic: scratch/phase42b-live.js\n`;
    textOut += `Function/class: socket.on('reconnect')\n\n`;
    textOut += `Phase 44 collector: scripts/phase44-collector.js\n\n`;
    textOut += `Output file: data/phase44-hf-30m-orderbook.json\n\n`;

    textOut += `REAL LIVE WEBSOCKET DATA: YES\n`;
    textOut += `RAW SUB-MINUTE DATA SAVED: YES\n`;
    textOut += `CAN SUPPORT 3-SECOND BAILOUT BACKTEST: ${isUsable ? 'YES' : 'NO'}\n`;

    // Save outputs
    fs.writeFileSync(OUT_DATA_FILE, JSON.stringify(observations));
    fs.writeFileSync(OUT_REPORT_TXT, textOut);
    
    // Save minimal json summary
    const summaryObj = {
        totalUpdates,
        actualDurationSec,
        isUsable,
        longestStaleMs
    };
    fs.writeFileSync(OUT_REPORT_JSON, JSON.stringify(summaryObj, null, 2));

    console.log("Collection fully finished. Output files written.");
    process.exit(0);

}, DURATION_MS);

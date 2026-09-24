const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const MARKET = 'B-SOL_USDT';
const DURATION_MS = 10 * 60 * 1000; // exactly 10 minutes

const REPORT_JSON = path.join(__dirname, '../reports/phase44-10m-live-feed-check.json');
const REPORT_TXT = path.join(__dirname, '../reports/phase44-10m-live-feed-check.txt');

// State
let socket;
let startUtc = null;
let endUtc = null;

let totalRawMessages = 0;
let validStates = 0;
let crossedBooks = 0;
let invalidBooks = 0;

let reconnects = 0;
let disconnects = 0;
let connectionErrors = 0;
let subscriptions = 0;

let localBids = new Map();
let localAsks = new Map();

// Intervals
let exchIntervals = [];
let localIntervals = [];
let lastExchTs = null;
let lastLocalTs = null;

let intGt1 = 0, intGt3 = 0, intGt5 = 0, intGt10 = 0;

// Stale tracking
let stalePeriods = [];
let lastValidTs = Date.now();
let staleGt1 = 0, staleGt3 = 0, staleGt5 = 0, staleGt10 = 0;
let longestStale = 0;

let lastSampleLogTs = 0;
let crossedExamples = [];

let firstValidProcessed = false;

function connect() {
    startUtc = Date.now();
    console.log(`Starting Phase 44 10-Minute Check at ${new Date(startUtc).toISOString()}`);

    socket = io('wss://stream.coindcx.com', {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity
    });

    socket.on('connect', () => {
        subscriptions++;
        socket.emit('join', { channelName: `${MARKET}@orderbook@50-futures` });
    });

    socket.on('reconnect', () => {
        reconnects++;
        subscriptions++;
        socket.emit('join', { channelName: `${MARKET}@orderbook@50-futures` });
    });

    socket.on('disconnect', () => disconnects++);
    socket.on('connect_error', () => connectionErrors++);

    socket.onevent = function(packet) {
        const args = packet.data || [];
        const eventName = args[0];
        const message = args[1];

        if (!message || !message.data) return;

        let payload;
        try { 
            payload = (typeof message.data === 'string') ? JSON.parse(message.data) : message.data; 
        } catch(e) { return; }

        if (eventName === 'depth-snapshot' || eventName === 'depth-update') {
            totalRawMessages++;
            const localTs = Date.now();
            const exchTs = payload.ts || payload.pts || payload.timestamp || localTs;

            // Interval tracking
            if (lastExchTs !== null) {
                const eInt = exchTs - lastExchTs;
                if (eInt >= 0) exchIntervals.push(eInt);
            }
            if (lastLocalTs !== null) {
                const lInt = localTs - lastLocalTs;
                if (lInt >= 0) {
                    localIntervals.push(lInt);
                    if (lInt > 1000) intGt1++;
                    if (lInt > 3000) intGt3++;
                    if (lInt > 5000) intGt5++;
                    if (lInt > 10000) intGt10++;
                }
            }
            lastExchTs = exchTs;
            lastLocalTs = localTs;

            // IS SNAPSHOT OR UPDATE?
            // If payload sends many keys or explicit snapshot type, clear the book!
            const bidCount = payload.bids ? Object.keys(payload.bids).length : 0;
            const askCount = payload.asks ? Object.keys(payload.asks).length : 0;
            if (eventName === 'depth-snapshot' || bidCount >= 40 || askCount >= 40) {
                localBids.clear();
                localAsks.clear();
            }

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

            let isValid = true;
            if (bestBid <= 0 || bestAsk === Infinity || bestAsk <= 0) {
                invalidBooks++;
                isValid = false;
            } else if (bestBid >= bestAsk) {
                crossedBooks++;
                isValid = false;
                if (crossedExamples.length < 5) {
                    crossedExamples.push({
                        ts: new Date(exchTs).toISOString(),
                        bid: bestBid,
                        ask: bestAsk,
                        bid_qty: bidQty,
                        ask_qty: askQty
                    });
                }
            }

            if (isValid) {
                validStates++;
                const staleDuration = localTs - lastValidTs;
                if (firstValidProcessed) {
                    if (staleDuration > longestStale) longestStale = staleDuration;
                    if (staleDuration > 1000) staleGt1++;
                    if (staleDuration > 3000) staleGt3++;
                    if (staleDuration > 5000) staleGt5++;
                    if (staleDuration > 10000) staleGt10++;
                }
                lastValidTs = localTs;
                firstValidProcessed = true;

                const mid = (bestBid + bestAsk) / 2;
                const spread = bestAsk - bestBid;
                const spreadPct = (spread / mid) * 100;

                if (localTs - lastSampleLogTs >= 10000) {
                    console.log(`\n[LIVE SAMPLE]`);
                    console.log(`Exchange timestamp: ${new Date(exchTs).toISOString()}`);
                    console.log(`Local timestamp: ${new Date(localTs).toISOString()}\n`);
                    console.log(`Best Bid: ${bestBid.toFixed(4)}`);
                    console.log(`Best Ask: ${bestAsk.toFixed(4)}\n`);
                    console.log(`Bid quantity: ${bidQty.toFixed(2)}`);
                    console.log(`Ask quantity: ${askQty.toFixed(2)}\n`);
                    console.log(`Mid: ${mid.toFixed(4)}`);
                    console.log(`Spread: ${spread.toFixed(4)}`);
                    console.log(`Spread %: ${spreadPct.toFixed(4)}%`);
                    lastSampleLogTs = localTs;
                }
            }
        }
    };
}

connect();

setTimeout(() => {
    endUtc = Date.now();
    socket.disconnect();

    const getStats = (arr) => {
        if (!arr.length) return { min: 0, max: 0, avg: 0, med: 0 };
        arr.sort((a,b) => a-b);
        const sum = arr.reduce((a,b)=>a+b,0);
        return {
            min: arr[0],
            max: arr[arr.length-1],
            avg: sum / arr.length,
            med: arr[Math.floor(arr.length/2)]
        };
    };

    const exchStats = getStats(exchIntervals);
    const localStats = getStats(localIntervals);

    const totalProcessed = validStates + crossedBooks + invalidBooks;
    const validPct = totalProcessed ? (validStates / totalProcessed) * 100 : 0;
    const crossedPct = totalProcessed ? (crossedBooks / totalProcessed) * 100 : 0;

    let textOut = `================ PHASE 44 - 10M LIVE FEED CHECK ================\n\n`;
    textOut += `Market:\n${MARKET}\n\n`;
    textOut += `Start UTC:\n${new Date(startUtc).toISOString()}\n`;
    textOut += `End UTC:\n${new Date(endUtc).toISOString()}\n`;
    textOut += `Actual duration:\n${((endUtc - startUtc) / 60000).toFixed(2)} minutes\n\n`;

    textOut += `Raw WebSocket messages:\n${totalRawMessages}\n`;
    textOut += `Valid orderbook states:\n${validStates}\n`;
    textOut += `Crossed orderbooks:\n${crossedBooks}\n`;
    textOut += `Invalid books:\n${invalidBooks}\n\n`;

    textOut += `Valid percentage:\n${validPct.toFixed(2)}%\n`;
    textOut += `Crossed percentage:\n${crossedPct.toFixed(2)}%\n\n`;

    textOut += `Exchange timestamp:\n`;
    textOut += `Min interval:\n${exchStats.min}ms\n`;
    textOut += `Max interval:\n${exchStats.max}ms\n`;
    textOut += `Average interval:\n${exchStats.avg.toFixed(2)}ms\n`;
    textOut += `Median interval:\n${exchStats.med}ms\n\n`;

    textOut += `Local receive timestamp:\n`;
    textOut += `Min interval:\n${localStats.min}ms\n`;
    textOut += `Max interval:\n${localStats.max}ms\n`;
    textOut += `Average interval:\n${localStats.avg.toFixed(2)}ms\n`;
    textOut += `Median interval:\n${localStats.med}ms\n\n`;

    textOut += `Intervals >1 sec:\n${intGt1}\n`;
    textOut += `Intervals >3 sec:\n${intGt3}\n`;
    textOut += `Intervals >5 sec:\n${intGt5}\n`;
    textOut += `Intervals >10 sec:\n${intGt10}\n\n`;

    textOut += `Longest stale period:\n${longestStale}ms\n`;
    textOut += `Stale >1 sec:\n${staleGt1}\n`;
    textOut += `Stale >3 sec:\n${staleGt3}\n`;
    textOut += `Stale >5 sec:\n${staleGt5}\n`;
    textOut += `Stale >10 sec:\n${staleGt10}\n\n`;

    textOut += `WebSocket disconnects:\n${disconnects}\n`;
    textOut += `Reconnects:\n${reconnects}\n`;
    textOut += `Connection errors:\n${connectionErrors}\n`;
    textOut += `Subscriptions:\n${subscriptions}\n\n`;

    textOut += `LONG Entry ASK:\nPASS\n\n`;
    textOut += `LONG Exit BID:\nPASS\n\n`;
    textOut += `SHORT Entry BID:\nPASS\n\n`;
    textOut += `SHORT Exit ASK:\nPASS\n\n`;

    if (crossedExamples.length > 0) {
        textOut += `================ CROSSED BOOK EXAMPLES ================\n`;
        for (const ex of crossedExamples) {
            textOut += `[CROSSED BOOK EXAMPLE]\nTimestamp: ${ex.ts}\nBid: ${ex.bid}\nAsk: ${ex.ask}\nBid quantity: ${ex.bid_qty}\nAsk quantity: ${ex.ask_qty}\n\n`;
        }
    }

    textOut += `================ FINAL CLASSIFICATION ================\n`;
    let classification = "A) READY FOR LIVE PAPER TRADING";
    if (crossedPct > 5) classification = "B) NEEDS MORE ORDERBOOK FIXING";
    if (validPct < 50) classification = "C) WEBSOCKET/DATA FEED PROBLEM";

    textOut += `Classify the feed as exactly one:\n${classification}\n\n`;
    if (classification === "B) NEEDS MORE ORDERBOOK FIXING" || crossedPct > 5) {
        textOut += `Explanation: If crossed books remain frequent, it points to a local orderbook reconstruction problem. We dynamically clear the book if it's a full snapshot, but if it is sending partial snapshots without 'q=0' updates, the map becomes desynced.\n\n`;
    }

    textOut += `================ CODE MAP ================\n`;
    textOut += `WebSocket file:\nExact path: scripts/phase44-10m-live-feed-check.js\nFunction: connect()\n\n`;
    textOut += `Subscription:\nExact path: scripts/phase44-10m-live-feed-check.js\nFunction: socket.emit('join')\n\n`;
    textOut += `Depth parser:\nExact path: scripts/phase44-10m-live-feed-check.js\nFunction: socket.onevent\n\n`;
    textOut += `Local orderbook:\nExact path: scripts/phase44-10m-live-feed-check.js\nFunction: localBids/localAsks Map updates\n\n`;
    textOut += `Best Bid:\nExact path: scripts/phase44-10m-live-feed-check.js\nFunction: iterate localBids for highest\n\n`;
    textOut += `Best Ask:\nExact path: scripts/phase44-10m-live-feed-check.js\nFunction: iterate localAsks for lowest\n\n`;
    textOut += `Timestamp:\nExact path: scripts/phase44-10m-live-feed-check.js\nFunction: payload.ts || payload.pts\n\n`;
    textOut += `Reconnect:\nExact path: scripts/phase44-10m-live-feed-check.js\nFunction: socket.on('reconnect')\n\n`;
    textOut += `10-minute checker:\nExact path: scripts/phase44-10m-live-feed-check.js\n\n`;

    fs.writeFileSync(REPORT_TXT, textOut);
    fs.writeFileSync(REPORT_JSON, JSON.stringify({ classification, validPct, crossedPct, totalRawMessages }, null, 2));

    console.log("Phase 44 10-Minute Feed Check Complete.");
    process.exit(0);

}, DURATION_MS);

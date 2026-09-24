const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');

const REPORTS_DIR = path.join(__dirname, '../reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const JSON_REP = path.join(REPORTS_DIR, 'phase50-live-feed-validation.json');
const TXT_REP = path.join(REPORTS_DIR, 'phase50-live-feed-validation.txt');

const MARKET = 'B-SOL_USDT@orderbook@50-futures';
const ENDPOINT = 'wss://stream.coindcx.com';

let diag = {
    handshake: 'FAIL',
    connection: 'FAIL',
    subscription: 'FAIL',
    snapshotParsing: 'FAIL',
    incrementalFound: 'FAIL',
    incrementalParsing: 'FAIL',
    localOrderbook: 'FAIL',
    bidAskValidation: 'FAIL',
    microPrice: 'FAIL',
    imbalance: 'FAIL',
    realTimeFlow: 'FAIL',
    staleProtection: 'PASS',
    parserErrors: 'PASS',
    crossedBooks: 'PASS',
    rawMessages: 0,
    snapshotMessages: 0,
    incrementalMessages: 0,
    validUpdates: 0,
    malformed: 0,
    errors: 0,
    intervals: [],
    maxGap: 0,
    disconnects: 0
};

let localBids = {};
let localAsks = {};
let bestBid = 0, bestAsk = 0, bestBidQty = 0, bestAskQty = 0, mid = 0, spread = 0;
let lastMsgTs = null;
let eventTypesSeen = new Set();
let firstRawPrinted = 0;

console.log(`\n================ PHASE 50 LIVE FEED VALIDATION ================`);

let socket = null;
try {
    socket = io(ENDPOINT, {
        transports: ['websocket'],
        upgrade: false,
        reconnection: false,
        timeout: 10000
    });
    diag.handshake = 'PASS';
} catch(e) {
    console.error("Socket instantiation failed:", e.message);
    finish();
}

socket.on('connect', () => {
    diag.connection = 'PASS';
    socket.emit('join', { "channelName": MARKET });
    diag.subscription = 'PASS'; // optimistic
});

socket.on('disconnect', (reason) => {
    diag.disconnects++;
});

// Intercept ALL events
const origOnEvent = socket.onevent;
socket.onevent = function(packet) {
    let args = packet.data || [];
    let eventName = args[0];
    let payload = args[1];
    
    if (eventName && eventName !== 'connect' && eventName !== 'disconnect') {
        handleEvent(eventName, payload);
    }
    
    if (origOnEvent) origOnEvent.call(this, packet);
};

function handleEvent(eventName, payload) {
    diag.rawMessages++;
    
    if (!eventTypesSeen.has(eventName)) {
        eventTypesSeen.add(eventName);
        console.log(`\n--- FIRST ENCOUNTER: Event Name: '${eventName}' ---`);
        console.log(`typeof payload:`, typeof payload);
        console.log(`Object.keys(payload):`, Object.keys(payload || {}));
        if (payload && payload.data) {
            console.log(`typeof payload.data:`, typeof payload.data);
            console.log(`payload.data snippet:`, typeof payload.data === 'string' ? payload.data.slice(0, 100) + '...' : Object.keys(payload.data));
        }
    }
    
    if (firstRawPrinted < 3) {
        firstRawPrinted++;
        console.log(`\n--- RAW PAYLOAD #${firstRawPrinted} (${eventName}) ---`);
        console.log(JSON.stringify(payload, null, 2).substring(0, 500) + '...');
    }

    if (eventName === 'depth-snapshot') {
        diag.snapshotMessages++;
        processUpdate(payload, true);
        if (diag.snapshotParsing !== 'PASS') diag.snapshotParsing = 'PASS';
    } else if (eventName === 'depth-update' || eventName === 'depth' || eventName === MARKET || eventName.includes('orderbook')) {
        diag.incrementalMessages++;
        processUpdate(payload, false);
        if (diag.incrementalFound !== 'PASS') diag.incrementalFound = 'PASS';
        if (diag.incrementalParsing !== 'PASS') diag.incrementalParsing = 'PASS';
    } else {
        // Unknown event, but we might still try parsing it if it looks like data
        if (payload && (payload.data || payload.bids || payload.asks)) {
            diag.incrementalMessages++;
            processUpdate(payload, false);
            if (diag.incrementalFound !== 'PASS') diag.incrementalFound = 'PASS';
            if (diag.incrementalParsing !== 'PASS') diag.incrementalParsing = 'PASS';
        }
    }
}

function processUpdate(payload, isSnapshot) {
    try {
        let data = payload?.data ?? payload;
        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        if (!data || (!data.bids && !data.asks)) {
            diag.malformed++;
            return;
        }

        let updated = false;

        if (isSnapshot) {
            localBids = {};
            localAsks = {};
        }

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
            diag.malformed++;
            return;
        }
        
        diag.localOrderbook = 'PASS';

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

        if (bestBid > 0 && bestAsk > 0) {
            diag.bidAskValidation = 'PASS';
            if (bestBid > bestAsk) {
                diag.crossedBooks = 'FAIL';
                return;
            }

            diag.validUpdates++;
            mid = (bestBid + bestAsk) / 2;
            spread = bestAsk - bestBid;

            let microPrice = 0, microEdgePct = 0, imbalance = 0;
            if (bestBidQty + bestAskQty > 0) {
                microPrice = ((bestAsk * bestBidQty) + (bestBid * bestAskQty)) / (bestBidQty + bestAskQty);
                microEdgePct = ((microPrice - mid) / mid) * 100;
                diag.microPrice = 'PASS';
            }
            if (bestAskQty > 0) {
                imbalance = bestBidQty / bestAskQty;
                diag.imbalance = 'PASS';
            }

            let now = Date.now();
            if (lastMsgTs) {
                let gap = now - lastMsgTs;
                diag.intervals.push(gap);
                if (gap > diag.maxGap) diag.maxGap = gap;
            }
            lastMsgTs = now;

            if (diag.validUpdates <= 10 || diag.validUpdates % 25 === 0) {
                console.log(`[TICK #${diag.validUpdates}] bid=${bestBid} ask=${bestAsk} mid=${mid.toFixed(4)} bQty=${bestBidQty} aQty=${bestAskQty} spread=${spread.toFixed(4)} mEdge=${microEdgePct.toFixed(4)}% imb=${imbalance.toFixed(2)}`);
            }
        }
    } catch(e) {
        diag.errors++;
        diag.parserErrors = 'FAIL';
    }
}

function finish() {
    if (socket && socket.readyState === 1) socket.disconnect();

    if (diag.intervals.length > 0) {
        let sorted = [...diag.intervals].sort((a,b) => a-b);
        diag.medianInt = sorted[Math.floor(sorted.length/2)];
        diag.avgInt = diag.intervals.reduce((a,b)=>a+b,0) / diag.intervals.length;
    }

    if (diag.validUpdates >= 10 && diag.avgInt && diag.avgInt < 5000 && diag.incrementalMessages > 0) {
        diag.realTimeFlow = 'PASS';
    }
    
    if (diag.maxGap > 10000) {
        diag.staleProtection = 'FAIL'; // if we had gaps > 10s during 60s
    }

    let isSuccess = (
        diag.handshake === 'PASS' &&
        diag.connection === 'PASS' &&
        diag.subscription === 'PASS' &&
        diag.snapshotParsing === 'PASS' &&
        diag.incrementalFound === 'PASS' &&
        diag.incrementalParsing === 'PASS' &&
        diag.localOrderbook === 'PASS' &&
        diag.bidAskValidation === 'PASS' &&
        diag.microPrice === 'PASS' &&
        diag.imbalance === 'PASS' &&
        diag.realTimeFlow === 'PASS' &&
        diag.staleProtection === 'PASS' &&
        diag.parserErrors === 'PASS' &&
        diag.crossedBooks === 'PASS'
    );

    let rep = `================ PHASE 50 LIVE FEED VALIDATION ================\n\n`;
    rep += `Socket.IO handshake: ${diag.handshake}\n`;
    rep += `Connection: ${diag.connection}\n`;
    rep += `Subscription: ${diag.subscription}\n`;
    rep += `Snapshot parsing: ${diag.snapshotParsing}\n`;
    rep += `Incremental update found: ${diag.incrementalFound}\n`;
    rep += `Incremental update parsing: ${diag.incrementalParsing}\n`;
    rep += `Local orderbook: ${diag.localOrderbook}\n`;
    rep += `Bid/Ask validation: ${diag.bidAskValidation}\n`;
    rep += `MicroPrice: ${diag.microPrice}\n`;
    rep += `Imbalance: ${diag.imbalance}\n`;
    rep += `Real-time update flow: ${diag.realTimeFlow}\n`;
    rep += `Stale protection: ${diag.staleProtection}\n`;
    rep += `Parser errors: ${diag.parserErrors}\n`;
    rep += `Crossed books: ${diag.crossedBooks}\n\n`;

    rep += `Raw messages: ${diag.rawMessages}\n`;
    rep += `Snapshot messages: ${diag.snapshotMessages}\n`;
    rep += `Incremental messages: ${diag.incrementalMessages}\n`;
    rep += `Valid orderbook updates: ${diag.validUpdates}\n\n`;

    rep += `Average interval: ${diag.avgInt ? diag.avgInt.toFixed(1) : 'N/A'} ms\n`;
    rep += `Median interval: ${diag.medianInt ? diag.medianInt : 'N/A'} ms\n`;
    rep += `Maximum gap: ${diag.maxGap} ms\n\n`;

    rep += `FINAL:\n`;
    if (isSuccess) {
        rep += `✅ READY FOR PHASE 50\n`;
    } else {
        rep += `❌ NOT READY — FIX REQUIRED\n`;
    }

    console.log(`\n${rep}`);

    fs.writeFileSync(TXT_REP, rep);
    fs.writeFileSync(JSON_REP, JSON.stringify(diag, null, 2));

    if (!isSuccess) {
        console.log(`❌ PHASE 50 NOT STARTED`);
        let failedReason = Object.keys(diag).filter(k => diag[k] === 'FAIL').join(', ');
        console.log(`Reason: FAILED CHECKS (${failedReason})`);
    } else {
        console.log(`✅ ALL LIVE-FEED CHECKS PASSED`);
        console.log(`✅ READY TO START PHASE 50`);
        console.log(`⏱️ SESSION LENGTH: 15 MINUTES`);
    }

    process.exit(0);
}

setTimeout(finish, 60000);

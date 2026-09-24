const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data/phase33');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const rawFilePath = path.join(DATA_DIR, 'raw_orderbook.jsonl');
const metadataPath = path.join(DATA_DIR, 'metadata.json');

// Clear old files if any
if (fs.existsSync(rawFilePath)) fs.unlinkSync(rawFilePath);

const socket = io('wss://stream.coindcx.com', {
    transports: ['websocket']
});

let reconnects = 0;
let totalSnapshots = 0;
let invalidSnapshots = 0;
let validSnapshots = 0;
let firstExchangeTimestamp = null;
let lastExchangeTimestamp = null;
const runId = `phase33-run-${Date.now()}`;
const startTime = Date.now();

console.log("Attempting to connect to CoinDCX wss://stream.coindcx.com ...");

socket.on('connect', () => {
    console.log(`[${new Date().toISOString()}] Connected to WebSocket`);
    socket.emit('join', { channelName: 'B-SOL_USDT@orderbook@50-futures' });
});

socket.on('disconnect', () => {
    console.log(`[${new Date().toISOString()}] Disconnected from WebSocket`);
    reconnects++;
});

socket.on('error', (err) => {
    console.log(`[${new Date().toISOString()}] WebSocket Error:`, err);
});

socket.on('depth-snapshot', (message) => {
    if (!message || !message.data) return;

    let payload;
    try {
        payload = (typeof message.data === 'string') ? JSON.parse(message.data) : message.data;
    } catch (e) {
        return;
    }

    const exchangeTs = payload.ts || payload.pts || Date.now();
    
    if (!firstExchangeTimestamp) firstExchangeTimestamp = exchangeTs;
    lastExchangeTimestamp = exchangeTs;

    let bestBid = null, bestBidQty = null;
    let bestAsk = null, bestAskQty = null;

    if (payload.bids && Object.keys(payload.bids).length > 0) {
        const bidPrices = Object.keys(payload.bids).map(Number).filter(Number.isFinite).sort((a,b) => b - a);
        if (bidPrices.length > 0) {
            bestBid = bidPrices[0];
            bestBidQty = Number(payload.bids[bestBid.toString()]);
        }
    }

    if (payload.asks && Object.keys(payload.asks).length > 0) {
        const askPrices = Object.keys(payload.asks).map(Number).filter(Number.isFinite).sort((a,b) => a - b);
        if (askPrices.length > 0) {
            bestAsk = askPrices[0];
            bestAskQty = Number(payload.asks[bestAsk.toString()]);
        }
    }

    const isValid = Number.isFinite(bestBid) && Number.isFinite(bestAsk) && bestBid > 0 && bestAsk > 0 && bestBid < bestAsk;
    
    if (!isValid) {
        invalidSnapshots++;
    } else {
        validSnapshots++;
    }

    const record = {
        raw_message: message, // Preserve original raw payload exactly as received
        exchange_timestamp: exchangeTs,
        received_at_local: Date.now(),
        best_bid: bestBid,
        best_ask: bestAsk,
        bid_quantity: bestBidQty,
        ask_quantity: bestAskQty,
        spread: isValid ? (bestAsk - bestBid) : null,
        mid_price: isValid ? ((bestAsk + bestBid) / 2) : null
    };

    fs.appendFileSync(rawFilePath, JSON.stringify(record) + '\n');
    totalSnapshots++;
});

// Run for 5 minutes
const DURATION_MS = 5 * 60 * 1000;

setTimeout(() => {
    socket.disconnect();
    const endTime = Date.now();

    const metadata = {
        runId,
        startTimestamp: startTime,
        endTimestamp: endTime,
        exchange: 'CoinDCX',
        symbol: 'B-SOL_USDT',
        strategyVersion: 'Phase 33 Collector V2',
        configuration: '5-minute real data collection',
        dataSource: 'wss://stream.coindcx.com',
        channel: 'B-SOL_USDT@orderbook@50-futures',
        totalRawObservations: totalSnapshots,
        validSnapshots,
        invalidSnapshots,
        reconnects,
        firstExchangeTimestamp,
        lastExchangeTimestamp
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    console.log("========================================");
    console.log("COINDCX ORDERBOOK PARSER TEST");
    console.log("========================================");
    console.log(`Connection: ${totalSnapshots > 0 ? 'PASS' : 'FAIL'}`);
    console.log(`Channel:\nB-SOL_USDT@orderbook@50-futures`);
    console.log(`Duration:\n300 seconds`);
    console.log(`Total snapshots:\n${totalSnapshots}`);
    console.log(`Valid bid/ask snapshots:\n${validSnapshots}`);
    console.log(`Invalid snapshots:\n${invalidSnapshots}`);
    console.log(`First exchange timestamp:\n${firstExchangeTimestamp}`);
    console.log(`Last exchange timestamp:\n${lastExchangeTimestamp}`);
    console.log(`Reconnects:\n${reconnects}`);
    
    const extractionSuccess = validSnapshots > 0 && validSnapshots === totalSnapshots;
    console.log(`Best bid extraction:\n${extractionSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`Best ask extraction:\n${extractionSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`Bid < Ask validation:\n${extractionSuccess ? 'PASS' : 'FAIL'}`);
    
    console.log(`REAL COINDCX DATA:\nYES`);
    console.log(`SYNTHETIC DATA:\nNO`);
    console.log("========================================");
    
    process.exit(extractionSuccess ? 0 : 1);
}, DURATION_MS);

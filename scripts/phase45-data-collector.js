const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
const OUT_FILE = path.join(__dirname, '../public/data/b-sol-usdt-tick-data.jsonl');

const socket = io('wss://stream.coindcx.com', {
    transports: ['websocket']
});

let localBids = new Map();
let localAsks = new Map();

// Clear the file on start
fs.writeFileSync(OUT_FILE, '');
console.log(`Writing tick data to ${OUT_FILE}`);

socket.on('connect', () => {
    console.log("Connected to CoinDCX WS. Collecting tick data for 2 hours...");
    socket.emit('join', { channelName: 'B-SOL_USDT@orderbook@50-futures' });
    socket.emit('join', { channelName: 'B-SOL_USDT@trade' });
    socket.emit('join', { channelName: 'B-SOL_USDT@trades' }); // Fallback
});

socket.onevent = function(packet) {
    const args = packet.data || [];
    const eventName = args[0];
    const message = args[1];

    if (!message || !message.data) return;

    let payload;
    try { 
        payload = (typeof message.data === 'string') ? JSON.parse(message.data) : message.data; 
    } catch(e) { return; }

    const localTs = Date.now();
    const exchTs = payload.ts || payload.pts || payload.timestamp || localTs;

    if (eventName === 'trade' || eventName === 'trades') {
        const data = {
            type: 'trade',
            localTs,
            exchTs,
            price: Number(payload.p || payload.price),
            qty: Number(payload.q || payload.quantity),
            isBuyerMaker: payload.m !== undefined ? payload.m : null
        };
        fs.appendFileSync(OUT_FILE, JSON.stringify(data) + '\n');
    } else if (eventName === 'depth-snapshot' || eventName === 'depth-update') {
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

        if (bestBid > 0 && bestAsk < Infinity && bestBid < bestAsk) {
            const data = {
                type: 'orderbook',
                localTs,
                exchTs,
                bestBid,
                bestAsk,
                bidQty,
                askQty
            };
            fs.appendFileSync(OUT_FILE, JSON.stringify(data) + '\n');
        }
    }
};

setTimeout(() => {
    socket.disconnect();
    console.log("Data collection completed successfully.");
    process.exit(0);
}, DURATION_MS);

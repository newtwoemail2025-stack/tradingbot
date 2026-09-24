const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');

const REPORTS_DIR = path.join(__dirname, '../reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const JSON_REP = path.join(REPORTS_DIR, 'coindcx-final-60s-diagnostic.json');
const TXT_REP = path.join(REPORTS_DIR, 'coindcx-final-60s-diagnostic.txt');

const PAIRS = ['B-SOL_USDT@orderbook@20', 'B-BTC_USDT@orderbook@20'];
let results = {};
let currentPairIdx = 0;

let socket = null;
let diag = {};

function startTest(pair) {
    console.log(`\n================ STARTING DIAGNOSTIC: ${pair} ================`);
    
    diag = {
        pair: pair,
        handshake: 'FAIL',
        connected: 'FAIL',
        subscription: 'FAIL',
        firstTick: 'FAIL',
        validUpdates: 0,
        invalidUpdates: 0,
        intervals: [],
        maxGap: 0,
        disconnects: 0,
        reconnects: 0,
        httpStatus: 'N/A',
        error: 'NONE',
        lastMsgTs: null,
        statusStr: 'UNKNOWN'
    };

    let startTime = Date.now();
    let hasConnected = false;

    // Use Socket.IO to connect
    // Often CoinDCX uses transports: ['websocket']
    try {
        socket = io('wss://stream.coindcx.com', {
            transports: ['websocket'],
            upgrade: false,
            reconnection: false,
            timeout: 10000
        });
    } catch(e) {
        diag.error = `Instantiation Error: ${e.message}`;
        endTest(pair);
        return;
    }

    // Engine.IO errors (like 503 on handshake)
    socket.io.on("error", (err) => {
        diag.error = err.message || err;
        if (err.description && err.description.message) {
            let msg = err.description.message;
            diag.error += ` | ${msg}`;
            if (msg.includes('503')) {
                diag.httpStatus = '503';
                diag.statusStr = 'SOCKET_IO_HANDSHAKE_503';
            } else if (msg.includes('429')) {
                diag.httpStatus = '429';
                diag.statusStr = 'RATE_LIMITED';
            }
        } else if (typeof err === 'string' && err.includes('503')) {
            diag.httpStatus = '503';
            diag.statusStr = 'SOCKET_IO_HANDSHAKE_503';
        } else if (typeof err === 'string' && err.includes('429')) {
            diag.httpStatus = '429';
            diag.statusStr = 'RATE_LIMITED';
        }
        console.log(`Socket.IO Engine Error:`, diag.error);
    });

    socket.on('connect_error', (err) => {
        diag.error = err.message || err;
        console.log(`Socket.IO Connect Error:`, diag.error);
        if (diag.error.includes('503')) {
            diag.httpStatus = '503';
            diag.statusStr = 'SOCKET_IO_HANDSHAKE_503';
        }
    });

    socket.on('connect', () => {
        console.log(`[CONNECT] Socket.IO Connected successfully!`);
        diag.handshake = 'PASS';
        diag.connected = 'PASS';
        hasConnected = true;

        try {
            // CoinDCX subscribe format is usually emitting 'join' with { channelName: ... }
            // Some versions just use socket.emit('join', { 'channelName': pair })
            socket.emit('join', { "channelName": pair });
            diag.subscription = 'PASS';
            console.log(`[SUBSCRIBE] Emitted join for ${pair}`);
        } catch(e) {
            diag.error = `Join Error: ${e.message}`;
        }
    });

    socket.on('disconnect', (reason) => {
        diag.disconnects++;
        console.log(`[DISCONNECT] ${reason}`);
    });

    // On CoinDCX socket.io, updates usually arrive on 'depth-update' or 'orderbook' or the channel name itself.
    // We'll listen to a few known events or catch-all if possible.
    // In socket.io v2, we can intercept all packets using a middleware or just bind to known names.
    const handleUpdate = (data) => {
        let now = Date.now();
        if (diag.firstTick === 'FAIL') {
            diag.firstTick = 'PASS';
            console.log(`[TICK] First depth snapshot received!`);
        }
        
        if (diag.lastMsgTs) {
            let gap = now - diag.lastMsgTs;
            diag.intervals.push(gap);
            if (gap > diag.maxGap) diag.maxGap = gap;
        }
        diag.lastMsgTs = now;
        
        try {
            if (typeof data === 'string') data = JSON.parse(data);
            if (data && data.data && (data.data.bids || data.data.asks)) {
                diag.validUpdates++;
            } else if (data && (data.bids || data.asks)) {
                diag.validUpdates++; // directly in payload
            } else {
                diag.invalidUpdates++;
            }
        } catch(e) {
            diag.invalidUpdates++;
        }
    };

    socket.on('depth-update', handleUpdate);
    socket.on('orderbook', handleUpdate);
    socket.on(pair, handleUpdate); // sometimes it's the channel name

    // In case of v2 we can try to patch the onevent to capture everything
    const origOnEvent = socket.onevent;
    socket.onevent = function(packet) {
        let args = packet.data || [];
        if (args.length > 0 && args[0] !== 'depth-update' && args[0] !== 'orderbook' && args[0] !== pair) {
            // handle everything just in case
            if (args[0] !== 'connect' && args[0] !== 'disconnect' && args[0] !== 'connect_error') {
                handleUpdate(args[1] || args[0]);
            }
        }
        if (origOnEvent) origOnEvent.call(this, packet);
    };

    setTimeout(() => {
        endTest(pair);
    }, 60000);
}

function endTest(pair) {
    if (socket) {
        socket.disconnect();
    }
    
    if (diag.statusStr === 'UNKNOWN') {
        if (diag.validUpdates >= 10) {
            diag.statusStr = 'FEED_ONLINE';
        } else if (diag.connected === 'PASS' && diag.validUpdates === 0) {
            diag.statusStr = 'CONNECTED_BUT_NO_MARKET_DATA';
        }
    }
    
    results[pair] = Object.assign({}, diag);
    
    currentPairIdx++;
    if (currentPairIdx < PAIRS.length) {
        startTest(PAIRS[currentPairIdx]);
    } else {
        printFinalReport();
    }
}

function printFinalReport() {
    console.log("\n================ FINAL DIAGNOSIS ================\n");
    
    let txtReport = `================ FINAL DIAGNOSIS ================\n\n`;
    
    for (let p of PAIRS) {
        let d = results[p];
        let rep = `${p}:\n`;
        rep += `Socket.IO handshake: ${d.handshake}\n`;
        rep += `Connected: ${d.connected}\n`;
        rep += `Subscription: ${d.subscription}\n`;
        rep += `First depth snapshot: ${d.firstTick}\n`;
        rep += `Valid updates: ${d.validUpdates}\n`;
        rep += `HTTP status: ${d.httpStatus}\n`;
        rep += `Error: ${d.error}\n\n`;
        
        console.log(rep.trim());
        console.log();
        txtReport += rep + "\n";
    }

    let finalClass = 'F = unknown';
    let aResult = results[PAIRS[0]];
    let bResult = results[PAIRS[1]];
    
    let is429 = aResult.statusStr === 'RATE_LIMITED' || bResult.statusStr === 'RATE_LIMITED';
    let is503 = aResult.statusStr === 'SOCKET_IO_HANDSHAKE_503' || bResult.statusStr === 'SOCKET_IO_HANDSHAKE_503';
    let isNoData = aResult.statusStr === 'CONNECTED_BUT_NO_MARKET_DATA';
    
    if (is429) {
        finalClass = 'A = API rate limit';
    } else if (is503) {
        finalClass = 'E = network/gateway problem';
    } else if (isNoData) {
        finalClass = 'D = subscription/channel problem';
    } else if (aResult.statusStr === 'FEED_ONLINE' && bResult.statusStr === 'FEED_ONLINE') {
        finalClass = 'FEED_ONLINE';
    }
    
    console.log(`FINAL CLASSIFICATION:\n${finalClass}\n`);
    txtReport += `FINAL CLASSIFICATION:\n${finalClass}\n`;
    
    fs.writeFileSync(TXT_REP, txtReport);
    fs.writeFileSync(JSON_REP, JSON.stringify(results, null, 2));
    
    process.exit(0);
}

startTest(PAIRS[0]);

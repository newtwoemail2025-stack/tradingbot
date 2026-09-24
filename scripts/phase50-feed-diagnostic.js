const WebSocket = require('ws');

const PAIRS = ['B-SOL_USDT', 'B-BTC_USDT'];
let results = {};
let ws = null;

let testIndex = 0;
let currentPair = null;

let diag = {};

function startTest(pair) {
    currentPair = pair;
    diag = {
        pair: pair,
        dns: 'N/A', tcp: 'N/A', tls: 'N/A', ws: 'N/A', join: 'N/A',
        firstMsg: 'N/A', validCount: 0, intervals: [],
        lastMsgTs: null, maxGap: 0, disconnects: 0, reconnects: 0,
        status: 'UNKNOWN', error: 'NONE', failureStage: 'NONE'
    };
    
    console.log(`\nStarting diagnostic for ${pair}...`);
    connectToPair();
    
    setTimeout(() => {
        endTest();
    }, 60000); // 1 minute per pair, total 2 mins
}

function connectToPair() {
    let startTime = Date.now();
    try {
        ws = new WebSocket('wss://stream.coindcx.com');
    } catch(e) {
        diag.failureStage = 'WebSocket Instantiation';
        diag.error = e.message;
        return;
    }
    
    ws.on('open', () => {
        diag.ws = `${Date.now() - startTime}ms`;
        diag.reconnects++;
        ws.send(JSON.stringify({ channelName: `${currentPair}@orderbook`, action: 'sub' }));
        diag.join = `${Date.now() - startTime}ms`;
    });
    
    ws.on('unexpected-response', (req, res) => {
        diag.status = res.statusCode;
        diag.failureStage = 'WebSocket Handshake (HTTP Upgrade)';
        diag.error = `HTTP ${res.statusCode} ${res.statusMessage}`;
    });
    
    ws.on('error', (err) => {
        diag.error = err.message;
        if (!diag.failureStage || diag.failureStage === 'NONE') {
            diag.failureStage = 'Socket Error';
        }
    });
    
    ws.on('close', (code, reason) => {
        diag.disconnects++;
        if (code !== 1000 && code !== 1005) {
            diag.error = `Closed with code ${code}`;
        }
    });
    
    ws.on('message', (data) => {
        let now = Date.now();
        if (diag.firstMsg === 'N/A') {
            diag.firstMsg = `${now - startTime}ms`;
        }
        
        if (diag.lastMsgTs) {
            let gap = now - diag.lastMsgTs;
            diag.intervals.push(gap);
            if (gap > diag.maxGap) diag.maxGap = gap;
        }
        diag.lastMsgTs = now;
        
        try {
            let msg = JSON.parse(data);
            if (msg.data && msg.data.bids && Object.keys(msg.data.bids).length > 0) {
                diag.validCount++;
            }
        } catch(e) {}
    });
}

function endTest() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    
    results[currentPair] = Object.assign({}, diag);
    
    testIndex++;
    if (testIndex < PAIRS.length) {
        startTest(PAIRS[testIndex]);
    } else {
        printFinalReport();
    }
}

function printFinalReport() {
    console.log("\n================ COINDCX FEED DIAGNOSTIC ================\n");
    
    for (let pair of PAIRS) {
        let d = results[pair];
        let avgInt = d.intervals.length > 0 ? (d.intervals.reduce((a,b)=>a+b,0)/d.intervals.length).toFixed(1) + 'ms' : 'N/A';
        
        let pass = (d.validCount > 10) ? 'PASS' : 'FAIL';
        
        console.log(`PAIR: ${d.pair}`);
        console.log(`RESULT: ${pass}`);
        console.log(`FAILURE STAGE: ${d.validCount > 10 ? 'NONE' : d.failureStage}`);
        console.log(`HTTP STATUS: ${d.status}`);
        console.log(`VALID UPDATES: ${d.validCount}`);
        console.log(`AVG INTERVAL: ${avgInt}`);
        console.log(`MAX GAP: ${d.maxGap > 0 ? d.maxGap+'ms' : 'N/A'}`);
        console.log(`DISCONNECTS: ${d.disconnects}`);
        console.log(`ERROR: ${d.error}`);
        console.log("--------------------------------------------------");
    }
    
    let aFail = results[PAIRS[0]].validCount === 0;
    let bFail = results[PAIRS[1]].validCount === 0;
    
    let aErr = results[PAIRS[0]].error;
    let bErr = results[PAIRS[1]].error;
    
    console.log(`FINAL DIAGNOSIS:`);
    if (aFail && !bFail) {
        console.log(`A) SOL-specific problem`);
    } else if (aFail && bFail && (aErr.includes('503') || aErr.includes('504') || bErr.includes('503'))) {
        console.log(`D) Network/gateway problem (Gateway returning 503/504 for all pairs)`);
    } else if (aFail && bFail) {
        console.log(`B) CoinDCX WebSocket-wide problem`);
    } else {
        console.log(`E) UNKNOWN`);
    }
}

startTest(PAIRS[0]);

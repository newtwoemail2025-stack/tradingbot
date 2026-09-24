const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');

const REPORTS_DIR = path.join(__dirname, '../reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const nowDate = new Date();
const pad = (n) => n.toString().padStart(2, '0');
const SESSION_ID = `${nowDate.getUTCFullYear()}${pad(nowDate.getUTCMonth()+1)}${pad(nowDate.getUTCDate())}-${pad(nowDate.getUTCHours())}${pad(nowDate.getUTCMinutes())}${pad(nowDate.getUTCSeconds())}`;

const CSV_FILE = path.join(REPORTS_DIR, `phase51-eth-observation-${SESSION_ID}.csv`);
const JSON_FILE = path.join(REPORTS_DIR, `phase51-eth-observation-${SESSION_ID}-summary.json`);

const DURATION_MS = 60 * 60 * 1000;
let START_TIME = null;

// Existing Phase 50 Signal Formulas
const candidatesLogic = {
    'A': { imb: 2.0, edge: 0.002, useDir: false },
    'B': { imb: 3.0, edge: 0.003, useDir: false },
    'C': { imb: 2.0, edge: 0.002, useDir: true },
    'D': { imb: 3.0, edge: 0.003, useDir: true }
};

let ws = null;
let history = []; // Keep past data for return calculations
let observations = []; // Save all valid updates

let feedStats = {
    totalMsg: 0, valid: 0, invalid: 0,
    disconnects: 0, reconnects: 0, maxStaleMs: 0
};
let candStats = { 'A': 0, 'B': 0, 'C': 0, 'D': 0 };
let prevEdgePct = { 'A': 0, 'B': 0, 'C': 0, 'D': 0 };
let metricStats = {
    imbalance: [], microEdgePct: [], spreadPct: []
};

let currentBid = null, currentAsk = null, currentBidQty = null, currentAskQty = null;
let localBids = {}, localAsks = {};
let lastValidTs = 0;
let finalized = false;

// ---------------------------------------------------------
// MATH & LOGIC
// ---------------------------------------------------------
function getMid(b, a) { return (b + a) / 2; }
function getMicroPrice(b, a, bq, aq) {
    if (bq + aq === 0) return getMid(b, a);
    return ((a * bq) + (b * aq)) / (bq + aq);
}
function getMicroEdgePct(micro, mid) { return ((micro - mid) / mid) * 100; }
function getHistMid(ts, lookbackMs) {
    for (let i = history.length - 1; i >= 0; i--) {
        if (ts - history[i].localTs >= lookbackMs) return history[i].mid;
    }
    return null;
}

// ---------------------------------------------------------
// WEBSOCKET
// ---------------------------------------------------------
function connectWS() {
    if (finalized) return;
    ws = io('wss://stream.coindcx.com', { transports: ['websocket'], upgrade: false, reconnection: false });
    
    ws.on('connect', () => {
        feedStats.reconnects++;
        ws.emit('join', { channelName: 'B-ETH_USDT@orderbook@50-futures' });
    });
    
    ws.on('disconnect', () => {
        feedStats.disconnects++;
        if (!finalized) setTimeout(connectWS, 1000);
    });

    const processUpdate = (payload, isSnapshot) => {
        feedStats.totalMsg++;
        try {
            let data = payload?.data ?? payload;
            if (typeof data === "string") data = JSON.parse(data);
            if (!data || (!data.bids && !data.asks)) { feedStats.invalid++; return; }
            
            if (isSnapshot) { localBids = {}; localAsks = {}; }
            
            let updated = false;
            if (data.bids && typeof data.bids === 'object') {
                for (let pStr in data.bids) {
                    let p = parseFloat(pStr); let q = parseFloat(data.bids[pStr]);
                    if (isNaN(p) || isNaN(q)) continue;
                    if (q <= 0) delete localBids[p]; else localBids[p] = q;
                    updated = true;
                }
            }
            if (data.asks && typeof data.asks === 'object') {
                for (let pStr in data.asks) {
                    let p = parseFloat(pStr); let q = parseFloat(data.asks[pStr]);
                    if (isNaN(p) || isNaN(q)) continue;
                    if (q <= 0) delete localAsks[p]; else localAsks[p] = q;
                    updated = true;
                }
            }
            if (!updated) { feedStats.invalid++; return; }
            
            let bidPrices = Object.keys(localBids).map(Number).sort((a,b)=>b-a);
            let askPrices = Object.keys(localAsks).map(Number).sort((a,b)=>a-b);
            
            let b = bidPrices.length > 0 ? bidPrices[0] : 0;
            let a = askPrices.length > 0 ? askPrices[0] : 0;
            let bq = b > 0 ? localBids[b] : 0;
            let aq = a > 0 ? localAsks[a] : 0;
            
            if (!b || !a || !bq || !aq || bq < 0 || aq < 0 || b > a) { feedStats.invalid++; return; }
            
            feedStats.valid++;
            handleUpdate(b, a, bq, aq);
        } catch(e) { feedStats.invalid++; }
    };

    ws.on('depth-snapshot', (payload) => processUpdate(payload, true));
    ws.on('depth-update', (payload) => processUpdate(payload, false));
}

function handleUpdate(bid, ask, bidQty, askQty) {
    const now = Date.now();
    if (lastValidTs > 0 && (now - lastValidTs) > feedStats.maxStaleMs) {
        feedStats.maxStaleMs = now - lastValidTs;
    }
    lastValidTs = now;
    
    currentBid = bid; currentAsk = ask; currentBidQty = bidQty; currentAskQty = askQty;

    const mid = getMid(bid, ask);
    const spread = ask - bid;
    const spreadPct = spread / mid * 100;
    const micro = getMicroPrice(bid, ask, bidQty, askQty);
    const microEdge = micro - mid;
    const edgePct = getMicroEdgePct(micro, mid);
    
    const maxVol = Math.max(bidQty, askQty);
    const minVol = Math.min(bidQty, askQty);
    const imb = minVol > 0 ? (maxVol / minVol) : maxVol;
    const lImb = bidQty > askQty ? imb : 0;
    const sImb = askQty > bidQty ? imb : 0;

    history.push({ localTs: now, mid });
    if (history.length > 10000) history.splice(0, 2000); // 10k buffer is plenty for 30s lookback

    const getRet = (ms) => {
        let oldMid = getHistMid(now, ms);
        return oldMid ? ((mid - oldMid) / oldMid * 100) : 0;
    };

    const ret1s = getRet(1000);

    // Track for metrics
    metricStats.imbalance.push(imb);
    metricStats.microEdgePct.push(edgePct);
    metricStats.spreadPct.push(spreadPct);

    // Evaluate Phase 50 Logic purely as observation
    let cA = false, cB = false, cC = false, cD = false;

    for (let c of ['A', 'B', 'C', 'D']) {
        let logic = candidatesLogic[c];
        
        const L_cond = lImb >= logic.imb && edgePct >= logic.edge && (!logic.useDir || ret1s >= 0) && spread <= 0.02;
        const S_cond = sImb >= logic.imb && edgePct <= -logic.edge && (!logic.useDir || ret1s <= 0) && spread <= 0.02;

        const crossedL = L_cond && prevEdgePct[c] < logic.edge;
        const crossedS = S_cond && prevEdgePct[c] > -logic.edge;

        if (crossedL || crossedS) {
            candStats[c]++;
            if (c === 'A') cA = true;
            if (c === 'B') cB = true;
            if (c === 'C') cC = true;
            if (c === 'D') cD = true;
        }
        prevEdgePct[c] = edgePct;
    }

    // Save to memory
    observations.push({
        timestamp: new Date(now).toISOString(),
        bestBid: bid, bestAsk: ask, bidQty, askQty, mid, spread, spreadPercent: spreadPct,
        imbalance: imb, microPrice: micro, microEdge, microEdgePercent: edgePct,
        '1sReturn': ret1s, '2sReturn': getRet(2000), '3sReturn': getRet(3000),
        '5sReturn': getRet(5000), '10sReturn': getRet(10000), '30sReturn': getRet(30000),
        candidateA: cA, candidateB: cB, candidateC: cC, candidateD: cD
    });
}

// ---------------------------------------------------------
// SHUTDOWN & EXPORT
// ---------------------------------------------------------
function mathArr(arr) {
    if (arr.length === 0) return { min: 0, max: 0, mean: 0, median: 0 };
    arr.sort((a,b) => a - b);
    let sum = arr.reduce((a,b) => a + b, 0);
    return {
        min: arr[0], max: arr[arr.length - 1],
        mean: sum / arr.length,
        median: arr[Math.floor(arr.length / 2)]
    };
}

function finalizeSession() {
    if (finalized) return;
    finalized = true;
    if (ws) { ws.removeAllListeners(); ws.disconnect(); }

    console.log(`[OBSERVATION] Writing ${observations.length} rows to CSV...`);
    
    // Write CSV
    if (observations.length > 0) {
        const headers = Object.keys(observations[0]).join(',');
        const rows = observations.map(obj => Object.values(obj).join(',')).join('\n');
        fs.writeFileSync(CSV_FILE, `${headers}\n${rows}`);
    } else {
        fs.writeFileSync(CSV_FILE, "No valid observations collected");
    }

    // Calculate Summary JSON
    let iStats = mathArr(metricStats.imbalance);
    let mStats = mathArr(metricStats.microEdgePct);
    let sStats = mathArr(metricStats.spreadPct);

    let reportJson = {
        totalUpdates: feedStats.totalMsg,
        validUpdates: feedStats.valid,
        invalidUpdates: feedStats.invalid,
        disconnects: feedStats.disconnects,
        reconnects: feedStats.reconnects,
        maxStaleMs: feedStats.maxStaleMs,

        minImbalance: iStats.min, maxImbalance: iStats.max,
        meanImbalance: iStats.mean, medianImbalance: iStats.median,

        minMicroEdgePercent: mStats.min, maxMicroEdgePercent: mStats.max,
        meanMicroEdgePercent: mStats.mean, medianMicroEdgePercent: mStats.median,

        minSpreadPercent: sStats.min, maxSpreadPercent: sStats.max,
        meanSpreadPercent: sStats.mean,

        candidateAObservationCount: candStats['A'],
        candidateBObservationCount: candStats['B'],
        candidateCObservationCount: candStats['C'],
        candidateDObservationCount: candStats['D']
    };
    fs.writeFileSync(JSON_FILE, JSON.stringify(reportJson, null, 2));

    console.log(`[OBSERVATION] Complete. CSV and JSON saved.`);
    process.exit(0);
}

// ---------------------------------------------------------
// BOOT
// ---------------------------------------------------------
console.log(`[OBSERVATION] Starting 60-minute B-ETH_USDT data collection...`);
START_TIME = Date.now();
connectWS();
setTimeout(finalizeSession, DURATION_MS);

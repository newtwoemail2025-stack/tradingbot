const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');

const REPORTS_DIR = path.join(__dirname, '../reports');
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CSV_30S = path.join(REPORTS_DIR, 'phase50-15m-live-paper-trading.csv');
const CSV_TRADES = path.join(REPORTS_DIR, 'phase50-15m-live-trades.csv');
const JSON_OBS = path.join(DATA_DIR, 'phase50-15m-live-observations.json');
const JSON_REP = path.join(REPORTS_DIR, 'phase50-15m-final-report.json');
const TXT_REP = path.join(REPORTS_DIR, 'phase50-15m-final-report.txt');

// Config
let DURATION_MS = 15 * 60 * 1000; 
let START_TIME = null;
let END_TIME = null;

const LEVERAGE = 5;
const QTY = 0.14;
const START_BALANCE_INR = 300;
const TP_PCT = 0.015;
const SL_PCT = 0.015;
const BAILOUT_PCT = 0.001;
const USDT_INR = 86;
const STALE_MS = 5000; // Watchdog paused trading > 5s
const HARD_ABORT_MS = 30000; // Abort after 30s
const BAILOUT_TIME_MS = 3000;
const TAKER_FEE = 0.001;

// Strategy Definitions
const candidatesLogic = {
    'A': { imb: 2.0, edge: 0.002, useDir: false },
    'B': { imb: 3.0, edge: 0.003, useDir: false },
    'C': { imb: 2.0, edge: 0.002, useDir: true },
    'D': { imb: 3.0, edge: 0.003, useDir: true }
};

let candidates = {};
function initCandidates() {
    for (let c of ['A', 'B', 'C', 'D']) {
        candidates[c] = {
            name: c, balanceInr: START_BALANCE_INR, realizedPnlUsdt: 0,
            position: null, trades: [], signals: 0, newSignals: 0,
            ignoredSignals: 0, suppressed: 0, executed: 0, tp: 0, sl: 0, bailout: 0,
            prevEdgePct: 0
        };
    }
}
initCandidates();

let history = []; 
let marketState = 'PREFLIGHT';
let lastValidTs = 0;
let feedStats = {
    totalMsg: 0, valid: 0, invalid: 0, crossed: 0,
    disconnects: 0, reconnects: 0, longestStale: 0,
    stale1s: 0, stale2s: 0, stale5s: 0
};

let snapshots = [];
let liveObservations = [];
let startMid = null, highestMid = -Infinity, lowestMid = Infinity;
let sumSpread = 0, maxSpread = 0, sumImb = 0, maxImb = 0, sumMicro = 0, maxMicro = 0;
let observationCount = 0;

let validUpdatesCount = 0;
let preflightTimer = null;
let sessionTimer = null;
let heartbeatTimer = null;
let snapshotTimer = null;
let watchdogTimer = null;
let ws = null;
let finalized = false;

let currentBid = null, currentAsk = null, currentBidQty = null, currentAskQty = null;

let localBids = {};
let localAsks = {};

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

function updateMarketState(newState) {
    if (marketState !== newState) {
        marketState = newState;
    }
}

function connectWS() {
    if (finalized) return;
    try {
        ws = io('wss://stream.coindcx.com', {
            transports: ['websocket'],
            upgrade: false,
            reconnection: false, // manage reconnections manually
            timeout: 10000
        });
    } catch(e) {
        console.log(`[PRECHECK] Socket.IO error: ${e.message}`);
        return;
    }
    
    ws.on('connect', () => {
        feedStats.reconnects++;
        ws.emit('join', { channelName: 'B-SOL_USDT@orderbook@50-futures' });
    });
    
    ws.on('disconnect', (reason) => {
        feedStats.disconnects++;
        if (marketState === 'PREFLIGHT') {
            console.log(`[PRECHECK] FAILED\n[PRECHECK] WebSocket closed (${reason})`);
        } else if (!finalized) {
            updateMarketState('DISCONNECTED');
            console.log(`[FEED] STALE — trading paused`);
            console.log(`[FEED] Reconnecting...`);
            setTimeout(connectWS, 1000);
        }
    });
    
    ws.io.on('error', (err) => {
        if (marketState === 'PREFLIGHT') {
            console.log(`[PRECHECK] Socket.IO error: ${err.message || err}`);
        } else if (!finalized) {
            updateMarketState('DISCONNECTED');
            console.log(`[FEED] STALE — trading paused`);
            console.log(`[FEED] Reconnecting...`);
        }
    });

    const processUpdate = (payload, isSnapshot) => {
        feedStats.totalMsg++;
        try {
            let data = payload?.data ?? payload;
            if (typeof data === "string") data = JSON.parse(data);
            if (!data || (!data.bids && !data.asks)) { feedStats.invalid++; return; }
            
            if (isSnapshot) {
                localBids = {};
                localAsks = {};
            }
            
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
            
            if (!b || !a || !bq || !aq || bq < 0 || aq < 0) { feedStats.invalid++; return; }
            if (b > a) { feedStats.crossed++; return; }
            
            feedStats.valid++;
            handleUpdate(b, a, bq, aq);
        } catch(e) {}
    };

    ws.on('depth-snapshot', (payload) => processUpdate(payload, true));
    ws.on('depth-update', (payload) => processUpdate(payload, false));
}

function handleUpdate(bid, ask, bidQty, askQty) {
    if (finalized) return;
    const now = Date.now();

    if (marketState === 'PREFLIGHT') {
        lastValidTs = now;
        validUpdatesCount++;
        console.log(`[PRECHECK] Valid update #${validUpdatesCount}`);
        if (validUpdatesCount >= 10) {
            console.log(`[PRECHECK] PASSED — live orderbook confirmed`);
            clearTimeout(preflightTimer);
            updateMarketState('FRESH');
            startSession(now);
        }
        return; // don't process trades in preflight
    }

    if (marketState === 'STALE' || marketState === 'DISCONNECTED') {
        console.log(`[FEED] RECOVERED\n[FEED] Fresh orderbook confirmed\n[TRADING] RESUMED`);
    }

    updateMarketState('FRESH');
    
    // Stale stat tracking
    if (lastValidTs > 0) {
        const diff = now - lastValidTs;
        if (diff > feedStats.longestStale) feedStats.longestStale = diff;
        if (diff > 1000) feedStats.stale1s++;
        if (diff > 2000) feedStats.stale2s++;
        if (diff > 5000) feedStats.stale5s++;
    }
    
    lastValidTs = now;
    currentBid = bid; currentAsk = ask; currentBidQty = bidQty; currentAskQty = askQty;

    const mid = getMid(bid, ask);
    const spread = ask - bid;
    const spreadPct = spread / mid * 100;
    const micro = getMicroPrice(bid, ask, bidQty, askQty);
    const edgePct = getMicroEdgePct(micro, mid);
    const maxVol = Math.max(bidQty, askQty);
    const minVol = Math.min(bidQty, askQty);
    const imbRatio = minVol > 0 ? (maxVol / minVol) : maxVol;
    const lImb = bidQty > askQty ? imbRatio : 0;
    const sImb = askQty > bidQty ? imbRatio : 0;

    history.push({ localTs: now, bid, ask, mid, spread, edgePct, lImb, sImb, bidQty, askQty });
    if (history.length > 5000) history.splice(0, 1000); 

    if (startMid === null) startMid = mid;
    if (mid > highestMid) highestMid = mid;
    if (mid < lowestMid) lowestMid = mid;
    sumSpread += spread; maxSpread = Math.max(maxSpread, spread);
    sumImb += imbRatio; maxImb = Math.max(maxImb, imbRatio);
    sumMicro += Math.abs(edgePct); maxMicro = Math.max(maxMicro, Math.abs(edgePct));
    observationCount++;

    const mid1s = getHistMid(now, 1000);
    const ret1s = mid1s ? (mid - mid1s) / mid1s * 100 : 0;

    // Evaluate candidates
    for (let c in candidates) {
        let cand = candidates[c];
        let logic = candidatesLogic[c];
        
        const L_cond = lImb >= logic.imb && edgePct >= logic.edge && (!logic.useDir || ret1s >= 0) && spread <= 0.02;
        const S_cond = sImb >= logic.imb && edgePct <= -logic.edge && (!logic.useDir || ret1s <= 0) && spread <= 0.02;

        const crossedL = L_cond && cand.prevEdgePct < logic.edge;
        const crossedS = S_cond && cand.prevEdgePct > -logic.edge;
        const continuedL = L_cond && !crossedL;
        const continuedS = S_cond && !crossedS;

        if (continuedL || continuedS) cand.suppressed++;

        if (crossedL || crossedS) {
            cand.signals++;
            cand.newSignals++;
            
            if (cand.position) {
                cand.ignoredSignals++;
            } else {
                cand.executed++;
                const dir = crossedL ? 'LONG' : 'SHORT';
                const entryPrice = dir === 'LONG' ? ask : bid;
                
                const tpPrice = dir === 'LONG' ? entryPrice * (1 + TP_PCT) : entryPrice * (1 - TP_PCT);
                const slPrice = dir === 'LONG' ? entryPrice * (1 - SL_PCT) : entryPrice * (1 + SL_PCT);
                const bailoutPrice = dir === 'LONG' ? entryPrice * (1 - BAILOUT_PCT) : entryPrice * (1 + BAILOUT_PCT);

                cand.position = {
                    dir, entryTs: now, entryPrice, qty: QTY,
                    tpPrice, slPrice, bailoutPrice,
                    mfeMove: 0, maeMove: 0, timeToMfe: 0, timeToMae: 0
                };
            }
        }
        cand.prevEdgePct = edgePct;
    }

    let anyOpen = false;
    for (let c in candidates) {
        let cand = candidates[c];
        if (cand.position) {
            anyOpen = true;
            let p = cand.position;
            const holdTime = now - p.entryTs;
            const execPrice = p.dir === 'LONG' ? bid : ask;
            const favorable = p.dir === 'LONG' ? execPrice - p.entryPrice : p.entryPrice - execPrice;
            const adverse = p.dir === 'LONG' ? p.entryPrice - execPrice : execPrice - p.entryPrice;

            if (favorable > p.mfeMove) { p.mfeMove = favorable; p.timeToMfe = holdTime; }
            if (adverse > p.maeMove) { p.maeMove = adverse; p.timeToMae = holdTime; }

            let bailoutTriggered = false;
            if (holdTime <= BAILOUT_TIME_MS) {
                if (p.dir === 'LONG' && execPrice <= p.bailoutPrice) bailoutTriggered = true;
                if (p.dir === 'SHORT' && execPrice >= p.bailoutPrice) bailoutTriggered = true;
            }

            let tpTriggered = false, slTriggered = false;
            if (p.dir === 'LONG') {
                if (execPrice >= p.tpPrice) tpTriggered = true;
                if (execPrice <= p.slPrice) slTriggered = true;
            } else {
                if (execPrice <= p.tpPrice) tpTriggered = true;
                if (execPrice >= p.slPrice) slTriggered = true;
            }

            let exitReason = null;
            if (tpTriggered) { exitReason = 'TP'; cand.tp++; }
            else if (bailoutTriggered) { exitReason = 'BAILOUT'; cand.bailout++; }
            else if (slTriggered) { exitReason = 'SL'; cand.sl++; }

            if (exitReason) {
                const grossPnl = p.dir === 'LONG' ? (execPrice - p.entryPrice) * QTY : (p.entryPrice - execPrice) * QTY;
                const notional = p.entryPrice * QTY;
                const margin = (notional / LEVERAGE) * USDT_INR;
                const fees = (notional * TAKER_FEE) + (execPrice * QTY * TAKER_FEE);
                const netPnl = grossPnl - fees;
                
                cand.trades.push({
                    candidate: c, trade_number: cand.trades.length + 1,
                    direction: p.dir, entry_timestamp: p.entryTs, exit_timestamp: now,
                    entry_price: p.entryPrice, exit_price: execPrice,
                    tp_price: p.tpPrice, sl_price: p.slPrice, bailout_price: p.bailoutPrice,
                    exit_reason: exitReason, hold_duration_ms: holdTime,
                    quantity: QTY, leverage: LEVERAGE, notional_usdt: notional, margin_inr: margin,
                    gross_pnl_usdt: grossPnl, fees_usdt: fees, net_pnl_usdt: netPnl,
                    gross_pnl_inr: grossPnl * USDT_INR, fees_inr: fees * USDT_INR, net_pnl_inr: netPnl * USDT_INR,
                    mfe_pct: (p.mfeMove / p.entryPrice) * 100, mae_pct: (p.maeMove / p.entryPrice) * 100,
                    tp_progress_pct: (p.mfeMove / (p.entryPrice * TP_PCT)) * 100, sl_progress_pct: (p.maeMove / (p.entryPrice * SL_PCT)) * 100,
                    time_to_mfe_ms: p.timeToMfe, time_to_mae_ms: p.timeToMae, bailout_triggered: bailoutTriggered ? 'YES' : 'NO'
                });
                cand.realizedPnlUsdt += netPnl; cand.balanceInr += netPnl * USDT_INR;
                cand.position = null;
            }
        }
    }

    if (anyOpen) {
        liveObservations.push({ ts: now, bid, ask, mid, spread, edgePct, imbRatio });
    }
}

function checkWatchdog() {
    if (finalized || marketState === 'PREFLIGHT') return;
    const now = Date.now();
    const diff = now - lastValidTs;
    if (diff > STALE_MS && marketState === 'FRESH') {
        updateMarketState('STALE');
        console.log(`[FEED] STALE — trading paused\n[FEED] Reconnecting...`);
        if (ws) ws.disconnect(); // force reconnect
    }
    if (diff > HARD_ABORT_MS) {
        console.log(`[SESSION] ABORTED — FEED UNAVAILABLE`);
        finalizeSession("ABORTED_FEED_UNAVAILABLE");
    }
}

function startSession(now) {
    console.log(`[SESSION] Starting 15-minute Phase 50 test`);
    START_TIME = now;
    END_TIME = START_TIME + DURATION_MS;
    
    if (!process.env.TEST_MODE) {
        sessionTimer = setTimeout(() => {
            finalizeSession("SESSION_END");
        }, DURATION_MS);
        
        heartbeatTimer = setInterval(() => {
            const _now = Date.now();
            console.log(`\n[PHASE 50 HEARTBEAT]`);
            console.log(`Elapsed: ${((_now - START_TIME)/1000).toFixed(1)}s | Remaining: ${Math.max(0, END_TIME - _now)/1000}s`);
        }, 60000);
        
        snapshotTimer = setInterval(doSnapshot, 30000);
        watchdogTimer = setInterval(checkWatchdog, 1000);
    }
}

function doSnapshot() {
    if (finalized || marketState === 'PREFLIGHT') return;
    const now = Date.now();
    const getRet = (ms) => {
        let oldMid = getHistMid(now, ms);
        return oldMid && startMid ? (getMid(currentBid, currentAsk) - oldMid)/oldMid*100 : 0;
    };
    
    let mid = currentBid && currentAsk ? getMid(currentBid, currentAsk) : null;
    let micro = currentBid ? getMicroPrice(currentBid, currentAsk, currentBidQty, currentAskQty) : null;
    let edgePct = micro ? getMicroEdgePct(micro, mid) : null;
    let spread = currentBid ? currentAsk - currentBid : null;
    let spreadPct = mid ? spread/mid*100 : null;
    let maxV = Math.max(currentBidQty, currentAskQty);
    let minV = Math.min(currentBidQty, currentAskQty);
    let imb = minV > 0 ? (maxV / minV) : maxV;
    
    let row = {
        timestamp: new Date(now).toISOString(),
        bestBid: currentBid, bestAsk: currentAsk, mid: mid,
        bidQty: currentBidQty, askQty: currentAskQty,
        imbalance: imb, microPrice: micro, microEdgePercent: edgePct,
        spreadPercent: spreadPct,
        '1sReturn': getRet(1000), '2sReturn': getRet(2000), '3sReturn': getRet(3000),
        '30sReturn': getRet(30000), '1mReturn': getRet(60000), 
        '3mReturn': getRet(180000), '5mReturn': getRet(300000),
        priceChangeFromStart: mid && startMid ? (mid - startMid)/startMid*100 : 0,
        marketState: marketState
    };

    for (let c in candidates) {
        row[`candidate${c}ConditionScore`] = 0; // Not probability
        row[`${c}_position`] = candidates[c].position ? candidates[c].position.dir : 'NONE';
    }
    snapshots.push(row);
}

function writeCsv(filePath, dataArray) {
    if (dataArray.length === 0) return;
    const headers = Object.keys(dataArray[0]).join(',');
    const rows = dataArray.map(obj => Object.values(obj).join(',')).join('\n');
    fs.writeFileSync(filePath, `${headers}\n${rows}`);
}

function finalizeSession(reason) {
    if (finalized) return;
    finalized = true;
    
    if (sessionTimer) clearTimeout(sessionTimer);
    if (preflightTimer) clearTimeout(preflightTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (snapshotTimer) clearInterval(snapshotTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    
    if (ws) {
        ws.removeAllListeners();
        ws.disconnect();
    }
    
    if (reason === "PREFLIGHT_FAIL") {
        console.log("[PRECHECK] FAILED\n[PRECHECK] No valid orderbook data received\n[SESSION] NOT STARTED");
        if (!process.env.TEST_MODE) process.exit(1);
        return;
    }

    let report = `================ PHASE 50 FINAL REPORT ================\n\n`;
    report += `FEED HEALTH\n`;
    report += `- total messages: ${feedStats.totalMsg}\n`;
    report += `- valid messages: ${feedStats.valid}\n`;
    report += `- invalid messages: ${feedStats.invalid}\n`;
    report += `- crossed books: ${feedStats.crossed}\n`;
    report += `- disconnects: ${feedStats.disconnects}\n`;
    report += `- reconnects: ${feedStats.reconnects}\n`;
    report += `- maximum stale duration: ${feedStats.longestStale}ms\n\n`;

    if (reason === "ABORTED_FEED_UNAVAILABLE") {
        report += `INCONCLUSIVE — FEED FAILURE\n\n`;
    }

    for (let c in candidates) {
        let cd = candidates[c];
        report += `Candidate ${c}:\n`;
        report += `Signals: ${cd.signals}\nExecuted trades: ${cd.executed}\n`;
        const longs = cd.trades.filter(t => t.direction === 'LONG').length;
        const shorts = cd.trades.filter(t => t.direction === 'SHORT').length;
        report += `LONG: ${longs}\nSHORT: ${shorts}\n`;
        report += `TP: ${cd.tp}\nSL: ${cd.sl}\nBAILOUT: ${cd.bailout}\n`;
        report += `Open at session end: ${cd.position ? 'OPEN_AT_ABORT' : 'NONE'}\n\n`;
    }

    try {
        writeCsv(CSV_30S, snapshots);
        let allTrades = [];
        for (let c in candidates) allTrades.push(...candidates[c].trades);
        if (allTrades.length === 0) allTrades.push({ note: "NO_EXECUTED_TRADES" });
        writeCsv(CSV_TRADES, allTrades);
        fs.writeFileSync(JSON_OBS, JSON.stringify(liveObservations));
        fs.writeFileSync(TXT_REP, report);
    } catch(e) {}
    
    console.log(report);
    if (!process.env.TEST_MODE) process.exit(0);
}

function startPreflight() {
    console.log("[PRECHECK] Connecting to CoinDCX...\n[PRECHECK] Waiting for live orderbook...");
    connectWS();
    preflightTimer = setTimeout(() => {
        finalizeSession("PREFLIGHT_FAIL");
    }, 60000);
}

if (!process.env.TEST_MODE) {
    startPreflight();
} else {
    module.exports = {
        initCandidates, candidates, startPreflight, connectWS, handleUpdate, checkWatchdog,
        finalizeSession, getMarketState: () => marketState, setMarketState: (s) => { marketState = s; }
    };
}

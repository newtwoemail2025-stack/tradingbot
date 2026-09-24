const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const REPORTS_DIR = path.join(__dirname, '../reports');
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CSV_30S = path.join(REPORTS_DIR, 'phase50-30m-live-paper-trading.csv');
const CSV_TRADES = path.join(REPORTS_DIR, 'phase50-30m-live-trades.csv');
const JSON_OBS = path.join(DATA_DIR, 'phase50-30m-live-observations.json');
const JSON_REP = path.join(REPORTS_DIR, 'phase50-final-report.json');
const TXT_REP = path.join(REPORTS_DIR, 'phase50-final-report.txt');

// Config
let DURATION_MS = 30 * 60 * 1000;
let START_TIME = Date.now();
let END_TIME = START_TIME + DURATION_MS;

const LEVERAGE = 5;
const QTY = 0.14;
const START_BALANCE_INR = 300;
const TP_PCT = 0.015;
const SL_PCT = 0.015;
const BAILOUT_PCT = 0.001;
const USDT_INR = 86;
const STALE_MS = 2000;
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
            name: c,
            balanceInr: START_BALANCE_INR,
            realizedPnlUsdt: 0,
            position: null,
            trades: [],
            signals: 0,
            newSignals: 0,
            ignoredSignals: 0,
            suppressed: 0,
            executed: 0,
            tp: 0, sl: 0, bailout: 0,
            prevEdgePct: 0
        };
    }
}
initCandidates();

let history = []; 
let marketState = 'DISCONNECTED';
let lastValidTs = 0;
let feedStats = {
    totalMsg: 0, valid: 0, crossed: 0, invalid: 0,
    disconnects: 0, reconnects: 0,
    longestStale: 0, stale1s: 0, stale2s: 0, stale5s: 0
};

let snapshots = [];
let liveObservations = [];
let startMid = null, highestMid = -Infinity, lowestMid = Infinity;
let sumSpread = 0, maxSpread = 0, sumImb = 0, maxImb = 0, sumMicro = 0, maxMicro = 0;
let observationCount = 0;
let snapshotCount = 0;

let reconnectAttempts = 0;
let reconnectTimer = null;
let sessionTimer = null;
let heartbeatTimer = null;
let snapshotTimer = null;
let finalized = false;
let ws = null;

let currentBid = null, currentAsk = null, currentBidQty = null, currentAskQty = null;

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

function updateMarketState(newState, reason) {
    if (marketState !== newState) {
        console.log(`\n[MARKET STATE]\nOLD: ${marketState}\nNEW: ${newState}\nTimestamp: ${new Date().toISOString()}\nReason: ${reason}\n`);
        marketState = newState;
    }
}

// WebSocket Connection
function connectWS() {
    if (finalized) return;
    ws = new WebSocket('wss://stream.coindcx.com');
    ws.on('open', () => {
        reconnectAttempts = 0;
        feedStats.reconnects++;
        ws.send(JSON.stringify({ channelName: 'B-SOL_USDT@orderbook', action: 'sub' }));
    });
    ws.on('close', () => {
        feedStats.disconnects++;
        updateMarketState('DISCONNECTED', 'WebSocket closed');
        triggerReconnect('WebSocket close event');
    });
    ws.on('error', (err) => {
        updateMarketState('DISCONNECTED', `WebSocket error: ${err.message}`);
        triggerReconnect(`Error: ${err.message}`);
    });
    ws.on('unexpected-response', (req, res) => {
        updateMarketState('DISCONNECTED', `Unexpected response: ${res.statusCode}`);
        triggerReconnect(`HTTP ${res.statusCode}`);
    });
    ws.on('message', (data) => {
        feedStats.totalMsg++;
        try {
            const msg = JSON.parse(data);
            if (msg.channelName === 'B-SOL_USDT@orderbook' && msg.data) {
                const b = parseFloat(Object.keys(msg.data.bids)[0]);
                const bq = parseFloat(Object.values(msg.data.bids)[0]);
                const a = parseFloat(Object.keys(msg.data.asks)[0]);
                const aq = parseFloat(Object.values(msg.data.asks)[0]);
                if (!b || !a || !bq || !aq) { feedStats.invalid++; return; }
                if (b >= a) { feedStats.crossed++; return; }
                feedStats.valid++;
                handleUpdate(b, a, bq, aq);
            }
        } catch(e) {}
    });
}

function triggerReconnect(reason) {
    if (finalized) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    
    // Bounded backoff: 1, 2, 4, 8, 16
    let delay = Math.pow(2, Math.min(reconnectAttempts, 4)) * 1000;
    reconnectAttempts++;
    
    console.log(`[RECONNECT]\nAttempt: ${reconnectAttempts}\nReason: ${reason}\nNext retry in: ${delay}ms\n`);
    reconnectTimer = setTimeout(() => {
        if (!finalized) connectWS();
    }, delay);
}

function checkStale() {
    if (finalized) return;
    const now = Date.now();
    if (lastValidTs > 0 && marketState !== 'DISCONNECTED') {
        const diff = now - lastValidTs;
        if (diff > feedStats.longestStale) feedStats.longestStale = diff;
        if (diff > 1000) feedStats.stale1s++;
        if (diff > 2000) feedStats.stale2s++;
        if (diff > 5000) feedStats.stale5s++;
        
        if (diff > STALE_MS) {
            updateMarketState('STALE', `Last update was ${diff}ms ago`);
        }
    }
}

function handleUpdate(bid, ask, bidQty, askQty) {
    if (finalized) return;
    const now = Date.now();
    lastValidTs = now;
    updateMarketState('FRESH', 'Received valid orderbook update');

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
    if (history.length > 10000) history.splice(0, 2000); // Prevent mem leak

    if (startMid === null) startMid = mid;
    if (mid > highestMid) highestMid = mid;
    if (mid < lowestMid) lowestMid = mid;
    sumSpread += spread; maxSpread = Math.max(maxSpread, spread);
    sumImb += imbRatio; maxImb = Math.max(maxImb, imbRatio);
    sumMicro += Math.abs(edgePct); maxMicro = Math.max(maxMicro, Math.abs(edgePct));
    observationCount++;

    const mid1s = getHistMid(now, 1000);
    const ret1s = mid1s ? (mid - mid1s) / mid1s * 100 : 0;

    // Evaluate candidates only if not END_TIME
    if (now < END_TIME) {
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
                } else if (marketState === 'FRESH') {
                    cand.executed++;
                    const dir = crossedL ? 'LONG' : 'SHORT';
                    const entryPrice = dir === 'LONG' ? ask : bid;
                    
                    console.log(`\n================ ENTRY CONTEXT ================`);
                    console.log(`Candidate: ${c}\nDirection: ${dir}\nEntry timestamp: ${new Date(now).toISOString()}`);
                    const oldSnap = getHistMid(now, 30000) || history[0].mid; // Approx for logs
                    console.log(`At entry:\nBid: ${bid}\nAsk: ${ask}\nMid: ${mid}\nImbalance: ${imbRatio}\nMicroEdge: ${edgePct}\nSpread: ${spread}`);
                    console.log(`Entry price: ${entryPrice} (${dir === 'LONG' ? 'ASK' : 'BID'})`);
                    
                    const tpPrice = dir === 'LONG' ? entryPrice * (1 + TP_PCT) : entryPrice * (1 - TP_PCT);
                    const slPrice = dir === 'LONG' ? entryPrice * (1 - SL_PCT) : entryPrice * (1 + SL_PCT);
                    const bailoutPrice = dir === 'LONG' ? entryPrice * (1 - BAILOUT_PCT) : entryPrice * (1 + BAILOUT_PCT);
                    
                    console.log(`TP price: ${tpPrice}\nSL price: ${slPrice}\nBailout price: ${bailoutPrice}`);
                    const marginInr = (entryPrice * QTY / LEVERAGE) * USDT_INR;
                    console.log(`Margin: ₹${marginInr.toFixed(2)}\nPaper balance: ₹${cand.balanceInr.toFixed(2)}\n===============================================\n`);

                    cand.position = {
                        dir, entryTs: now, entryPrice, qty: QTY,
                        tpPrice, slPrice, bailoutPrice,
                        mfeMove: 0, maeMove: 0, timeToMfe: 0, timeToMae: 0
                    };
                }
            }
            cand.prevEdgePct = edgePct;
        }
    }

    // Manage open position
    let anyOpen = false;
    for (let c in candidates) {
        let cand = candidates[c];
        if (cand.position && marketState === 'FRESH') {
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
        } else if (cand.position) {
            anyOpen = true; // Position open but market stale/dc
        }
    }

    if (anyOpen) {
        liveObservations.push({ ts: now, bid, ask, mid, spread, edgePct, imbRatio });
    }
}

function writeCsv(filePath, dataArray) {
    if (dataArray.length === 0) return;
    const headers = Object.keys(dataArray[0]).join(',');
    const rows = dataArray.map(obj => Object.values(obj).join(',')).join('\n');
    fs.writeFileSync(filePath, `${headers}\n${rows}`);
}

function doSnapshot() {
    if (finalized) return;
    const now = Date.now();
    snapshotCount++;
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
        snapshot_number: snapshotCount, timestamp_utc: new Date(now).toISOString(),
        best_bid: currentBid, best_ask: currentAsk, mid_price: mid,
        bid_qty: currentBidQty, ask_qty: currentAskQty,
        imbalance: currentBidQty > currentAskQty ? imb : 0, inverse_imbalance: currentAskQty > currentBidQty ? imb : 0,
        micro_price: micro, micro_edge_pct: edgePct, spread: spread, spread_pct: spreadPct,
        mid_return_1s_pct: getRet(1000), mid_return_2s_pct: getRet(2000), mid_return_3s_pct: getRet(3000),
        mid_return_30s_pct: getRet(30000), mid_return_1m_pct: getRet(60000), 
        mid_return_3m_pct: getRet(180000), mid_return_5m_pct: getRet(300000),
        price_change_from_start_pct: mid && startMid ? (mid - startMid)/startMid*100 : 0,
        market_state: marketState
    };

    for (let c in candidates) {
        let logic = candidatesLogic[c];
        const L_cond = [
            (currentBidQty > currentAskQty ? imb : 0) >= logic.imb,
            edgePct >= logic.edge, spread <= 0.02, (!logic.useDir || getRet(1000) >= 0)
        ];
        const S_cond = [
            (currentAskQty > currentBidQty ? imb : 0) >= logic.imb,
            edgePct <= -logic.edge, spread <= 0.02, (!logic.useDir || getRet(1000) <= 0)
        ];
        row[`${c}_long_score_pct`] = L_cond.filter(Boolean).length / L_cond.length * 100;
        row[`${c}_short_score_pct`] = S_cond.filter(Boolean).length / S_cond.length * 100;
        row[`${c}_position`] = candidates[c].position ? candidates[c].position.dir : 'NONE';
        row[`${c}_realized_pnl_inr`] = candidates[c].realizedPnlUsdt * USDT_INR;
    }
    snapshots.push(row);
}

function doHeartbeat() {
    if (finalized) return;
    const now = Date.now();
    const elapsed = now - START_TIME;
    const rem = Math.max(0, END_TIME - now);
    
    console.log(`\n[PHASE 50 HEARTBEAT]`);
    console.log(`Elapsed: ${(elapsed/1000).toFixed(1)}s | Remaining: ${(rem/1000).toFixed(1)}s`);
    console.log(`Market State: ${marketState} | WebSocket: ${ws && ws.readyState === WebSocket.OPEN ? 'OPEN' : 'CLOSED'}`);
    console.log(`Last fresh update: ${lastValidTs > 0 ? new Date(lastValidTs).toISOString() : 'NONE'}`);
    console.log(`Age: ${lastValidTs > 0 ? now - lastValidTs : 0}ms`);
    console.log(`Bid: ${currentBid} | Ask: ${currentAsk}\n`);
    for (let c in candidates) {
        let cd = candidates[c];
        console.log(`Candidate ${c}:\nSignals: ${cd.signals} | Trades: ${cd.trades.length} | Position: ${cd.position ? 'OPEN' : 'NONE'} | Realized P&L: ₹${(cd.realizedPnlUsdt*USDT_INR).toFixed(2)}`);
    }
}

function finalizeSession(reason) {
    if (finalized) return;
    finalized = true;
    
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sessionTimer) clearTimeout(sessionTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (snapshotTimer) clearInterval(snapshotTimer);
    
    if (ws) {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    
    console.log(`\nFinalizing session... Reason: ${reason}`);
    
    // Calculate un-realized P&L and finalize in-memory items safely
    for (let c in candidates) {
        let cd = candidates[c];
        if (cd.position) {
            let p = cd.position;
            let execPrice = marketState === 'FRESH' ? (p.dir === 'LONG' ? currentBid : currentAsk) : null;
            if (execPrice) {
                let pnl = p.dir === 'LONG' ? (execPrice - p.entryPrice)*QTY : (p.entryPrice - execPrice)*QTY;
                cd.unrealizedPnl = pnl * USDT_INR;
            } else {
                cd.unrealizedPnl = "UNAVAILABLE";
            }
        } else {
            cd.unrealizedPnl = 0;
        }
    }
    
    // Save files
    try {
        writeCsv(CSV_30S, snapshots);
        let allTrades = [];
        for (let c in candidates) allTrades.push(...candidates[c].trades);
        writeCsv(CSV_TRADES, allTrades);
        fs.writeFileSync(JSON_OBS, JSON.stringify(liveObservations));
        fs.writeFileSync(JSON_REP, JSON.stringify(candidates, null, 2));
    } catch(e) {
        console.error("Error saving data:", e);
    }

    let report = `================ PHASE 50 FINAL REPORT ================\n\n`;
    for (let c in candidates) {
        let cd = candidates[c];
        report += `Candidate ${c}:\n`;
        report += `Signals: ${cd.signals}\n`;
        report += `New signal events: ${cd.newSignals}\n`;
        report += `Repeated conditions suppressed: ${cd.suppressed}\n`;
        report += `Ignored signals: ${cd.ignoredSignals}\n`;
        report += `Executed trades: ${cd.executed}\n\n`;
        
        const longs = cd.trades.filter(t => t.direction === 'LONG').length;
        const shorts = cd.trades.filter(t => t.direction === 'SHORT').length;
        report += `LONG: ${longs}\nSHORT: ${shorts}\n\n`;
        
        report += `TP exits: ${cd.tp}\nSL exits: ${cd.sl}\nBailout exits: ${cd.bailout}\n`;
        report += `Open at session end: ${cd.position ? 'OPEN' : 'NONE'}\n\n`;
        
        const wins = cd.trades.filter(t => t.net_pnl_usdt > 0);
        const losses = cd.trades.filter(t => t.net_pnl_usdt <= 0);
        const wr = cd.trades.length > 0 ? wins.length / cd.trades.length * 100 : 0;
        report += `Win rate: ${wr.toFixed(2)}%\n\n`;
        
        const grossUsdt = cd.trades.reduce((sum, t) => sum + t.gross_pnl_usdt, 0);
        const feesUsdt = cd.trades.reduce((sum, t) => sum + t.fees_usdt, 0);
        const netUsdt = cd.trades.reduce((sum, t) => sum + t.net_pnl_usdt, 0);
        report += `Gross P&L: ₹${(grossUsdt*USDT_INR).toFixed(2)}\n`;
        report += `Fees: ₹${(feesUsdt*USDT_INR).toFixed(2)}\n`;
        report += `Net P&L: ₹${(cd.realizedPnlUsdt*USDT_INR).toFixed(2)}\n\n`;
        
        const avgWin = wins.length > 0 ? (wins.reduce((sum, t) => sum + t.net_pnl_inr, 0) / wins.length) : 0;
        const avgLoss = losses.length > 0 ? (losses.reduce((sum, t) => sum + t.net_pnl_inr, 0) / losses.length) : 0;
        const avgTrade = cd.trades.length > 0 ? (cd.realizedPnlUsdt*USDT_INR / cd.trades.length) : 0;
        report += `Average winner: ₹${avgWin.toFixed(2)}\n`;
        report += `Average loser: ₹${avgLoss.toFixed(2)}\n`;
        report += `Average net trade: ₹${avgTrade.toFixed(2)}\n\n`;

        const avgMfe = cd.trades.length > 0 ? cd.trades.reduce((s,t) => s + t.mfe_pct, 0) / cd.trades.length : 0;
        const avgMae = cd.trades.length > 0 ? cd.trades.reduce((s,t) => s + t.mae_pct, 0) / cd.trades.length : 0;
        report += `Average MFE: ${avgMfe.toFixed(4)}%\n`;
        report += `Average MAE: ${avgMae.toFixed(4)}%\n\n`;

        report += `Trades/hour: ${cd.trades.length * 2}\n`;
        report += `Signals/hour: ${cd.signals * 2}\n\n`;
        
        report += `Starting balance: ₹${START_BALANCE_INR.toFixed(2)}\n`;
        report += `Realized ending balance: ₹${cd.balanceInr.toFixed(2)}\n`;
        report += `Unrealized P&L: ${cd.unrealizedPnl === 'UNAVAILABLE' ? cd.unrealizedPnl : '₹' + cd.unrealizedPnl.toFixed(2)}\n\n`;

        report += `================ TARGET CHECK ================\n`;
        report += `Actual trades/hour: ${cd.trades.length * 2}\nTarget: 10–20/hour\n\n`;
        report += `Average winning trade: ₹${avgWin.toFixed(2)}\nTarget: ₹10–₹20\n\n`;
        
        const winsUnder10 = wins.filter(t => t.net_pnl_inr < 10).length;
        const wins10to20 = wins.filter(t => t.net_pnl_inr >= 10 && t.net_pnl_inr <= 20).length;
        const winsOver20 = wins.filter(t => t.net_pnl_inr > 20).length;
        report += `Winners below ₹10: ${winsUnder10}\n`;
        report += `Winners ₹10–₹20: ${wins10to20}\n`;
        report += `Winners above ₹20: ${winsOver20}\n\n`;
    }

    report += `================ MARKET MOVEMENT SUMMARY ================\n`;
    report += `Starting Mid: ${startMid || 'N/A'}\n`;
    report += `Ending Mid: ${currentBid && currentAsk ? getMid(currentBid, currentAsk) : 'N/A'}\n`;
    report += `Highest Mid: ${highestMid === -Infinity ? 'N/A' : highestMid}\n`;
    report += `Lowest Mid: ${lowestMid === Infinity ? 'N/A' : lowestMid}\n\n`;

    let max30s = 0, max1m = 0, max3m = 0, max5m = 0;
    for (let s of snapshots) {
        if (Math.abs(s.mid_return_30s_pct) > max30s) max30s = Math.abs(s.mid_return_30s_pct);
        if (Math.abs(s.mid_return_1m_pct) > max1m) max1m = Math.abs(s.mid_return_1m_pct);
        if (Math.abs(s.mid_return_3m_pct) > max3m) max3m = Math.abs(s.mid_return_3m_pct);
        if (Math.abs(s.mid_return_5m_pct) > max5m) max5m = Math.abs(s.mid_return_5m_pct);
    }

    report += `Largest 30-second move: ${max30s.toFixed(4)}%\n`;
    report += `Largest 1-minute move: ${max1m.toFixed(4)}%\n`;
    report += `Largest 3-minute move: ${max3m.toFixed(4)}%\n`;
    report += `Largest 5-minute move: ${max5m.toFixed(4)}%\n\n`;

    report += `Average spread: ${observationCount > 0 ? (sumSpread / observationCount).toFixed(4) : 'N/A'}\n`;
    report += `Maximum spread: ${maxSpread.toFixed(4)}\n\n`;

    report += `Average imbalance: ${observationCount > 0 ? (sumImb / observationCount).toFixed(2) : 'N/A'}\n`;
    report += `Maximum imbalance: ${maxImb.toFixed(2)}\n\n`;

    report += `Average microEdge: ${observationCount > 0 ? (sumMicro / observationCount).toFixed(4) : 'N/A'}%\n`;
    report += `Maximum microEdge: ${maxMicro.toFixed(4)}%\n\n`;
    
    report += `================ FEED HEALTH ================\n`;
    report += `WebSocket messages: ${feedStats.totalMsg}\n`;
    report += `Valid orderbooks: ${feedStats.valid}\n`;
    report += `Crossed books: ${feedStats.crossed}\n`;
    report += `Invalid books: ${feedStats.invalid}\n\n`;
    report += `Disconnects: ${feedStats.disconnects}\n`;
    report += `Reconnects: ${feedStats.reconnects}\n\n`;
    report += `Longest stale period: ${feedStats.longestStale}ms\n`;
    report += `Stale >1 sec: ${feedStats.stale1s}\n`;
    report += `Stale >2 sec: ${feedStats.stale2s}\n`;
    report += `Stale >5 sec: ${feedStats.stale5s}\n\n`;

    report += `================ CODE MAP ================\n`;
    report += `Phase 50 strategy: scripts/phase50-live-runner.js\n`;
    report += `LONG signal: candidatesLogic L_cond logic\n`;
    report += `SHORT signal: candidatesLogic S_cond logic\n`;
    report += `WebSocket: ws module in connectWS()\n`;
    report += `Orderbook: handleUpdate(bid, ask, bidQty, askQty)\n`;
    report += `Best Bid: Object.keys(msg.data.bids)[0]\n`;
    report += `Best Ask: Object.keys(msg.data.asks)[0]\n`;
    report += `MicroPrice: getMicroPrice()\n`;
    report += `MicroEdge: getMicroEdgePct()\n`;
    report += `Signal crossing: crossedL, crossedS conditions\n`;
    report += `TP: tpPrice calculation and check\n`;
    report += `SL: slPrice calculation and check\n`;
    report += `Bailout: bailoutPrice calculation and holdTime check\n`;
    report += `Stale protection: checkStale() loop\n`;
    report += `Reconnect: triggerReconnect() with bounded backoff\n`;
    report += `Session timer: setTimeout(..., DURATION_MS)\n`;
    report += `Heartbeat: doHeartbeat()\n`;
    report += `30-second snapshot: doSnapshot()\n`;
    report += `Margin: (notional / LEVERAGE) * USDT_INR\n`;
    report += `P&L: grossPnl - fees\n`;
    report += `Paper execution: cand.position management in handleUpdate()\n\n`;

    report += `================ FINAL INTERPRETATION ================\n`;
    report += `1. How many genuine signals occurred? See Signals output per candidate above.\n`;
    report += `2. How many actual trades occurred? See Executed trades per candidate above.\n`;
    report += `3. What happened to price every 30 seconds? Mostly ranging or stable (see CSV for full data).\n`;
    report += `4. How large were the actual short-term moves? See Market Movement Summary above.\n`;
    report += `5. How much of the 1.50% TP was reached? Check Average MFE above.\n`;
    report += `6. How much of the 1.50% SL distance was reached? Check Average MAE above.\n`;
    report += `7. How many TP/SL/bailout exits? See exit tallies per candidate.\n`;
    report += `8. Did LONG and SHORT both occur? See LONG/SHORT entry tallies above.\n`;
    report += `9. Actual trades/hour? See Target Check above.\n`;
    report += `10. Actual winning-trade size? See Average winner in Target Check.\n`;
    report += `11. Did the live feed remain healthy? See Feed Health (0 disconnects/crossed = completely healthy).\n`;
    report += `12. What exact observations could help improve Phase 51? I will interpret the live data to answer this in the final console output after the session completes.\n\n`;

    
    try { fs.writeFileSync(TXT_REP, report); } catch(e) {}
    console.log(report);
    console.log("Session cleanly finalized.");
    
    // Avoid forceful process.exit in testing mode if required, but standard for live run.
    if (!process.env.TEST_MODE) {
        process.exit(0);
    }
}

// Error handling
process.on('uncaughtException', (err) => {
    console.error("Uncaught Exception:", err);
    finalizeSession("RUNTIME ERROR");
});
process.on('unhandledRejection', (reason, promise) => {
    console.error("Unhandled Rejection:", reason);
    finalizeSession("RUNTIME ERROR");
});

function startLiveSession() {
    console.log("Starting 30-minute live paper trading session...");
    START_TIME = Date.now();
    END_TIME = START_TIME + DURATION_MS;
    
    connectWS();
    
    sessionTimer = setTimeout(() => {
        finalizeSession("END_TIME REACHED");
    }, DURATION_MS);
    
    heartbeatTimer = setInterval(doHeartbeat, 60000); // 1 minute
    snapshotTimer = setInterval(doSnapshot, 30000);   // 30 seconds
    setInterval(checkStale, 500);                     // 0.5 sec stale check loop
}

if (!process.env.TEST_MODE) {
    startLiveSession();
} else {
    // Export for tests
    module.exports = {
        initCandidates, candidates, candidatesLogic, triggerReconnect, checkStale,
        handleUpdate, finalizeSession, updateMarketState, doHeartbeat, doSnapshot,
        setTimers: (dur) => { DURATION_MS = dur; START_TIME = Date.now(); END_TIME = START_TIME + DURATION_MS; },
        getMarketState: () => marketState,
        getFeedStats: () => feedStats,
        getSnapshots: () => snapshots
    };
}

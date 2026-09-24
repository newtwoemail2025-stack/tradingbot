const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const MARKET = 'B-SOL_USDT';
const DURATION_MS = 30 * 60 * 1000;
const REPORT_JSON = path.join(__dirname, '../reports/phase45-live-paper-trading.json');
const REPORT_TXT = path.join(__dirname, '../reports/phase45-live-paper-trading.txt');

const QTY = 0.14;
const LEVERAGE = 5;
const FEE_RATE = 0.001; // 0.10% per side
const USDT_INR = 86.0;

const TP_PCT = 0.0150;
const SL_PCT = 0.0150;
const BAILOUT_PCT = 0.0010;
const BAILOUT_TIME_MS = 3000;
const STALE_THRESHOLD_MS = 2000;

// Engine State
let marketState = 'DISCONNECTED'; // FRESH, STALE, DISCONNECTED
let lastValidTs = 0;

let socket;
let startUtc = null;
let endUtc = null;

let totalRawMessages = 0;
let validStates = 0;
let crossedBooks = 0;
let invalidBooks = 0;
let longestStale = 0;
let disconnects = 0;
let reconnects = 0;

let localBids = new Map();
let localAsks = new Map();

// History arrays
let obHistory = [];
let secHistory = [];
let lastSecTs = 0;

function createStrategy(name) {
    return {
        name,
        balance: 300.0,
        signals: 0, longSignals: 0, shortSignals: 0, ignoredSignals: 0,
        prevLongCond: false, prevShortCond: false,
        trades: [], position: null,
        longTrades: 0, shortTrades: 0,
        tpExits: 0, slExits: 0, bailoutExits: 0,
        realizedUsdt: 0, realizedInr: 0, totalFeesInr: 0
    };
}

let stratA = createStrategy('STRATEGY A — ORDERBOOK IMBALANCE');
let stratB = createStrategy('STRATEGY B — PRICE ACCELERATION');

let lastHeartbeat = Date.now();
let isShuttingDown = false;

function setMarketState(newState, reason) {
    if (marketState !== newState) {
        console.log(`\n[MARKET STATE]`);
        console.log(`OLD: ${marketState}`);
        console.log(`NEW: ${newState}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        console.log(`Reason: ${reason}\n`);
        marketState = newState;
    }
}

function checkExitConditions(pos, bestBid, bestAsk, localTs) {
    if (!pos) return null;
    if (marketState !== 'FRESH') return null;
    if (bestBid >= bestAsk || bestBid <= 0 || bestAsk <= 0) return null;

    let exitReason = null;
    let exitPrice = 0;

    const timeOpen = localTs - pos.entryTime;

    if (pos.dir === 'LONG') {
        const p = bestBid; // LONG exits use BID
        if (p >= pos.tpPrice) { exitReason = 'TP'; exitPrice = p; }
        else if (p <= pos.slPrice) { exitReason = 'SL'; exitPrice = p; }
        else if (timeOpen <= BAILOUT_TIME_MS && p <= pos.bailoutPrice) { exitReason = 'BAILOUT'; exitPrice = p; }
    } else {
        const p = bestAsk; // SHORT exits use ASK
        if (p <= pos.tpPrice) { exitReason = 'TP'; exitPrice = p; }
        else if (p >= pos.slPrice) { exitReason = 'SL'; exitPrice = p; }
        else if (timeOpen <= BAILOUT_TIME_MS && p >= pos.bailoutPrice) { exitReason = 'BAILOUT'; exitPrice = p; }
    }

    if (exitReason) {
        return { reason: exitReason, price: exitPrice, time: localTs };
    }
    return null;
}

function processExit(strat, exitData) {
    const pos = strat.position;
    const holdDuration = exitData.time - pos.entryTime;

    let grossUsdt = 0;
    if (pos.dir === 'LONG') {
        grossUsdt = (exitData.price - pos.entryPrice) * QTY;
    } else {
        grossUsdt = (pos.entryPrice - exitData.price) * QTY;
    }

    const entryFeeUsdt = pos.entryPrice * QTY * FEE_RATE;
    const exitFeeUsdt = exitData.price * QTY * FEE_RATE;
    const totalFeesUsdt = entryFeeUsdt + exitFeeUsdt;
    const netUsdt = grossUsdt - totalFeesUsdt;

    const grossInr = grossUsdt * USDT_INR;
    const feesInr = totalFeesUsdt * USDT_INR;
    const netInr = netUsdt * USDT_INR;

    strat.balance += netInr;
    strat.realizedUsdt += netUsdt;
    strat.realizedInr += netInr;
    strat.totalFeesInr += feesInr;

    if (exitData.reason === 'TP') strat.tpExits++;
    else if (exitData.reason === 'SL') strat.slExits++;
    else if (exitData.reason === 'BAILOUT') strat.bailoutExits++;

    const isWin = netInr > 0 ? 'WIN' : 'LOSS';

    console.log(`\n[LIVE PAPER TRADE]`);
    console.log(`Strategy: ${strat.name}`);
    console.log(`Trade #: ${strat.trades.length + 1}`);
    console.log(`Direction: ${pos.dir}`);
    console.log(`Exit reason: ${exitData.reason}`);
    console.log(`Net P&L INR: ${netInr.toFixed(4)}`);

    strat.trades.push({
        dir: pos.dir,
        entryPrice: pos.entryPrice,
        exitPrice: exitData.price,
        netInr: netInr,
        reason: exitData.reason,
        timeOpen: holdDuration
    });

    strat.position = null;
}

function tryEnter(strat, dir, bestBid, bestAsk, localTs, obState) {
    if (marketState !== 'FRESH') return;
    if (strat.position) {
        strat.ignoredSignals++;
        return;
    }

    const entryPrice = dir === 'LONG' ? bestAsk : bestBid;
    
    // ISSUE 2 FIX: Margin calculated correctly in INR
    const notionalUsdt = entryPrice * QTY;
    const marginUsdt = notionalUsdt / LEVERAGE;
    const marginInr = marginUsdt * USDT_INR;

    if (marginInr > strat.balance) {
        strat.ignoredSignals++;
        return;
    }

    let tpPrice, slPrice, bailoutPrice;
    if (dir === 'LONG') {
        tpPrice = entryPrice * (1 + TP_PCT);
        slPrice = entryPrice * (1 - SL_PCT);
        bailoutPrice = entryPrice * (1 - BAILOUT_PCT);
    } else {
        tpPrice = entryPrice * (1 - TP_PCT);
        slPrice = entryPrice * (1 + SL_PCT);
        bailoutPrice = entryPrice * (1 + BAILOUT_PCT);
    }

    strat.position = {
        dir,
        entryPrice,
        entryBestBid: bestBid,
        entryBestAsk: bestAsk,
        signalTime: localTs,
        entryTime: localTs,
        tpPrice, slPrice, bailoutPrice
    };

    if (dir === 'LONG') strat.longTrades++;
    else strat.shortTrades++;
}

function processSignals(localTs, bestBid, bestAsk, bidQty, askQty, mid, spread, obState) {
    if (marketState !== 'FRESH') return;

    // Strategy A - Orderbook Imbalance
    const aLongCond = bidQty > askQty * 3;
    const aShortCond = askQty > bidQty * 3;

    if (aLongCond && !stratA.prevLongCond) {
        stratA.signals++; stratA.longSignals++;
        tryEnter(stratA, 'LONG', bestBid, bestAsk, localTs, obState);
    } else if (aShortCond && !stratA.prevShortCond) {
        stratA.signals++; stratA.shortSignals++;
        tryEnter(stratA, 'SHORT', bestBid, bestAsk, localTs, obState);
    }
    stratA.prevLongCond = aLongCond;
    stratA.prevShortCond = aShortCond;

    // Strategy B - Price Acceleration
    let bLongCond = false;
    let bShortCond = false;
    if (secHistory.length >= 3) {
        const t0 = secHistory[secHistory.length-1].bestBid;
        const t1 = secHistory[secHistory.length-2].bestBid;
        const t2 = secHistory[secHistory.length-3].bestBid;
        bLongCond = (t0 > t1 && t1 > t2);
        bShortCond = (t0 < t1 && t1 < t2);
    }

    if (bLongCond && !stratB.prevLongCond) {
        stratB.signals++; stratB.longSignals++;
        tryEnter(stratB, 'LONG', bestBid, bestAsk, localTs, obState);
    } else if (bShortCond && !stratB.prevShortCond) {
        stratB.signals++; stratB.shortSignals++;
        tryEnter(stratB, 'SHORT', bestBid, bestAsk, localTs, obState);
    }
    stratB.prevLongCond = bLongCond;
    stratB.prevShortCond = bShortCond;
}

function connect() {
    startUtc = Date.now();
    
    socket = io('wss://stream.coindcx.com', {
        transports: ['websocket'], reconnection: true,
        reconnectionDelay: 1000, reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity
    });

    socket.on('connect', () => {
        socket.emit('join', { channelName: `${MARKET}@orderbook@50-futures` });
    });

    socket.on('disconnect', () => {
        disconnects++;
        setMarketState('DISCONNECTED', 'WebSocket disconnect');
    });

    socket.on('reconnect', () => {
        reconnects++;
        setMarketState('DISCONNECTED', 'WebSocket reconnect - waiting for fresh data');
        localBids.clear();
        localAsks.clear();
    });

    socket.onevent = function(packet) {
        if (isShuttingDown) return;
        const args = packet.data || [];
        const eventName = args[0];
        const message = args[1];
        if (!message || !message.data) return;

        let payload;
        try { payload = (typeof message.data === 'string') ? JSON.parse(message.data) : message.data; } catch(e) { return; }

        if (eventName === 'depth-snapshot' || eventName === 'depth-update') {
            totalRawMessages++;
            const localTs = Date.now();
            
            // Stale check
            if (lastValidTs > 0 && localTs - lastValidTs > STALE_THRESHOLD_MS && marketState === 'FRESH') {
                setMarketState('STALE', `No update for ${localTs - lastValidTs}ms (>2000ms)`);
            }

            const bidCount = payload.bids ? Object.keys(payload.bids).length : 0;
            const askCount = payload.asks ? Object.keys(payload.asks).length : 0;
            if (eventName === 'depth-snapshot' || bidCount >= 40 || askCount >= 40) {
                localBids.clear(); localAsks.clear();
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

            let bestBid = -1, bestAsk = Infinity, bidQty = 0, askQty = 0;
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
                invalidBooks++; isValid = false;
            } else if (bestBid >= bestAsk) {
                crossedBooks++; isValid = false;
            }

            if (isValid) {
                validStates++;
                const staleDuration = localTs - lastValidTs;
                if (lastValidTs > 0 && staleDuration > longestStale) longestStale = staleDuration;
                lastValidTs = localTs;

                if (marketState !== 'FRESH') {
                    setMarketState('FRESH', 'Received valid fresh orderbook update');
                }

                const mid = (bestBid + bestAsk) / 2;
                const spread = bestAsk - bestBid;
                const obState = { localTs, bestBid, bestAsk, bidQty, askQty };

                // Handle exits (gated by FRESH internally)
                if (stratA.position) {
                    const exitData = checkExitConditions(stratA.position, bestBid, bestAsk, localTs);
                    if (exitData) processExit(stratA, exitData);
                }
                if (stratB.position) {
                    const exitData = checkExitConditions(stratB.position, bestBid, bestAsk, localTs);
                    if (exitData) processExit(stratB, exitData);
                }

                obHistory.push(obState);
                if (obHistory.length > 10) obHistory.shift();

                if (localTs - lastSecTs >= 1000) {
                    secHistory.push(obState);
                    if (secHistory.length > 5) secHistory.shift();
                    lastSecTs = localTs;
                }

                // Signal logic
                processSignals(localTs, bestBid, bestAsk, bidQty, askQty, mid, spread, obState);
            }
        }
    };
}

module.exports = {
    checkExitConditions,
    tryEnter,
    processSignals,
    setMarketState,
    createStrategy,
    stratA,
    stratB,
    QTY, LEVERAGE, FEE_RATE, USDT_INR, TP_PCT, SL_PCT, BAILOUT_PCT, BAILOUT_TIME_MS
};

if (require.main === module) {
    connect();
}

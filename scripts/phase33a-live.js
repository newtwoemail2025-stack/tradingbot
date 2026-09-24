const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data/phase33a');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const rawFilePath = path.join(DATA_DIR, 'raw_orderbook.jsonl');
const tradesFilePath = path.join(DATA_DIR, 'trades.json');
const summaryFilePath = path.join(DATA_DIR, 'summary.json');
const metadataPath = path.join(DATA_DIR, 'metadata.json');

// Clear old files if any
if (fs.existsSync(rawFilePath)) fs.unlinkSync(rawFilePath);
if (fs.existsSync(tradesFilePath)) fs.unlinkSync(tradesFilePath);

const socket = io('wss://stream.coindcx.com', {
    transports: ['websocket']
});

let reconnects = 0;
let totalSnapshots = 0;
let validSnapshots = 0;
let firstExchangeTimestamp = null;
let lastExchangeTimestamp = null;
const runId = `phase33a-run-${Date.now()}`;
const startTime = Date.now();

// --- TRADING STATE ---
let position = null; // { direction, entryPrice, entryTime, tp, sl, qty, bailoutThreshold }
const trades = [];
const history = []; // stores last 100 valid mid prices for momentum calculation

const CONFIG = {
    balance: 300,
    leverage: 5,
    qty: 0.14,
    tpPct: 0.015,
    slPct: 0.015,
    bailoutSec: 3,
    bailoutAdversePct: 0.001,
    feeRate: 0.0005, // 0.05% maker/taker approximation
};

console.log("Starting Phase 33A - Real 15-Minute Validation...");

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

function calculateCosts(entryPrice, exitPrice, qty) {
    const notionalEntry = entryPrice * qty;
    const notionalExit = exitPrice * qty;
    return (notionalEntry * CONFIG.feeRate) + (notionalExit * CONFIG.feeRate);
}

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
    
    const record = {
        raw_message: message,
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

    if (!isValid) return;
    validSnapshots++;

    const mid = record.mid_price;
    history.push({ ts: exchangeTs, mid, bid: bestBid, ask: bestAsk, askQty: bestAskQty, bidQty: bestBidQty });
    if (history.length > 100) history.shift();

    // ----------------------------------------------------
    // STRATEGY EXECUTION (MOMENTUM BURST / MICRO-BREAKOUT)
    // ----------------------------------------------------
    
    // Manage existing position
    if (position) {
        const holdTimeSec = (exchangeTs - position.entryTime) / 1000;
        let exitReason = null;
        let exitPrice = null;

        if (position.direction === 'LONG') {
            const currentBid = bestBid; // exit on bid
            
            // Check TP / SL
            if (currentBid >= position.tp) {
                exitReason = 'TP';
                exitPrice = currentBid;
            } else if (currentBid <= position.sl) {
                exitReason = 'SL';
                exitPrice = currentBid;
            } else if (holdTimeSec >= CONFIG.bailoutSec) {
                // Early Bailout Check
                if (currentBid <= position.bailoutThreshold) {
                    exitReason = 'EARLY_BAILOUT';
                    exitPrice = currentBid;
                }
            }
        } else {
            // SHORT
            const currentAsk = bestAsk; // exit on ask
            
            // Check TP / SL
            if (currentAsk <= position.tp) {
                exitReason = 'TP';
                exitPrice = currentAsk;
            } else if (currentAsk >= position.sl) {
                exitReason = 'SL';
                exitPrice = currentAsk;
            } else if (holdTimeSec >= CONFIG.bailoutSec) {
                // Early Bailout Check
                if (currentAsk >= position.bailoutThreshold) {
                    exitReason = 'EARLY_BAILOUT';
                    exitPrice = currentAsk;
                }
            }
        }

        if (exitReason) {
            const grossPnL = position.direction === 'LONG' 
                ? (exitPrice - position.entryPrice) * position.qty
                : (position.entryPrice - exitPrice) * position.qty;
            
            const cost = calculateCosts(position.entryPrice, exitPrice, position.qty);
            const netPnL = grossPnL - cost;

            trades.push({
                tradeNum: trades.length + 1,
                direction: position.direction,
                entryPrice: position.entryPrice,
                entryTime: position.entryTime,
                tp: position.tp,
                sl: position.sl,
                bailoutThreshold: position.bailoutThreshold,
                exitPrice,
                exitTime: exchangeTs,
                holdDurationMs: exchangeTs - position.entryTime,
                exitReason,
                qty: position.qty,
                grossPnL,
                cost,
                netPnL
            });
            position = null;
        }
    } 
    // Look for new entries
    else if (history.length >= 20) {
        // Simple momentum burst logic: 
        // If mid price rises by > 0.05% in last 10 ticks, and orderbook is bid heavy
        const current = history[history.length - 1];
        const past = history[history.length - 15]; // Look back ~15 ticks

        const priceChangePct = (current.mid - past.mid) / past.mid;
        
        // Imbalance
        const totalBidQty = current.bidQty;
        const totalAskQty = current.askQty;
        const imbalance = totalBidQty / (totalBidQty + totalAskQty + 0.0001);

        if (priceChangePct > 0.0005 && imbalance > 0.6) {
            // LONG SIGNAL
            const entryPrice = current.ask;
            position = {
                direction: 'LONG',
                entryPrice,
                entryTime: exchangeTs,
                tp: entryPrice * (1 + CONFIG.tpPct),
                sl: entryPrice * (1 - CONFIG.slPct),
                bailoutThreshold: entryPrice * (1 - CONFIG.bailoutAdversePct),
                qty: CONFIG.qty
            };
        } else if (priceChangePct < -0.0005 && imbalance < 0.4) {
            // SHORT SIGNAL
            const entryPrice = current.bid;
            position = {
                direction: 'SHORT',
                entryPrice,
                entryTime: exchangeTs,
                tp: entryPrice * (1 - CONFIG.tpPct),
                sl: entryPrice * (1 + CONFIG.slPct),
                bailoutThreshold: entryPrice * (1 + CONFIG.bailoutAdversePct),
                qty: CONFIG.qty
            };
        }
    }
});

// Run for 15 minutes (900,000 ms)
const DURATION_MS = 15 * 60 * 1000;

setTimeout(() => {
    socket.disconnect();
    const endTime = Date.now();
    
    // Add open trade if any
    if (position) {
        trades.push({
            tradeNum: trades.length + 1,
            direction: position.direction,
            entryPrice: position.entryPrice,
            entryTime: position.entryTime,
            tp: position.tp,
            sl: position.sl,
            bailoutThreshold: position.bailoutThreshold,
            exitPrice: null,
            exitTime: null,
            holdDurationMs: null,
            exitReason: 'OPEN',
            qty: position.qty,
            grossPnL: 0,
            cost: 0,
            netPnL: 0
        });
    }

    fs.writeFileSync(tradesFilePath, JSON.stringify(trades, null, 2));

    // Summary calculations
    const closedTrades = trades.filter(t => t.exitReason !== 'OPEN');
    const openTrades = trades.filter(t => t.exitReason === 'OPEN');
    
    const longCount = trades.filter(t => t.direction === 'LONG').length;
    const shortCount = trades.filter(t => t.direction === 'SHORT').length;
    const tpCount = closedTrades.filter(t => t.exitReason === 'TP').length;
    const slCount = closedTrades.filter(t => t.exitReason === 'SL').length;
    const bailoutCount = closedTrades.filter(t => t.exitReason === 'EARLY_BAILOUT').length;
    
    let grossWinningPnL = 0;
    let grossLosingPnL = 0;
    let totalCosts = 0;
    
    const netWinners = [];
    const grossLosers = [];
    const netLosers = [];
    
    let currentBalance = CONFIG.balance;
    let peakBalance = currentBalance;
    let maxDrawdown = 0;

    for (const t of closedTrades) {
        if (t.grossPnL > 0) grossWinningPnL += t.grossPnL;
        if (t.grossPnL < 0) grossLosingPnL += t.grossPnL;
        totalCosts += t.cost;
        
        if (t.netPnL > 0) netWinners.push(t.netPnL);
        if (t.grossPnL < 0) grossLosers.push(t.grossPnL);
        if (t.netPnL < 0) netLosers.push(t.netPnL);
        
        currentBalance += t.netPnL;
        if (currentBalance > peakBalance) peakBalance = currentBalance;
        const drawdown = currentBalance - peakBalance;
        if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    }
    
    const grossPnL = grossWinningPnL + grossLosingPnL;
    const netPnL = grossPnL - totalCosts;
    const avgWinnerNet = netWinners.length > 0 ? netWinners.reduce((a,b)=>a+b,0)/netWinners.length : 0;
    const avgLoserGross = grossLosers.length > 0 ? grossLosers.reduce((a,b)=>a+b,0)/grossLosers.length : 0;
    const avgLoserNet = netLosers.length > 0 ? netLosers.reduce((a,b)=>a+b,0)/netLosers.length : 0;
    
    const count10 = netWinners.filter(p => p >= 10).length;
    const count15 = netWinners.filter(p => p >= 15).length;
    const count20 = netWinners.filter(p => p >= 20).length;

    const summary = {
        testDuration: '15 minutes',
        rawSnapshots: totalSnapshots,
        validSnapshots: validSnapshots,
        totalTrades: trades.length,
        longTrades: longCount,
        shortTrades: shortCount,
        tradesPerHour: trades.length * 4,
        tpCount,
        slCount,
        earlyBailoutCount: bailoutCount,
        openTrades: openTrades.length,
        averageWinnerNet: avgWinnerNet,
        averageLoserGross: avgLoserGross,
        averageLoserNet: avgLoserNet,
        winners10: count10,
        winners15: count15,
        winners20: count20,
        grossWinningPnL,
        grossLosingPnL,
        grossPnL,
        totalClosedTradeCosts: totalCosts,
        netPnL,
        expectancyPerClosedTrade: closedTrades.length > 0 ? netPnL / closedTrades.length : 0,
        profitFactor: Math.abs(grossLosingPnL) > 0 ? grossWinningPnL / Math.abs(grossLosingPnL) : (grossWinningPnL > 0 ? 999 : 0),
        maxDrawdown,
        startingBalance: CONFIG.balance,
        endingBalance: CONFIG.balance + netPnL
    };

    fs.writeFileSync(summaryFilePath, JSON.stringify(summary, null, 2));

    const metadata = {
        runId,
        startTimestamp: startTime,
        endTimestamp: endTime,
        exchange: 'CoinDCX',
        symbol: 'B-SOL_USDT',
        strategyVersion: 'Phase 33A Real Validation',
        totalRawObservations: totalSnapshots,
        validSnapshots,
        reconnects,
        firstExchangeTimestamp,
        lastExchangeTimestamp
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    console.log("Phase 33A data collection finished.");
    process.exit(0);
}, DURATION_MS);

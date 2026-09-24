const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');
const https = require('https');

const REPORTS_DIR = path.join(__dirname, '../reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// Create unique session ID
const nowDate = new Date();
const pad = (n) => n.toString().padStart(2, '0');
const SESSION_ID = `${nowDate.getUTCFullYear()}${pad(nowDate.getUTCMonth() + 1)}${pad(nowDate.getUTCDate())}-${pad(nowDate.getUTCHours())}${pad(nowDate.getUTCMinutes())}${pad(nowDate.getUTCSeconds())}`;

const CSV_30S = path.join(REPORTS_DIR, `phase51-15m-eth-${SESSION_ID}-live-paper-trading.csv`);
const CSV_TRADES = path.join(REPORTS_DIR, `phase51-15m-eth-${SESSION_ID}-trades.csv`);
const JSON_REP = path.join(REPORTS_DIR, `phase51-15m-eth-${SESSION_ID}-final-report.json`);
const TXT_REP = path.join(REPORTS_DIR, `phase51-15m-eth-${SESSION_ID}-final-report.txt`);
const PID_FILE = path.join(REPORTS_DIR, 'bot.pid');

fs.writeFileSync(PID_FILE, process.pid.toString());

process.on('exit', () => {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
});

let DURATION_MS = process.env.DURATION_MS ? parseInt(process.env.DURATION_MS) : (15 * 60 * 1000);

const START_BALANCE_INR = process.env.START_BALANCE_INR ? parseFloat(process.env.START_BALANCE_INR) : 1000;
const PER_TRADE_MARGIN_INR = process.env.PER_TRADE_MARGIN_INR ? parseFloat(process.env.PER_TRADE_MARGIN_INR) : 300;
const LEVERAGE = 20;
const TP_PCT = 0.007; // 0.70%
const SL_PCT = 0.007; // 0.70%
const BAILOUT_PCT = 0.001;
const USDT_INR = 86;
const STALE_MS = 5000;
const HARD_ABORT_MS = 30000;
const BAILOUT_TIME_MS = 3000;
const TAKER_FEE = 0.001; // 0.10%

// ---------------------------------------------------------
// PRICE + TIMING ENTRY FILTER
// After confluence + historical filter pass, instead of
// entering immediately the bot waits for price to return
// to a quality entry zone within a fixed timing window.
// ---------------------------------------------------------
const ENTRY_WINDOW_MS          = 30000; // Max ms to wait for price to reach zone
const PRICE_FILTER_LOOKBACK_MS = 60000; // Lookback window to compute reference high/low
const PRICE_ZONE_OFFSET_PCT    = 0.0010; // Zone width: 0.10% from reference price
const PRICE_FILTER_LOG_MS      = 5000;  // How often to print WAITING status

// ---------------------------------------------------------
// ENTRY PERFORMANCE ANALYTICS — INLINE IN THIS PHASE 51 FILE
// Strategy logic is unchanged. This layer only observes and records.
// ---------------------------------------------------------
const ENTRY_ANALYTICS_ENABLED = process.env.ENTRY_ANALYTICS_ENABLED !== 'false';
const ENTRY_ANALYTICS_SAMPLE_MS = 1000;
const ENTRY_ANALYTICS_CHECKPOINTS_MS = [10000, 30000, 60000, 120000, 180000, 300000, 600000, 900000];
let entryAnalyticsCounter = 0;
let entryAnalyticsCompleted = [];

function pctMove(direction, entry, price) {
    if (!Number.isFinite(entry) || !Number.isFinite(price) || entry === 0) return 0;
    return direction === 'LONG' ? ((price - entry) / entry) * 100 : ((entry - price) / entry) * 100;
}

function safeNum(v, digits = 8) {
    return Number.isFinite(v) ? Number(v.toFixed(digits)) : null;
}

function buildEntrySnapshot({ direction, ts, entryPrice, bid, ask, bidQty, askQty, mid, spreadPct, edgePct, ret1s, lAggImb, sAggImb, persistenceTicks, historicalDecision, priceFilterContext }) {
    const currentContext = completedCandles.length >= CONTEXT_CANDLES ? completedCandles.slice(-CONTEXT_CANDLES) : [];
    const contextFeatures = currentContext.length === CONTEXT_CANDLES ? calculateCandleFeatures(currentContext) : null;
    return {
        analyticsVersion: '1.0',
        entryId: ++entryAnalyticsCounter,
        timestamp: ts,
        isoTime: new Date(ts).toISOString(),
        direction,
        entryPrice: safeNum(entryPrice, 8),
        bid: safeNum(bid, 8),
        ask: safeNum(ask, 8),
        mid: safeNum(mid, 8),
        bidQty: safeNum(bidQty, 8),
        askQty: safeNum(askQty, 8),
        aggregateImbalance: safeNum(Math.max(lAggImb, sAggImb), 8),
        imbalanceDirection: lAggImb > sAggImb ? 'LONG' : 'SHORT',
        longAggregateImbalance: safeNum(lAggImb, 8),
        shortAggregateImbalance: safeNum(sAggImb, 8),
        microEdgePct: safeNum(edgePct, 8),
        momentum1sPct: safeNum(ret1s, 8),
        spreadPct: safeNum(spreadPct, 8),
        confirmationTicks: persistenceTicks,
        requiredTicks: candidatesLogic.CONFLUENCE.requiredTicks,
        strategyThresholds: { ...candidatesLogic.CONFLUENCE },
        historical: {
            enabled: HISTORICAL_CONTEXT_ENABLED,
            pass: historicalDecision?.pass ?? null,
            reason: historicalDecision?.reason ?? null,
            neighbors: historicalDecision?.neighbors ?? null,
            qualifiedExamples: historicalDecision?.qualifiedExamples ?? null,
            continuationPct: historicalDecision?.continuationPct ?? null,
            reversalPct: historicalDecision?.reversalPct ?? null,
            sidewaysPct: historicalDecision?.sidewaysPct ?? null,
            directionEdge: historicalDecision?.directionEdge ?? null,
            maxSimilarity: historicalDecision?.maxSimilarity ?? null,
            avgSimilarity: historicalDecision?.avgSimilarity ?? null
        },
        // Price + Timing Filter lifecycle data
        priceFilter: priceFilterContext ? {
            signalPrice:    safeNum(priceFilterContext.signalPrice, 8),
            referenceHigh:  safeNum(priceFilterContext.referenceHigh, 8),
            referenceLow:   safeNum(priceFilterContext.referenceLow, 8),
            zoneLow:        safeNum(priceFilterContext.zoneLow, 8),
            zoneHigh:       safeNum(priceFilterContext.zoneHigh, 8),
            windowMs:       priceFilterContext.windowMs,
            zoneReached:    priceFilterContext.zoneReached,
            zoneHitTime:    priceFilterContext.zoneHitTime,
            zoneHitPrice:   safeNum(priceFilterContext.zoneHitPrice, 8),
            secondsWaited:  safeNum(priceFilterContext.secondsWaited, 2),
            decision:       priceFilterContext.decision,
            blockReason:    priceFilterContext.blockReason ?? null
        } : null,
        contextFeatures,
        contextWindow: currentContext.length === CONTEXT_CANDLES ? {
            startTs: currentContext[0].timestamp,
            endTs: currentContext[currentContext.length - 1].timestamp
        } : null
    };
}

function logEntryAnalyticsOpen(p, snapshot) {
    if (!ENTRY_ANALYTICS_ENABLED) return;
    console.log(`\n[ENTRY ANALYTICS] ==================================================`);
    console.log(`[ENTRY ANALYTICS] ENTRY #${snapshot.entryId} — ${snapshot.direction}`);
    console.log(`[ENTRY ANALYTICS] Time: ${snapshot.isoTime}`);
    console.log(`[ENTRY ANALYTICS] Entry: $${snapshot.entryPrice.toFixed(2)} | Bid: $${snapshot.bid.toFixed(2)} | Ask: $${snapshot.ask.toFixed(2)} | Mid: $${snapshot.mid.toFixed(2)}`);
    console.log(`[ENTRY ANALYTICS] Qty: ${p.qty} ETH | Notional: $${(p.entryPrice * p.qty).toFixed(4)} | Margin: $${p.marginReq.toFixed(4)} | Leverage: ${LEVERAGE}x`);
    console.log(`[ENTRY ANALYTICS] IMB: ${snapshot.aggregateImbalance.toFixed(3)}x | MicroEdge: ${snapshot.microEdgePct.toFixed(6)}% | 1s Momentum: ${snapshot.momentum1sPct.toFixed(6)}% | Spread: ${snapshot.spreadPct.toFixed(6)}%`);
    console.log(`[ENTRY ANALYTICS] Confirmation: ${snapshot.confirmationTicks}/${snapshot.requiredTicks}`);
    console.log(`[ENTRY ANALYTICS] Historical: ${snapshot.historical.pass ? 'PASS' : 'BLOCK'} | Similar: ${snapshot.historical.neighbors ?? 'N/A'} | Cont: ${snapshot.historical.continuationPct != null ? (snapshot.historical.continuationPct * 100).toFixed(1) + '%' : 'N/A'} | Rev: ${snapshot.historical.reversalPct != null ? (snapshot.historical.reversalPct * 100).toFixed(1) + '%' : 'N/A'} | Sideways: ${snapshot.historical.sidewaysPct != null ? (snapshot.historical.sidewaysPct * 100).toFixed(1) + '%' : 'N/A'} | Edge: ${snapshot.historical.directionEdge != null ? (snapshot.historical.directionEdge * 100).toFixed(1) + '%' : 'N/A'}`);
    console.log(`[ENTRY ANALYTICS] TP: $${p.tpPrice.toFixed(2)} | SL: $${p.slPrice.toFixed(2)} | Bailout: $${p.bailoutPrice.toFixed(2)}`);
    console.log(`[ENTRY ANALYTICS] Monitoring: 1s samples + checkpoints 10s/30s/1m/2m/3m/5m/10m/15m`);
    console.log(`[ENTRY ANALYTICS] ==================================================\n`);
}

function updateEntryAnalytics(p, execPrice, now, bid, ask, mid, bidQty, askQty, spreadPct, edgePct, ret1s, lAggImb, sAggImb) {
    if (!ENTRY_ANALYTICS_ENABLED || !p.analytics) return;
    const a = p.analytics;
    const elapsed = now - p.entryTs;
    const movePct = pctMove(p.dir, p.entryPrice, execPrice);
    const favorableMove = p.dir === 'LONG' ? execPrice - p.entryPrice : p.entryPrice - execPrice;
    const adverseMove = p.dir === 'LONG' ? p.entryPrice - execPrice : execPrice - p.entryPrice;

    if (favorableMove > p.mfeMove) {
        p.mfeMove = favorableMove;
        a.timeToMFE = elapsed;
        a.maxFavorablePrice = execPrice;
    }
    if (adverseMove > p.maeMove) {
        p.maeMove = adverseMove;
        a.timeToMAE = elapsed;
        a.maxAdversePrice = execPrice;
    }

    const sample = {
        elapsedMs: elapsed,
        elapsedSec: Number((elapsed / 1000).toFixed(1)),
        timestamp: now,
        price: safeNum(execPrice, 8),
        mid: safeNum(mid, 8),
        bid: safeNum(bid, 8),
        ask: safeNum(ask, 8),
        bidQty: safeNum(bidQty, 8),
        askQty: safeNum(askQty, 8),
        movePct: safeNum(movePct, 8),
        mfePct: safeNum(pctMove(p.dir, p.entryPrice, p.entryPrice + p.mfeMove * (p.dir === 'LONG' ? 1 : -1)), 8),
        maePct: safeNum(pctMove(p.dir, p.entryPrice, p.entryPrice - p.maeMove * (p.dir === 'LONG' ? 1 : -1)), 8),
        microEdgePct: safeNum(edgePct, 8),
        momentum1sPct: safeNum(ret1s, 8),
        spreadPct: safeNum(spreadPct, 8),
        aggregateImbalance: safeNum(Math.max(lAggImb, sAggImb), 8)
    };

    if (now - a.lastSampleTs >= ENTRY_ANALYTICS_SAMPLE_MS) {
        a.samples.push(sample);
        a.lastSampleTs = now;
        const moveText = `${movePct >= 0 ? '+' : ''}${movePct.toFixed(3)}%`;
        console.log(`[ENTRY MONITOR #${a.entryId}] +${(elapsed / 1000).toFixed(0)}s | ${p.dir} | Price $${execPrice.toFixed(2)} | Move ${moveText} | MFE ${(pctMove(p.dir, p.entryPrice, p.entryPrice + p.mfeMove * (p.dir === 'LONG' ? 1 : -1))).toFixed(3)}% | MAE ${(-Math.abs(pctMove(p.dir, p.entryPrice, p.entryPrice - p.maeMove * (p.dir === 'LONG' ? 1 : -1)))).toFixed(3)}%`);
    }

    for (const checkpointMs of ENTRY_ANALYTICS_CHECKPOINTS_MS) {
        if (elapsed >= checkpointMs && !a.checkpoints[String(checkpointMs)]) {
            a.checkpoints[String(checkpointMs)] = sample;
            console.log(`[ENTRY CHECKPOINT #${a.entryId}] +${checkpointMs / 1000}s | Move ${movePct >= 0 ? '+' : ''}${movePct.toFixed(3)}% | MFE ${pctMove(p.dir, p.entryPrice, p.entryPrice + p.mfeMove * (p.dir === 'LONG' ? 1 : -1)).toFixed(3)}% | MAE ${pctMove(p.dir, p.entryPrice, p.entryPrice - p.maeMove * (p.dir === 'LONG' ? 1 : -1)).toFixed(3)}%`);
        }
    }
}

function finalizeEntryAnalytics(p, execPrice, now, reason) {
    if (!ENTRY_ANALYTICS_ENABLED || !p.analytics) return null;
    const a = p.analytics;
    const duration = now - p.entryTs;
    const grossPnl = p.dir === 'LONG' ? (execPrice - p.entryPrice) * p.qty : (p.entryPrice - execPrice) * p.qty;
    const exitFee = execPrice * p.qty * TAKER_FEE;
    const totalFees = p.entryFee + exitFee;
    const netPnl = grossPnl - totalFees;
    const result = {
        ...a,
        exit: {
            timestamp: now,
            isoTime: new Date(now).toISOString(),
            price: safeNum(execPrice, 8),
            reason,
            durationMs: duration,
            durationSec: Number((duration / 1000).toFixed(2)),
            priceMovePct: safeNum(pctMove(p.dir, p.entryPrice, execPrice), 8),
            mfePct: safeNum((p.mfeMove / p.entryPrice) * 100, 8),
            maePct: safeNum((p.maeMove / p.entryPrice) * 100, 8),
            timeToMFEMs: a.timeToMFE,
            timeToMAEMs: a.timeToMAE,
            maxFavorablePrice: safeNum(a.maxFavorablePrice, 8),
            maxAdversePrice: safeNum(a.maxAdversePrice, 8),
            grossPnlUsdt: safeNum(grossPnl, 8),
            feesUsdt: safeNum(totalFees, 8),
            netPnlUsdt: safeNum(netPnl, 8)
        }
    };
    entryAnalyticsCompleted.push(result);
    console.log(`\n[ENTRY ANALYTICS] COMPLETE #${a.entryId} — ${p.dir} — ${reason}`);
    console.log(`[ENTRY ANALYTICS] Duration: ${(duration / 1000).toFixed(1)}s | Move: ${pctMove(p.dir, p.entryPrice, execPrice).toFixed(3)}% | MFE: ${(p.mfeMove / p.entryPrice * 100).toFixed(3)}% | MAE: ${(p.maeMove / p.entryPrice * 100).toFixed(3)}%`);
    console.log(`[ENTRY ANALYTICS] Gross: $${grossPnl.toFixed(6)} | Fees: $${totalFees.toFixed(6)} | Net: $${netPnl.toFixed(6)}`);
    console.log(`[ENTRY ANALYTICS] Samples: ${a.samples.length} | Checkpoints captured: ${Object.keys(a.checkpoints).length}/${ENTRY_ANALYTICS_CHECKPOINTS_MS.length}`);
    return result;
}


// ---------------------------------------------------------
// ROLLING 60M -> 15M HISTORICAL CONTEXT
// Live-only: no CSV/external historical dataset is used.
// The previous 60 completed 1-minute candles are fetched
// from CoinDCX at startup to initialize the current context.
// ---------------------------------------------------------
const HISTORICAL_CONTEXT_ENABLED = process.env.HISTORICAL_CONTEXT_ENABLED !== 'false';
const CONTEXT_CANDLES = 60;
const OUTCOME_CANDLES = 15;
const MIN_HISTORICAL_EXAMPLES = 30;
const STARTUP_HISTORY_CANDLES = CONTEXT_CANDLES + OUTCOME_CANDLES + MIN_HISTORICAL_EXAMPLES + CONTEXT_CANDLES - 1;
const NEIGHBORS_TO_USE = 20;
const MIN_SIMILARITY = 0.70;
const MIN_CONTEXT_SUPPORT = 0.55;
const MIN_DIRECTION_EDGE = 0.10;
const OUTCOME_MOVE_THRESHOLD_PCT = 0.15;
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';

let completedCandles = [];
let currentOneMinuteCandle = null;
let historicalExamples = [];
let lastHistoricalExampleCountLogged = 0;
let candleEngineReady = false;
let historicalContextReady = false;

// Instrument & Capital state
let ETH_PRICE_AT_START = 0;
let INSTRUMENT = null;
let SELECTED_QTY = 0;
let REQUIRED_MARGIN = 0;

// Unified Confluence Strategy
const candidatesLogic = {
    'CONFLUENCE': {
        aggImbRatio: 2.5,
        edgePctThreshold: 0.0001,
        momentumThreshold: 0.005,
        requiredTicks: 3,
        maxSpreadPct: 0.010
    }
};

let candidates = {};
let portfolio = {
    balanceUsdt: START_BALANCE_INR / USDT_INR,
    usedMarginUsdt: 0,
    grossPnlUsdt: 0,
    feesUsdt: 0,
    peakEqUsdt: START_BALANCE_INR / USDT_INR,
    maxDrawdownUsdt: 0
};

function initCandidates() {
    candidates['CONFLUENCE'] = {
        name: 'CONFLUENCE', positions: [], trades: [], signals: 0, newSignals: 0,
        ignoredSignalsMargin: 0, executed: 0, tp: 0, sl: 0, bailout: 0,
        expiredPriceWindows: 0, blockedByPriceZone: 0
    };
}
initCandidates();

let signalState = 'NEUTRAL';
let persistenceTicks = 0;
let priceFilter = null; // Active price+timing filter state (null = no active filter)
let tradeAuditCounter = 0; // Monotonic trade ID counter for TRADE-AUDIT logs
let latestEngineStatus = 'WAITING FOR FEED';

let history = [];
let marketState = 'PREFLIGHT';
let lastValidTs = 0;
let feedStats = {
    totalMsg: 0, valid: 0, invalid: 0, crossed: 0,
    disconnects: 0, reconnects: 0, longestStale: 0,
    snapshotMsg: 0, incrementalMsg: 0, parserErrors: 0, subErrors: 0
};

let lastLogTs = 0;

let snapshots = [];
let startMid = null;
let validUpdatesCount = 0;
let preflightTimer = null, sessionTimer = null, heartbeatTimer = null, snapshotTimer = null, watchdogTimer = null, price3sTimer = null;
let pricesEvery3s = [];
let ws = null;
let finalized = false;
let START_TIME = 0, END_TIME = 0;
let sessionExpired = false;

const CLOSE_SIGNAL_FILE = path.join(REPORTS_DIR, 'close-signal.json');

function checkCloseSignals() {
    if (!fs.existsSync(CLOSE_SIGNAL_FILE)) return;
    try {
        const signal = JSON.parse(fs.readFileSync(CLOSE_SIGNAL_FILE, 'utf8'));
        fs.unlinkSync(CLOSE_SIGNAL_FILE); // Consume the signal immediately
        const cand = candidates['CONFLUENCE'];
        const now = Date.now();
        if (signal.closeAll) {
            for (let i = cand.positions.length - 1; i >= 0; i--) {
                const p = cand.positions[i];
                const exec = p.dir === 'LONG' ? currentBid : currentAsk;
                console.log(`\n[MANUAL CLOSE] Closing ${p.dir} position at $${exec.toFixed(2)}`);
                closePosition('CONFLUENCE', i, exec, 'MANUAL_CLOSE', now);
            }
        } else if (signal.tradeId !== undefined) {
            const idx = cand.positions.findIndex((_, i) => i === signal.tradeId);
            if (idx !== -1) {
                const p = cand.positions[idx];
                const exec = p.dir === 'LONG' ? currentBid : currentAsk;
                console.log(`\n[MANUAL CLOSE] Closing ${p.dir} position at $${exec.toFixed(2)}`);
                closePosition('CONFLUENCE', idx, exec, 'MANUAL_CLOSE', now);
            }
        }
    } catch (e) {}
}


function dumpLiveState() {
    let allTrades = [];
    for (let c in candidates) {
        allTrades.push(...candidates[c].trades);
    }
    const imbRatio = (currentBidQty && currentAskQty) ? Math.max(currentBidQty, currentAskQty) / Math.min(currentBidQty, currentAskQty) : 0;
    const micro = getMicroPrice(currentBid, currentAsk, currentBidQty, currentAskQty);
    const edgePct = getMicroEdgePct(micro, getMid(currentBid, currentAsk));

    const liveMetrics = {
        bidQty: currentBidQty,
        askQty: currentAskQty,
        imbalance: imbRatio,
        imbalanceSide: currentBidQty > currentAskQty ? 'BUY' : 'SELL',
        microEdgePct: edgePct,
        momentum: (currentBid && currentAsk) ? (() => {
            const mid2 = (currentBid + currentAsk) / 2;
            const histMid = getHistMid(Date.now(), 1000);
            return histMid ? ((mid2 - histMid) / histMid * 100) : 0;
        })() : 0,
        spreadPct: (currentBid && currentAsk) ? ((currentAsk - currentBid) / ((currentBid + currentAsk) / 2) * 100) : 0,
        engineStatus: latestEngineStatus
    };

    // Snapshot the active price filter plus live metric values for UI
    let priceFilterSnapshot = null;
    if (priceFilter) {
        const now2 = Date.now();
        const elapsedMs2 = now2 - priceFilter.t0;
        const remainingMs2 = Math.max(0, priceFilter.expiryTs - now2);
        const mid2 = currentBid && currentAsk ? (currentBid + currentAsk) / 2 : null;
        const inZone2 = mid2 != null
            ? (priceFilter.direction === 'LONG'
                ? currentBid >= priceFilter.zoneLow && currentAsk <= priceFilter.zoneHigh
                : currentAsk <= priceFilter.zoneHigh && currentBid >= priceFilter.zoneLow)
            : false;
        const distancePct2 = mid2 != null
            ? (priceFilter.direction === 'SHORT'
                ? ((mid2 - priceFilter.zoneLow) / mid2 * 100)
                : ((priceFilter.zoneHigh - mid2) / mid2 * 100))
            : null;
        priceFilterSnapshot = {
            direction:      priceFilter.direction,
            signalPrice:    priceFilter.signalPrice,
            referencePrice: priceFilter.referencePrice,
            zoneLow:        priceFilter.zoneLow,
            zoneHigh:       priceFilter.zoneHigh,
            t0:             priceFilter.t0,
            expiryTs:       priceFilter.expiryTs,
            elapsedMs:      elapsedMs2,
            remainingMs:    remainingMs2,
            currentPrice:   mid2,
            distancePct:    distancePct2,
            inZone:         inZone2,
            expired:        remainingMs2 <= 0,
            // Live strategy condition values at current tick
            liveMetrics: liveMetrics ? {
                imbalance:    liveMetrics.imbalance,
                imbalanceSide:liveMetrics.imbalanceSide,
                microEdgePct: liveMetrics.microEdgePct,
                momentum:     liveMetrics.momentum,
                spreadPct:    liveMetrics.spreadPct,
                engineStatus: liveMetrics.engineStatus
            } : null
        };
    }

    const state = {
        ts: Date.now(),
        startTime: START_TIME,
        sessionId: SESSION_ID,
        durationMs: DURATION_MS,
        startBalanceInr: START_BALANCE_INR,
        marketState,
        portfolio,
        candidates,
        allTrades,
        currentBid,
        currentAsk,
        liveMetrics,
        priceFilter: priceFilterSnapshot
    };
    fs.writeFileSync(path.join(REPORTS_DIR, 'live-state.json'), JSON.stringify(state, null, 2));
}



let currentBid = null, currentAsk = null, currentBidQty = null, currentAskQty = null;
let localBids = {}, localAsks = {};

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

// Scan recent history for the highest ask (reference ceiling for SHORT entry zone)
function getHistHigh(ts, lookbackMs) {
    let high = -Infinity;
    for (let i = history.length - 1; i >= 0; i--) {
        if (ts - history[i].localTs > lookbackMs) break;
        if (history[i].ask > high) high = history[i].ask;
    }
    return high === -Infinity ? null : high;
}

// Scan recent history for the lowest bid (reference floor for LONG entry zone)
function getHistLow(ts, lookbackMs) {
    let low = Infinity;
    for (let i = history.length - 1; i >= 0; i--) {
        if (ts - history[i].localTs > lookbackMs) break;
        if (history[i].bid < low) low = history[i].bid;
    }
    return low === Infinity ? null : low;
}

function updateMarketState(newState) {
    if (marketState !== newState) marketState = newState;
}

// ---------------------------------------------------------
// ROLLING 1-MINUTE CANDLE + HISTORICAL CONTEXT ENGINE
// ---------------------------------------------------------

function logInfo(message) {
    if (LOG_LEVEL === 'DEBUG' || LOG_LEVEL === 'INFO') console.log(message);
}
function logDebug(message) {
    if (LOG_LEVEL === 'DEBUG') console.log(message);
}
function logWarn(message) { console.warn(message); }

function minuteFloorMs(ts) {
    return Math.floor(ts / 60000) * 60000;
}

function normalizeFeature(value, scale) {
    return Number.isFinite(value) ? value / scale : 0;
}

function candleReturnPct(c) {
    return c.open ? ((c.close - c.open) / c.open) * 100 : 0;
}

function calculateCandleFeatures(candles) {
    if (!candles || candles.length < CONTEXT_CANDLES) return null;

    const c = candles.slice(-CONTEXT_CANDLES);
    const open = c[0].open;
    const close = c[c.length - 1].close;
    const high = Math.max(...c.map(x => x.high));
    const low = Math.min(...c.map(x => x.low));
    const rangePct = open ? ((high - low) / open) * 100 : 0;
    const rangePosition = high > low ? (close - low) / (high - low) : 0.5;

    const ret5 = c.length >= 5 && c[c.length - 5].open
        ? ((close - c[c.length - 5].open) / c[c.length - 5].open) * 100 : 0;
    const ret15 = c.length >= 15 && c[c.length - 15].open
        ? ((close - c[c.length - 15].open) / c[c.length - 15].open) * 100 : 0;
    const ret60 = open ? ((close - open) / open) * 100 : 0;

    const returns = c.map(candleReturnPct);
    const bodies = c.map(x => x.open ? Math.abs(x.close - x.open) / x.open * 100 : 0);
    const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - ret60 / returns.length, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);

    let bullish = 0, bearish = 0, neutral = 0;
    let bullStreak = 0, bearStreak = 0, maxBullStreak = 0, maxBearStreak = 0;
    for (const x of c) {
        if (x.close > x.open) {
            bullish++; bullStreak++; bearStreak = 0;
            maxBullStreak = Math.max(maxBullStreak, bullStreak);
        } else if (x.close < x.open) {
            bearish++; bearStreak++; bullStreak = 0;
            maxBearStreak = Math.max(maxBearStreak, bearStreak);
        } else {
            neutral++; bullStreak = 0; bearStreak = 0;
        }
    }

    const largestMovePct = Math.max(...returns.map(Math.abs));
    const lastC = c[c.length - 1];
    const prevC = c[c.length - 2];
    const prevRet = prevC && prevC.open ? candleReturnPct(prevC) : 0;
    const acceleration = ret5 - (c.length >= 10 && c[c.length - 10].open
        ? ((c[c.length - 5].close - c[c.length - 10].open) / c[c.length - 10].open) * 100 : 0);

    return {
        ret60,
        rangePct,
        rangePosition,
        distanceFromHighPct: close && high ? ((high - close) / close) * 100 : 0,
        distanceFromLowPct: close && low ? ((close - low) / close) * 100 : 0,
        ret5,
        ret15,
        bullish,
        bearish,
        neutral,
        maxBullStreak,
        maxBearStreak,
        avgBody,
        largestMovePct,
        volatility,
        acceleration,
        lastCandleReturnPct: candleReturnPct(lastC)
    };
}

function createHistoricalOutcome(context, outcome) {
    if (context.length !== CONTEXT_CANDLES || outcome.length !== OUTCOME_CANDLES) return null;

    const start = context[0].open;
    const finalClose = outcome[outcome.length - 1].close;
    const contextClose = context[context.length - 1].close;
    const maxHigh = Math.max(...outcome.map(c => c.high));
    const minLow = Math.min(...outcome.map(c => c.low));

    const outcomeReturnPct = start ? ((finalClose - contextClose) / contextClose) * 100 : 0;
    const mfeLong = contextClose ? ((maxHigh - contextClose) / contextClose) * 100 : 0;
    const maeLong = contextClose ? ((contextClose - minLow) / contextClose) * 100 : 0;

    return {
        outcomeReturnPct,
        maxHigh,
        minLow,
        mfeLong,
        maeLong,
        finalClose,
        firstMovePct: contextClose ? ((outcome[0].close - contextClose) / contextClose) * 100 : 0,
        contextStartTs: context[0].timestamp,
        contextEndTs: context[context.length - 1].timestamp,
        outcomeStartTs: outcome[0].timestamp,
        outcomeEndTs: outcome[outcome.length - 1].timestamp
    };
}

function classifyOutcome(outcome, direction) {
    const r = outcome.outcomeReturnPct;
    if (direction === 'LONG') {
        if (r >= OUTCOME_MOVE_THRESHOLD_PCT) return 'CONTINUATION';
        if (r <= -OUTCOME_MOVE_THRESHOLD_PCT) return 'REVERSAL';
    } else {
        if (r <= -OUTCOME_MOVE_THRESHOLD_PCT) return 'CONTINUATION';
        if (r >= OUTCOME_MOVE_THRESHOLD_PCT) return 'REVERSAL';
    }
    return 'SIDEWAYS';
}

function featureVector(f) {
    return [
        normalizeFeature(f.ret60, 1),
        normalizeFeature(f.rangePct, 1),
        f.rangePosition,
        normalizeFeature(f.distanceFromHighPct, 1),
        normalizeFeature(f.distanceFromLowPct, 1),
        normalizeFeature(f.ret5, 0.5),
        normalizeFeature(f.ret15, 1),
        normalizeFeature(f.bullish - f.bearish, 30),
        normalizeFeature(f.maxBullStreak - f.maxBearStreak, 10),
        normalizeFeature(f.avgBody, 0.1),
        normalizeFeature(f.largestMovePct, 0.5),
        normalizeFeature(f.volatility, 0.2),
        normalizeFeature(f.acceleration, 0.5),
        normalizeFeature(f.lastCandleReturnPct, 0.2)
    ];
}

function weightedDistance(a, b) {
    const weights = [1.5, 1.0, 1.25, 0.75, 0.75, 1.5, 1.25, 0.75, 0.75, 0.5, 0.5, 1.0, 1.0, 0.75];
    let sum = 0, weightSum = 0;
    for (let i = 0; i < a.length; i++) {
        const w = weights[i] || 1;
        sum += w * Math.pow(a[i] - b[i], 2);
        weightSum += w;
    }
    return Math.sqrt(sum / weightSum);
}

function similarityFromDistance(distance) {
    return 1 / (1 + distance);
}

function addHistoricalExampleIfReady() {
    if (completedCandles.length < CONTEXT_CANDLES + OUTCOME_CANDLES) return;

    const end = completedCandles.length;
    const context = completedCandles.slice(end - CONTEXT_CANDLES - OUTCOME_CANDLES, end - OUTCOME_CANDLES);
    const outcome = completedCandles.slice(end - OUTCOME_CANDLES);
    const features = calculateCandleFeatures(context);
    const outcomeData = createHistoricalOutcome(context, outcome);

    if (!features || !outcomeData) return;

    const key = `${outcomeData.contextStartTs}-${outcomeData.outcomeEndTs}`;
    if (historicalExamples.some(x => x.key === key)) return;

    historicalExamples.push({
        key,
        features,
        vector: featureVector(features),
        outcome: outcomeData
    });

    if (historicalExamples.length > 5000) historicalExamples.shift();

    console.log(`[HISTORY] Example #${historicalExamples.length} CREATED | ` +
        `Context: ${new Date(outcomeData.contextStartTs).toLocaleTimeString('en-GB')} → ${new Date(outcomeData.contextEndTs).toLocaleTimeString('en-GB')} | ` +
        `Outcome: ${new Date(outcomeData.outcomeStartTs).toLocaleTimeString('en-GB')} → ${new Date(outcomeData.outcomeEndTs).toLocaleTimeString('en-GB')} | ` +
        `Return: ${outcomeData.outcomeReturnPct.toFixed(3)}%`);

    logInfo(
        `[HISTORY] New Historical Example #${historicalExamples.length} | ` +
        `Context ${new Date(outcomeData.contextStartTs).toLocaleTimeString('en-GB')} → ` +
        `${new Date(outcomeData.contextEndTs).toLocaleTimeString('en-GB')} | ` +
        `Outcome ${new Date(outcomeData.outcomeStartTs).toLocaleTimeString('en-GB')} → ` +
        `${new Date(outcomeData.outcomeEndTs).toLocaleTimeString('en-GB')} | ` +
        `15M Return: ${outcomeData.outcomeReturnPct.toFixed(3)}%`
    );

    if (historicalExamples.length >= MIN_HISTORICAL_EXAMPLES && !historicalContextReady) {
        historicalContextReady = true;
        console.log(`[HISTORY] Historical Context Filter READY — ${historicalExamples.length} examples available`);
    }
}

function updateLiveOneMinuteCandle(ts, mid) {
    if (!Number.isFinite(mid) || mid <= 0) return;

    const bucket = minuteFloorMs(ts);

    if (!currentOneMinuteCandle) {
        currentOneMinuteCandle = {
            timestamp: bucket,
            open: mid,
            high: mid,
            low: mid,
            close: mid
        };
        return;
    }

    if (bucket === currentOneMinuteCandle.timestamp) {
        currentOneMinuteCandle.high = Math.max(currentOneMinuteCandle.high, mid);
        currentOneMinuteCandle.low = Math.min(currentOneMinuteCandle.low, mid);
        currentOneMinuteCandle.close = mid;
        return;
    }

    if (bucket > currentOneMinuteCandle.timestamp) {
        // Close previous completed candle.
        completedCandles.push({ ...currentOneMinuteCandle });

        if (completedCandles.length > 5000) completedCandles.shift();

        if (completedCandles.length >= CONTEXT_CANDLES && !candleEngineReady) {
            candleEngineReady = true;
            console.log(`[CONTEXT] Current 60M Context READY`);
        }

        addHistoricalExampleIfReady();

        const c = completedCandles[completedCandles.length - 1];
        logInfo(
            `[CANDLE] 1M CLOSED ${new Date(c.timestamp).toLocaleTimeString('en-GB')} | ` +
            `O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} | ` +
            `Return:${candleReturnPct(c).toFixed(3)}%`
        );

        if (completedCandles.length >= CONTEXT_CANDLES) {
            const context = completedCandles.slice(-CONTEXT_CANDLES);
            const f = calculateCandleFeatures(context);
            if (f) {
                logDebug(
                    `[CONTEXT] Rolling 60M | ` +
                    `Window ${new Date(context[0].timestamp).toLocaleTimeString('en-GB')} → ${new Date(context[59].timestamp).toLocaleTimeString('en-GB')} | ` +
                    `Ret60:${f.ret60.toFixed(3)}% Range:${f.rangePct.toFixed(3)}% Pos:${(f.rangePosition * 100).toFixed(1)}% ` +
                    `Ret5:${f.ret5.toFixed(3)}% Ret15:${f.ret15.toFixed(3)}% Vol:${f.volatility.toFixed(4)}%`
                );
            }
        }

        // If one or more minute buckets were skipped, start a new candle at the current bucket.
        currentOneMinuteCandle = {
            timestamp: bucket,
            open: mid,
            high: mid,
            low: mid,
            close: mid
        };
    }
}

function seedHistoricalExamplesFromStartupCandles(allCandles) {
    historicalExamples = [];

    // Build only examples whose entire outcome is BEFORE the live current 60M context.
    // This prevents look-ahead/leakage from startup history into the current context.
    const currentContextStartIndex = allCandles.length - CONTEXT_CANDLES;
    const maxExampleStart = currentContextStartIndex - CONTEXT_CANDLES - OUTCOME_CANDLES;

    for (let startIndex = 0; startIndex <= maxExampleStart; startIndex++) {
        const context = allCandles.slice(startIndex, startIndex + CONTEXT_CANDLES);
        const outcome = allCandles.slice(
            startIndex + CONTEXT_CANDLES,
            startIndex + CONTEXT_CANDLES + OUTCOME_CANDLES
        );

        if (context.length !== CONTEXT_CANDLES || outcome.length !== OUTCOME_CANDLES) continue;

        const features = calculateCandleFeatures(context);
        const outcomeData = createHistoricalOutcome(context, outcome);
        if (!features || !outcomeData) continue;

        const key = `${outcomeData.contextStartTs}-${outcomeData.outcomeEndTs}`;
        historicalExamples.push({
            key,
            features,
            vector: featureVector(features),
            outcome: outcomeData
        });
    }

    if (historicalExamples.length > 5000) {
        historicalExamples = historicalExamples.slice(-5000);
    }

    historicalContextReady = historicalExamples.length >= MIN_HISTORICAL_EXAMPLES;

    console.log(
        `[HISTORY] Startup historical examples seeded: ${historicalExamples.length}`
    );
    if (historicalExamples.length > 0) {
        const first = historicalExamples[0].outcome;
        const last = historicalExamples[historicalExamples.length - 1].outcome;
        console.log(
            `[HISTORY] Example range: ` +
            `${new Date(first.contextStartTs).toLocaleTimeString('en-GB')} → ` +
            `${new Date(last.outcomeEndTs).toLocaleTimeString('en-GB')}`
        );
    }
    console.log(
        `[HISTORY] Historical filter: ${historicalContextReady ? 'READY' : 'WARMING UP'} ` +
        `(${historicalExamples.length}/${MIN_HISTORICAL_EXAMPLES})`
    );
}

function fetchPreviousCompletedOneMinuteCandles() {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        const currentMinuteStart = minuteFloorMs(now);

        // Fetch enough completed candles to seed historical examples AND keep
        // the latest 60 candles as the live current context.
        const requiredCandles = STARTUP_HISTORY_CANDLES;
        const to = currentMinuteStart - 1;
        const from = currentMinuteStart - (requiredCandles * 60000);

        const url =
            `https://public.coindcx.com/market_data/candlesticks` +
            `?pair=B-ETH_USDT&from=${Math.floor(from / 1000)}&to=${Math.floor(to / 1000)}&resolution=1&pcode=f`;

        console.log(`[HISTORY] Loading ${requiredCandles} completed 1M candles from CoinDCX...`);
        console.log(`[HISTORY] ${CONTEXT_CANDLES}M live context + ${MIN_HISTORICAL_EXAMPLES} startup historical examples`);
        console.log(`[HISTORY] Requested window: ${new Date(from).toLocaleString('en-GB')} → ${new Date(to).toLocaleString('en-GB')}`);
        console.log(`[HISTORY] Waiting for CoinDCX candle response BEFORE starting WebSocket...`);
        console.log(`[HISTORY] WebSocket has NOT been started yet.`);

        let settled = false;
        const finishResolve = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(value);
        };
        const finishReject = (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(err);
        };

        const timeout = setTimeout(() => {
            finishReject(new Error('CoinDCX historical candle request timed out after 15000ms'));
        }, 15000);

        const req = https.get(url, res => {
            console.log(`[HISTORY] CoinDCX candle HTTP status: ${res.statusCode}`);

            let body = '';
            res.setEncoding('utf8');
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    console.log(`[HISTORY] CoinDCX candle response received (${body.length} bytes)`);

                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        throw new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`);
                    }

                    const raw = JSON.parse(body);
                    const rows = Array.isArray(raw)
                        ? raw
                        : (raw.data || raw.result || raw.candles || []);

                    console.log(`[HISTORY] Raw candle rows received: ${rows.length}`);

                    const candles = rows.map(x => {
                        const timestamp = Number(x.time ?? x.timestamp ?? x.t);
                        return {
                            timestamp: timestamp < 1e12 ? timestamp * 1000 : timestamp,
                            open: Number(x.open ?? x.o),
                            high: Number(x.high ?? x.h),
                            low: Number(x.low ?? x.l),
                            close: Number(x.close ?? x.c)
                        };
                    }).filter(x =>
                        Number.isFinite(x.timestamp) &&
                        Number.isFinite(x.open) &&
                        Number.isFinite(x.high) &&
                        Number.isFinite(x.low) &&
                        Number.isFinite(x.close) &&
                        x.open > 0 && x.high > 0 && x.low > 0 && x.close > 0 &&
                        x.timestamp < currentMinuteStart
                    ).sort((a, b) => a.timestamp - b.timestamp);

                    const unique = [];
                    const seen = new Set();
                    for (const c of candles) {
                        const key = minuteFloorMs(c.timestamp);
                        if (seen.has(key)) continue;
                        seen.add(key);
                        unique.push({ ...c, timestamp: key });
                    }

                    console.log(`[HISTORY] Valid unique completed candles: ${unique.length}`);

                    if (unique.length < requiredCandles) {
                        throw new Error(`Only ${unique.length} valid completed candles returned; need ${requiredCandles}`);
                    }

                    const startupCandles = unique.slice(-requiredCandles);

                    for (let i = 1; i < startupCandles.length; i++) {
                        if (startupCandles[i].timestamp - startupCandles[i - 1].timestamp !== 60000) {
                            throw new Error(
                                `Missing/irregular 1M candle between ` +
                                `${new Date(startupCandles[i - 1].timestamp).toISOString()} and ${new Date(startupCandles[i].timestamp).toISOString()}`
                            );
                        }
                    }

                    // Seed historical examples BEFORE reducing to the current context.
                    seedHistoricalExamplesFromStartupCandles(startupCandles);

                    completedCandles = startupCandles.slice(-CONTEXT_CANDLES);
                    candleEngineReady = true;

                    console.log(`[HISTORY] Received ${startupCandles.length}/${requiredCandles} completed 1M candles`);
                    console.log(
                        `[CONTEXT] Initial 60M live window: ` +
                        `${new Date(completedCandles[0].timestamp).toLocaleTimeString('en-GB')} → ` +
                        `${new Date(completedCandles[completedCandles.length - 1].timestamp).toLocaleTimeString('en-GB')}`
                    );
                    console.log(`[HISTORY] Startup 60M context: READY`);

                    finishResolve(completedCandles);
                } catch (e) {
                    finishReject(e);
                }
            });
        });

        req.on('error', finishReject);
        req.setTimeout(15000, () => {
            req.destroy(new Error('CoinDCX historical candle socket timeout after 15000ms'));
        });
    });
}

function evaluateHistoricalContext(direction) {
    if (!HISTORICAL_CONTEXT_ENABLED) {
        console.log(`[FILTER] Historical Context DISABLED — original confluence only`);
        return { pass: true, reason: 'DISABLED' };
    }

    if (!candleEngineReady || completedCandles.length < CONTEXT_CANDLES) {
        console.log(`[FILTER] BLOCK ${direction} — current 60M context NOT READY`);
        return { pass: false, reason: 'CURRENT_CONTEXT_NOT_READY' };
    }

    if (historicalExamples.length < MIN_HISTORICAL_EXAMPLES) {
        console.log(`[FILTER] BLOCK ${direction} — historical examples ${historicalExamples.length}/${MIN_HISTORICAL_EXAMPLES}`);
        return { pass: false, reason: 'HISTORICAL_CONTEXT_NOT_READY' };
    }

    const currentContext = completedCandles.slice(-CONTEXT_CANDLES);
    const currentFeatures = calculateCandleFeatures(currentContext);
    const currentVector = featureVector(currentFeatures);

    // Diagnostic visibility for the historical similarity gate.
    // This does NOT change the filtering logic or thresholds.
    const scoredExamples = historicalExamples
        .map(ex => {
            const distance = weightedDistance(currentVector, ex.vector);
            return { ...ex, distance, similarity: similarityFromDistance(distance) };
        })
        .sort((a, b) => b.similarity - a.similarity);

    const qualifiedExamples = scoredExamples.filter(x => x.similarity >= MIN_SIMILARITY);
    const neighbors = qualifiedExamples.slice(0, NEIGHBORS_TO_USE);

    if (neighbors.length < Math.min(5, NEIGHBORS_TO_USE)) {
        const similarities = scoredExamples.map(x => x.similarity);
        const maxSimilarity = similarities.length ? Math.max(...similarities) : 0;
        const avgSimilarity = similarities.length
            ? similarities.reduce((a, b) => a + b, 0) / similarities.length
            : 0;
        const minSimilarity = similarities.length ? Math.min(...similarities) : 0;

        console.log(`\n[CONTEXT DEBUG] ========================================`);
        console.log(`[CONTEXT DEBUG] Direction: ${direction}`);
        console.log(`[CONTEXT DEBUG] Current context: ${new Date(currentContext[0].timestamp).toLocaleTimeString('en-GB')} → ${new Date(currentContext[currentContext.length - 1].timestamp).toLocaleTimeString('en-GB')}`);
        console.log(`[CONTEXT DEBUG] Historical examples available: ${historicalExamples.length}`);
        console.log(`[CONTEXT DEBUG] Similarity threshold: ${MIN_SIMILARITY.toFixed(2)}`);
        console.log(`[CONTEXT DEBUG] Qualified examples: ${qualifiedExamples.length}/${historicalExamples.length}`);
        console.log(`[CONTEXT DEBUG] Similarity — Max: ${maxSimilarity.toFixed(3)} | Avg: ${avgSimilarity.toFixed(3)} | Min: ${minSimilarity.toFixed(3)}`);

        scoredExamples.slice(0, 5).forEach((ex, i) => {
            console.log(
                `[CONTEXT DEBUG] Top ${i + 1}: Similarity ${ex.similarity.toFixed(3)} | ` +
                `Distance ${ex.distance.toFixed(3)} | ` +
                `Context ${new Date(ex.outcome.contextStartTs).toLocaleTimeString('en-GB')}→${new Date(ex.outcome.contextEndTs).toLocaleTimeString('en-GB')} | ` +
                `Outcome ${new Date(ex.outcome.outcomeStartTs).toLocaleTimeString('en-GB')}→${new Date(ex.outcome.outcomeEndTs).toLocaleTimeString('en-GB')}`
            );
        });

        console.log(`[CONTEXT DEBUG] Current context end: ${new Date(currentContext[currentContext.length - 1].timestamp).toLocaleTimeString('en-GB')}`);
        if (scoredExamples.length) {
            const latestHistoricalEnd = Math.max(...scoredExamples.map(x => x.outcome.outcomeEndTs));
            console.log(`[CONTEXT DEBUG] Latest historical outcome end: ${new Date(latestHistoricalEnd).toLocaleTimeString('en-GB')}`);
            console.log(`[CONTEXT DEBUG] Temporal overlap check: ${latestHistoricalEnd < currentContext[0].timestamp ? 'PASS — historical data ends before current context' : 'CHECK — possible overlap'}`);
        }
        console.log(`[CONTEXT DEBUG] ========================================\n`);

        console.log(`[FILTER] BLOCK ${direction} — only ${neighbors.length} sufficiently similar examples`);
        return {
            pass: false,
            reason: 'INSUFFICIENT_SIMILAR_EXAMPLES',
            neighbors: neighbors.length,
            maxSimilarity,
            avgSimilarity,
            qualifiedExamples: qualifiedExamples.length
        };
    }

    let continuation = 0, reversal = 0, sideways = 0;
    let totalReturn = 0, totalMfe = 0, totalMae = 0;

    for (const n of neighbors) {
        const classification = classifyOutcome(n.outcome, direction);
        if (classification === 'CONTINUATION') continuation++;
        else if (classification === 'REVERSAL') reversal++;
        else sideways++;

        totalReturn += n.outcome.outcomeReturnPct;
        totalMfe += direction === 'LONG' ? n.outcome.mfeLong : n.outcome.maeLong;
        totalMae += direction === 'LONG' ? n.outcome.maeLong : n.outcome.mfeLong;
    }

    const count = neighbors.length;
    const continuationPct = continuation / count;
    const reversalPct = reversal / count;
    const sidewaysPct = sideways / count;
    const directionEdge = continuationPct - reversalPct;

    console.log(`\n[CONTEXT] ========================================`);
    console.log(`[CONTEXT] HISTORICAL ANALYSIS — ${direction}`);
    console.log(`[CONTEXT] Similar examples: ${count}`);
    console.log(`[CONTEXT] Continuation: ${(continuationPct * 100).toFixed(1)}%`);
    console.log(`[CONTEXT] Reversal: ${(reversalPct * 100).toFixed(1)}%`);
    console.log(`[CONTEXT] Sideways: ${(sidewaysPct * 100).toFixed(1)}%`);
    console.log(`[CONTEXT] Avg 15M return: ${(totalReturn / count).toFixed(3)}%`);
    console.log(`[CONTEXT] Avg directional MFE: ${(totalMfe / count).toFixed(3)}%`);
    console.log(`[CONTEXT] Avg directional MAE: ${(totalMae / count).toFixed(3)}%`);
    console.log(`[CONTEXT] Direction edge: ${(directionEdge * 100).toFixed(1)}%`);

    if (LOG_LEVEL === 'DEBUG') {
        neighbors.slice(0, 5).forEach((n, i) => {
            console.log(
                `[SIMILARITY] #${i + 1} Similarity:${n.similarity.toFixed(3)} ` +
                `OutcomeReturn:${n.outcome.outcomeReturnPct.toFixed(3)}% ` +
                `Context:${new Date(n.outcome.contextStartTs).toLocaleTimeString('en-GB')}→${new Date(n.outcome.contextEndTs).toLocaleTimeString('en-GB')}`
            );
        });
    }

    const pass =
        continuationPct >= MIN_CONTEXT_SUPPORT &&
        directionEdge >= MIN_DIRECTION_EDGE;

    console.log(`[FILTER] ${pass ? 'PASS' : 'BLOCK'} ${direction}`);
    console.log(`[FILTER] Reason: ${pass
        ? `Historical continuation support ${(continuationPct * 100).toFixed(1)}% >= ${(MIN_CONTEXT_SUPPORT * 100).toFixed(1)}%`
        : `Historical evidence insufficient: continuation ${(continuationPct * 100).toFixed(1)}%, reversal ${(reversalPct * 100).toFixed(1)}%`}`);
    console.log(`[CONTEXT] ========================================\n`);

    return {
        pass,
        reason: pass ? 'HISTORICAL_SUPPORT' : 'HISTORICAL_EVIDENCE_UNCLEAR',
        continuationPct,
        reversalPct,
        sidewaysPct,
        directionEdge,
        neighbors: count
    };
}

// ---------------------------------------------------------
// 1. INSTRUMENT & CAPITAL VALIDATION
// ---------------------------------------------------------
async function fetchInstrument() {
    return new Promise((resolve, reject) => {
        https.get('https://api.coindcx.com/exchange/v1/derivatives/futures/data/instrument?pair=B-ETH_USDT&margin_currency_short_name=USDT', (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    let json = JSON.parse(body);
                    resolve(json.instrument);
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function validateCapitalAndInstrument() {
    console.log(`[PREFLIGHT] Fetching B-ETH_USDT instrument...`);
    try {
        INSTRUMENT = await fetchInstrument();
        if (!INSTRUMENT) throw new Error("Instrument not found");

        let maxLev = INSTRUMENT.max_leverage_long;
        if (LEVERAGE > maxLev) {
            throw new Error(`Configured leverage ${LEVERAGE}x exceeds max permitted ${maxLev}x`);
        }

        // Fetch current price to calculate size
        let price = await new Promise((res, rej) => {
            https.get('https://api.coindcx.com/exchange/v1/derivatives/futures/data/trades?pair=B-ETH_USDT', (r) => {
                let b = '';
                r.on('data', d => b += d);
                r.on('end', () => res(parseFloat(JSON.parse(b)[0].price)));
            }).on('error', rej);
        });
        ETH_PRICE_AT_START = price;

        let maxNotionalUsdt = portfolio.balanceUsdt * LEVERAGE;
        let minNotional = INSTRUMENT.min_notional;
        let qtyStep = INSTRUMENT.quantity_increment;
        let minQty = INSTRUMENT.min_quantity;

        // Calculate quantity from per-trade margin allocation
        const perTradeMarginUsdt = PER_TRADE_MARGIN_INR / USDT_INR;
        const targetNotionalUsdt = perTradeMarginUsdt * LEVERAGE;

        let rawQty = targetNotionalUsdt / price;
        let qMulti = Math.round(rawQty / qtyStep);
        let calcQty = qMulti * qtyStep;
        if (calcQty * price < minNotional) calcQty += qtyStep; // exchange min-notional floor
        if (calcQty < minQty) calcQty = minQty;               // exchange min-qty floor

        SELECTED_QTY = parseFloat(calcQty.toFixed(5));
        let posNotional = SELECTED_QTY * price;
        REQUIRED_MARGIN = posNotional / LEVERAGE;

        console.log(`[PREFLIGHT] Position Sizing:`);
        console.log(`- Total Account: ₹${START_BALANCE_INR} ($${(START_BALANCE_INR / USDT_INR).toFixed(4)} USDT)`);
        console.log(`- Per-Trade Margin: ₹${PER_TRADE_MARGIN_INR} ($${perTradeMarginUsdt.toFixed(4)} USDT)`);
        console.log(`- Leverage: ${LEVERAGE}x`);
        console.log(`- USDT/INR: ${USDT_INR}`);
        console.log(`- Target Notional: $${targetNotionalUsdt.toFixed(2)} (₹${PER_TRADE_MARGIN_INR} × ${LEVERAGE}x)`);
        console.log(`- ETH Price: $${price.toFixed(2)}`);
        console.log(`- Min Notional (exchange floor): $${minNotional}`);
        console.log(`- Max Afford Notional (${LEVERAGE}x): $${maxNotionalUsdt.toFixed(2)}`);
        console.log(`- Calculated Qty: ${SELECTED_QTY} ETH`);
        console.log(`- Position Notional: $${posNotional.toFixed(2)}`);
        console.log(`- Required Margin: $${REQUIRED_MARGIN.toFixed(4)} USDT / ₹${(REQUIRED_MARGIN * USDT_INR).toFixed(2)}`);

        if (posNotional > maxNotionalUsdt) {
            throw new Error(`Calculated position notional $${posNotional.toFixed(2)} exceeds max affordable notional $${maxNotionalUsdt.toFixed(2)}`);
        }

        console.log(`[PREFLIGHT] Capital Validation PASS`);
        if (process.env.VALIDATE_ONLY) {
            console.log(`[PREFLIGHT] Automated validation completed successfully.`);
            process.exit(0);
        }
        startPreflight();
    } catch (err) {
        console.error(`[PREFLIGHT] FAIL: ${err.message}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------
// 2. SOCKET & FEED
// ---------------------------------------------------------
function connectWS() {
    if (finalized) return;
    try {
        ws = io('wss://stream.coindcx.com', {
            transports: ['websocket'],
            upgrade: false, reconnection: false, timeout: 10000
        });
    } catch (e) {
        feedStats.subErrors++;
        return;
    }

    ws.on('connect', () => {
        feedStats.reconnects++;
        ws.emit('join', { channelName: 'B-ETH_USDT@orderbook@50-futures' });
    });

    ws.on('disconnect', (reason) => {
        feedStats.disconnects++;
        if (marketState === 'PREFLIGHT') {
            console.log(`[PRECHECK] FAILED\n[PRECHECK] WebSocket closed (${reason})`);
            finalizeSession("PREFLIGHT_FAIL");
        } else if (!finalized) {
            updateMarketState('DISCONNECTED');
            setTimeout(connectWS, 1000);
        }
    });

    ws.io.on('error', (err) => {
        if (!finalized) updateMarketState('DISCONNECTED');
    });

    const processUpdate = (payload, isSnapshot) => {
        feedStats.totalMsg++;
        isSnapshot ? feedStats.snapshotMsg++ : feedStats.incrementalMsg++;
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

            let bidPrices = Object.keys(localBids).map(Number).sort((a, b) => b - a);
            let askPrices = Object.keys(localAsks).map(Number).sort((a, b) => a - b);

            let b = bidPrices.length > 0 ? bidPrices[0] : 0;
            let a = askPrices.length > 0 ? askPrices[0] : 0;
            let bq = b > 0 ? localBids[b] : 0;
            let aq = a > 0 ? localAsks[a] : 0;

            if (!b || !a || !bq || !aq || bq < 0 || aq < 0) { feedStats.invalid++; return; }
            if (b > a) { feedStats.crossed++; return; }

            feedStats.valid++;
            handleUpdate(b, a, bq, aq);
        } catch (e) { feedStats.parserErrors++; }
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
        if (validUpdatesCount >= 10) {
            console.log(`[PRECHECK] PASSED — live orderbook confirmed`);
            clearTimeout(preflightTimer);
            updateMarketState('FRESH');
            startSession(now);
        }
        return;
    }

    if (marketState === 'STALE' || marketState === 'DISCONNECTED') {
        console.log(`[FEED] RECOVERED`);
    }

    updateMarketState('FRESH');

    if (lastValidTs > 0) {
        const diff = now - lastValidTs;
        if (diff > feedStats.longestStale) feedStats.longestStale = diff;
    }

    lastValidTs = now;
    currentBid = bid; currentAsk = ask; currentBidQty = bidQty; currentAskQty = askQty;

    const mid = getMid(bid, ask);

    // Build/roll the live 1-minute candle stream.
    // Startup begins with the previous 60 completed CoinDCX candles.
    updateLiveOneMinuteCandle(now, mid);

    const spread = ask - bid;
    const spreadPct = spread / mid * 100;
    const micro = getMicroPrice(bid, ask, bidQty, askQty);
    const edgePct = getMicroEdgePct(micro, mid);
    const maxVol = Math.max(bidQty, askQty);
    const minVol = Math.min(bidQty, askQty);
    const imbRatio = minVol > 0 ? (maxVol / minVol) : maxVol;
    const lImb = bidQty > askQty ? imbRatio : 0;
    const sImb = askQty > bidQty ? imbRatio : 0;

    // Calculate Aggregate Depth within 10 bps (0.1%) of Mid
    const aggRange = mid * 0.001;
    let aggBidQty = 0;
    for (let p in localBids) {
        if (parseFloat(p) >= mid - aggRange) aggBidQty += localBids[p];
    }
    let aggAskQty = 0;
    for (let p in localAsks) {
        if (parseFloat(p) <= mid + aggRange) aggAskQty += localAsks[p];
    }

    const aggMaxVol = Math.max(aggBidQty, aggAskQty);
    const aggMinVol = Math.min(aggBidQty, aggAskQty);
    const aggImbRatio = aggMinVol > 0 ? (aggMaxVol / aggMinVol) : aggMaxVol;
    const lAggImb = aggBidQty > aggAskQty ? aggImbRatio : 0;
    const sAggImb = aggAskQty > aggBidQty ? aggImbRatio : 0;

    history.push({ localTs: now, bid, ask, mid, spread, edgePct, lAggImb, sAggImb, aggBidQty, aggAskQty });
    if (history.length > 5000) history.splice(0, 1000);
    if (startMid === null) startMid = mid;

    const mid1s = getHistMid(now, 1000);
    const ret1s = mid1s ? (mid - mid1s) / mid1s * 100 : 0;

    // ---------------------------------------------------------
    // 3. UNIFIED CONFLUENCE ENGINE EXECUTIONS
    // ---------------------------------------------------------
    let cand = candidates['CONFLUENCE'];
    let logic = candidatesLogic['CONFLUENCE'];

    // Evaluate full confluence requirements
    const longSetup =
        lAggImb >= logic.aggImbRatio &&     // Strong aggregate bid-side pressure
        edgePct >= logic.edgePctThreshold && // Positive microprice edge (meaningfully above mid)
        ret1s >= logic.momentumThreshold &&  // Positive short-term momentum
        spreadPct <= logic.maxSpreadPct;     // Acceptable execution spread

    const shortSetup =
        sAggImb >= logic.aggImbRatio &&       // Strong aggregate ask-side pressure
        edgePct <= -logic.edgePctThreshold && // Negative microprice edge (meaningfully below mid)
        ret1s <= -logic.momentumThreshold &&  // Negative short-term momentum
        spreadPct <= logic.maxSpreadPct;      // Acceptable execution spread

    // State Machine & Persistence
    let engineStatus = 'WAITING FOR SETUP';
    if (sessionExpired) {
        // Session over — drain open positions, block all new entries
        signalState = 'NEUTRAL';
        persistenceTicks = 0;
        priceFilter = null;
        engineStatus = `SESSION EXPIRED - WAITING FOR ${cand.positions.length} OPEN TRADES TO CLOSE`;
    } else if (signalState === 'PRICE_WAITING_LONG' || signalState === 'PRICE_WAITING_SHORT') {
        // ----------------------------------------------------------------
        // PRICE + TIMING FILTER — active wait state
        // ----------------------------------------------------------------
        const pf = priceFilter;
        const remainingMs = pf.expiryTs - now;
        const elapsedMs   = now - pf.t0;

        if (now >= pf.expiryTs) {
            // Window expired — cancel opportunity
            const elapsedSec = (elapsedMs / 1000).toFixed(1);
            console.log(`\n[PRICE-FILTER] ═══════════════════════════════════════`);
            console.log(`[PRICE-FILTER] ENTRY WINDOW EXPIRED`);
            console.log(`[PRICE-FILTER] Direction:     ${pf.direction}`);
            console.log(`[PRICE-FILTER] Signal Price:  $${pf.signalPrice.toFixed(2)}`);
            console.log(`[PRICE-FILTER] Final Price:   $${mid.toFixed(2)}`);
            console.log(`[PRICE-FILTER] Required Zone: $${pf.zoneLow.toFixed(2)} – $${pf.zoneHigh.toFixed(2)}`);
            console.log(`[PRICE-FILTER] Elapsed:       ${elapsedSec}s / ${ENTRY_WINDOW_MS / 1000}s`);
            console.log(`[PRICE-FILTER] RESULT: ENTRY CANCELLED`);
            console.log(`[PRICE-FILTER] ═══════════════════════════════════════\n`);
            // ENTRY-ANALYTICS: WINDOW EXPIRED
            console.log(`\n[ENTRY-ANALYTICS] =========================================`);
            console.log(`[ENTRY-ANALYTICS] ENTRY WINDOW EXPIRED`);
            console.log(`[ENTRY-ANALYTICS] Direction:     ${pf.direction}`);
            console.log(`[ENTRY-ANALYTICS] Signal Price:  $${pf.signalPrice.toFixed(2)}`);
            console.log(`[ENTRY-ANALYTICS] Reference High: $${(pf.direction === 'SHORT' ? pf.referencePrice : (getHistHigh(now, PRICE_FILTER_LOOKBACK_MS) || mid)).toFixed(2)}`);
            console.log(`[ENTRY-ANALYTICS] Reference Low:  $${(pf.direction === 'LONG'  ? pf.referencePrice : (getHistLow(now, PRICE_FILTER_LOOKBACK_MS)  || mid)).toFixed(2)}`);
            console.log(`[ENTRY-ANALYTICS] Required Zone: $${pf.zoneLow.toFixed(2)} – $${pf.zoneHigh.toFixed(2)}`);
            console.log(`[ENTRY-ANALYTICS] Last Price:    $${mid.toFixed(2)}`);
            console.log(`[ENTRY-ANALYTICS] Seconds Waited: ${elapsedSec}`);
            console.log(`[ENTRY-ANALYTICS] Zone Reached:  NO`);
            console.log(`[ENTRY-ANALYTICS] RESULT: ENTRY CANCELLED`);
            console.log(`[ENTRY-ANALYTICS] =========================================\n`);
            cand.expiredPriceWindows++;
            priceFilter = null;
            signalState = 'NEUTRAL';
            persistenceTicks = 0;
            engineStatus = 'PRICE WINDOW EXPIRED — WAITING FOR SETUP';
        } else {
            // Window still active — check if price has reached the entry zone
            const inZone = pf.direction === 'LONG'
                ? bid >= pf.zoneLow && ask <= pf.zoneHigh
                : ask <= pf.zoneHigh && bid >= pf.zoneLow;

            engineStatus = `${pf.direction} PRICE WAIT: $${mid.toFixed(2)} | ZONE $${pf.zoneLow.toFixed(2)}–$${pf.zoneHigh.toFixed(2)} | ${(remainingMs / 1000).toFixed(0)}s left`;

            // Throttled WAITING log every PRICE_FILTER_LOG_MS
            if (now - pf.lastLogTs >= PRICE_FILTER_LOG_MS) {
                pf.lastLogTs = now;
                const distancePct = pf.direction === 'SHORT'
                    ? ((mid - pf.zoneLow) / mid * 100)   // how far below reference zone
                    : ((pf.zoneHigh - mid) / mid * 100); // how far above reference zone
                console.log(`[PRICE-FILTER] WAITING | ${pf.direction} | Current: $${mid.toFixed(2)} | Zone: $${pf.zoneLow.toFixed(2)}–$${pf.zoneHigh.toFixed(2)} | Remaining: ${(remainingMs / 1000).toFixed(0)}s`);
                console.log(`[ENTRY-ANALYTICS] WAITING`);
                console.log(`[ENTRY-ANALYTICS] Direction:        ${pf.direction}`);
                console.log(`[ENTRY-ANALYTICS] Current Price:    $${mid.toFixed(2)}`);
                console.log(`[ENTRY-ANALYTICS] Zone:             $${pf.zoneLow.toFixed(2)} – $${pf.zoneHigh.toFixed(2)}`);
                console.log(`[ENTRY-ANALYTICS] Distance To Zone: ${distancePct.toFixed(4)}%`);
                console.log(`[ENTRY-ANALYTICS] Seconds Elapsed:  ${(elapsedMs / 1000).toFixed(1)}`);
                console.log(`[ENTRY-ANALYTICS] Seconds Remaining:${(remainingMs / 1000).toFixed(1)}`);
            }

            if (inZone) {
                // Price reached the zone — re-check ALL conditions at this tick
                const reImb   = pf.direction === 'LONG' ? lAggImb >= logic.aggImbRatio   : sAggImb >= logic.aggImbRatio;
                const reEdge  = pf.direction === 'LONG' ? edgePct >= logic.edgePctThreshold : edgePct <= -logic.edgePctThreshold;
                const reMom   = pf.direction === 'LONG' ? ret1s >= logic.momentumThreshold  : ret1s <= -logic.momentumThreshold;
                const reSpread= spreadPct <= logic.maxSpreadPct;

                // Re-evaluate historical context with current candle state
                const reHistorical = evaluateHistoricalContext(pf.direction);
                const secondsWaited = (elapsedMs / 1000);

                // ENTRY-ANALYTICS: ZONE REACHED header
                console.log(`\n[ENTRY-ANALYTICS] =========================================`);
                console.log(`[ENTRY-ANALYTICS] PRICE CONDITION REACHED`);
                console.log(`[ENTRY-ANALYTICS] Direction:        ${pf.direction}`);
                console.log(`[ENTRY-ANALYTICS] Signal Price:     $${pf.signalPrice.toFixed(2)}`);
                console.log(`[ENTRY-ANALYTICS] Zone:             $${pf.zoneLow.toFixed(2)} – $${pf.zoneHigh.toFixed(2)}`);
                console.log(`[ENTRY-ANALYTICS] Zone-Hit Price:   $${mid.toFixed(2)}`);
                console.log(`[ENTRY-ANALYTICS] Seconds Waited:   ${secondsWaited.toFixed(1)}`);
                console.log(`[ENTRY-ANALYTICS] Window Remaining: ${(remainingMs / 1000).toFixed(1)} seconds`);
                console.log(`[ENTRY-ANALYTICS] =========================================`);

                console.log(`\n[PRICE-FILTER] ═══════════════════════════════════════`);
                console.log(`[PRICE-FILTER] PRICE CONDITION REACHED`);
                console.log(`[PRICE-FILTER] Direction: ${pf.direction} | Current: $${mid.toFixed(2)} | Zone: $${pf.zoneLow.toFixed(2)}–$${pf.zoneHigh.toFixed(2)}`);
                console.log(`[PRICE-FILTER] RECHECKING STRATEGY BEFORE ENTRY:`);
                console.log(`[PRICE-FILTER]   IMBALANCE:  ${reImb    ? 'PASS' : 'FAIL'} (${pf.direction === 'LONG' ? lAggImb.toFixed(2) : sAggImb.toFixed(2)}x, req >=${logic.aggImbRatio})`);
                console.log(`[PRICE-FILTER]   EDGE:       ${reEdge   ? 'PASS' : 'FAIL'} (${edgePct.toFixed(5)}%, req ${pf.direction === 'LONG' ? '>=' : '<='} ${logic.edgePctThreshold})`);
                console.log(`[PRICE-FILTER]   MOMENTUM:   ${reMom    ? 'PASS' : 'FAIL'} (${ret1s.toFixed(3)}%, req ${pf.direction === 'LONG' ? '>=' : '<='} ${logic.momentumThreshold})`);
                console.log(`[PRICE-FILTER]   SPREAD:     ${reSpread ? 'PASS' : 'FAIL'} (${spreadPct.toFixed(4)}%, req <=${logic.maxSpreadPct})`);
                console.log(`[PRICE-FILTER]   HISTORICAL: ${reHistorical.pass ? 'PASS' : 'FAIL'} (${reHistorical.reason})`);
                console.log(`[PRICE-FILTER]   PRICE ZONE: PASS`);
                console.log(`[PRICE-FILTER]   TIMING:     PASS (${(remainingMs / 1000).toFixed(0)}s remaining)`);

                // ENTRY-ANALYTICS: FINAL RECHECK detail
                const blockReason = !reImb ? 'IMBALANCE_FAIL'
                    : !reEdge  ? 'EDGE_FAIL'
                    : !reMom   ? 'MOMENTUM_FAIL'
                    : !reSpread? 'SPREAD_FAIL'
                    : !reHistorical.pass ? `HISTORICAL_${reHistorical.reason}`
                    : null;
                console.log(`\n[ENTRY-ANALYTICS] FINAL RECHECK`);
                console.log(`[ENTRY-ANALYTICS] Imbalance:  ${pf.direction === 'LONG' ? lAggImb.toFixed(4) : sAggImb.toFixed(4)} | Required: ${logic.aggImbRatio} | ${reImb ? 'PASS' : 'FAIL'}`);
                console.log(`[ENTRY-ANALYTICS] Edge:       ${edgePct.toFixed(6)}% | Required: ${pf.direction === 'LONG' ? '>=' : '<=-'}${logic.edgePctThreshold}% | ${reEdge ? 'PASS' : 'FAIL'}`);
                console.log(`[ENTRY-ANALYTICS] Momentum:   ${ret1s.toFixed(5)}% | Required: ${pf.direction === 'LONG' ? '>=' : '<=-'}${logic.momentumThreshold}% | ${reMom ? 'PASS' : 'FAIL'}`);
                console.log(`[ENTRY-ANALYTICS] Spread:     ${spreadPct.toFixed(5)}% | Required: <=${logic.maxSpreadPct}% | ${reSpread ? 'PASS' : 'FAIL'}`);
                console.log(`[ENTRY-ANALYTICS] Confirmation: 3/3 | Required: 3/3 | PASS`);
                console.log(`[ENTRY-ANALYTICS] Historical Filter: ${reHistorical.pass ? 'PASS' : 'FAIL'} (${reHistorical.reason})`);
                console.log(`[ENTRY-ANALYTICS] Price Zone: PASS`);
                console.log(`[ENTRY-ANALYTICS] Timing Window: PASS (${(remainingMs / 1000).toFixed(1)}s remaining)`);

                const allPass = reImb && reEdge && reMom && reSpread && reHistorical.pass;
                console.log(`[ENTRY-ANALYTICS] FINAL DECISION: ${allPass ? 'ENTRY' : 'BLOCKED'}`);
                if (!allPass) console.log(`[ENTRY-ANALYTICS] Block Reason: ${blockReason}`);

                if (allPass) {
                    // Full confirmation — execute
                    const entryPrice = pf.direction === 'LONG' ? ask : bid;
                    const notional   = entryPrice * SELECTED_QTY;
                    const marginReq  = notional / LEVERAGE;
                    const availMargin = portfolio.balanceUsdt - portfolio.usedMarginUsdt;

                    console.log(`[PRICE-FILTER] ALL CHECKS PASS`);
                    console.log(`[PRICE-FILTER] ═══════════════════════════════════════\n`);

                    if (marginReq > availMargin) {
                        console.log(`⚠️ SKIPPED ${pf.direction}: Insufficient Margin (Req: $${marginReq.toFixed(2)}, Avail: $${availMargin.toFixed(2)})`);
                        cand.ignoredSignalsMargin++;
                    } else {
                        cand.executed++;
                        portfolio.usedMarginUsdt += marginReq;
                        const label = pf.direction === 'LONG' ? 'ASK' : 'BID';
                        console.log(`[ENTRY] PRICE + STRATEGY + TIMING CONFIRMED`);
                        console.log(`[ENTRY] EXECUTING ${pf.direction} at ${label} $${entryPrice.toFixed(2)}`);
                        const priceDiffPct = ((entryPrice - pf.signalPrice) / pf.signalPrice * 100);
                        const priceFilterContext = {
                            signalPrice:   pf.signalPrice,
                            referenceHigh: pf.direction === 'SHORT' ? pf.referencePrice : null,
                            referenceLow:  pf.direction === 'LONG'  ? pf.referencePrice : null,
                            zoneLow:       pf.zoneLow,
                            zoneHigh:      pf.zoneHigh,
                            windowMs:      ENTRY_WINDOW_MS,
                            zoneReached:   true,
                            zoneHitTime:   now,
                            zoneHitPrice:  mid,
                            secondsWaited: secondsWaited,
                            decision:      'ENTRY',
                            blockReason:   null
                        };
                        const entrySnapshot = buildEntrySnapshot({
                            direction: pf.direction, ts: now, entryPrice,
                            bid, ask, bidQty, askQty, mid, spreadPct, edgePct, ret1s,
                            lAggImb, sAggImb, persistenceTicks: 0,
                            historicalDecision: reHistorical,
                            priceFilterContext
                        });
                        // ── TRADE-AUDIT: PRE-ENTRY POSITION CHECK (before openPosition mutates state) ──
                        const _tauOpenCount = cand.positions.length; // count BEFORE this new one
                        const _tauBalBeforeEntry = portfolio.balanceUsdt;
                        const _tauUsedBeforeEntry = portfolio.usedMarginUsdt;
                        const _tauAvailBeforeEntry = _tauBalBeforeEntry - _tauUsedBeforeEntry;
                        const _tauMarginInr = marginReq * USDT_INR;
                        const _tauBalInr    = _tauBalBeforeEntry * USDT_INR;
                        const _tauAvailInr  = _tauAvailBeforeEntry * USDT_INR;
                        const _tauTradeId   = ++tradeAuditCounter;
                        const _tauTradeLabel = `T${String(_tauTradeId).padStart(3, '0')}`;
                        console.log(`\n[TRADE-AUDIT] PRE-ENTRY POSITION CHECK`);
                        console.log(`[TRADE-AUDIT] Existing Open Positions: ${_tauOpenCount}`);
                        console.log(`[TRADE-AUDIT] New Position Requested:  ${pf.direction}`);
                        console.log(`[TRADE-AUDIT] Position Mode:           ${_tauOpenCount === 0 ? 'SINGLE' : 'MULTIPLE'}`);
                        console.log(`[TRADE-AUDIT] Available Margin:        ₹${_tauAvailInr.toFixed(2)} ($${_tauAvailBeforeEntry.toFixed(4)} USDT)`);
                        openPosition('CONFLUENCE', pf.direction, now, entryPrice,
                            `${pf.direction}-PRICE-FILTER Imb:${(pf.direction === 'LONG' ? lAggImb : sAggImb).toFixed(1)}x Zone:$${pf.zoneLow.toFixed(2)}-$${pf.zoneHigh.toFixed(2)}`,
                            entrySnapshot);
                        // Tag the position with the audit trade ID (openPosition already pushed it)
                        const _tauPos = cand.positions[cand.positions.length - 1];
                        _tauPos._auditTradeId   = _tauTradeLabel;
                        _tauPos._auditBalBefore  = _tauBalBeforeEntry;
                        // TRADE-AUDIT: ENTRY ACCOUNTING SNAPSHOT
                        const _tauBalAfterEntry = portfolio.balanceUsdt;
                        const _tauUsedAfterEntry = portfolio.usedMarginUsdt;
                        const _tauNotional = entryPrice * SELECTED_QTY;
                        console.log(`\n[TRADE-AUDIT] ==============================`);
                        console.log(`[TRADE-AUDIT] Trade ID:         ${_tauTradeLabel}`);
                        console.log(`[TRADE-AUDIT] Direction:        ${pf.direction}`);
                        console.log(`[TRADE-AUDIT] Entry Price:      $${entryPrice.toFixed(2)}`);
                        console.log(`[TRADE-AUDIT] Quantity:         ${SELECTED_QTY} ETH`);
                        console.log(`[TRADE-AUDIT] Notional:         $${_tauNotional.toFixed(2)} (₹${(_tauNotional * USDT_INR).toFixed(2)})`);
                        console.log(`[TRADE-AUDIT] Leverage:         ${LEVERAGE}x`);
                        console.log(`[TRADE-AUDIT] Open Positions:   ${cand.positions.length}`);
                        console.log(`[TRADE-AUDIT] Position Mode:    ${cand.positions.length === 1 ? 'SINGLE' : 'MULTIPLE'}`);
                        console.log(`[TRADE-AUDIT] ENTRY ACCOUNTING`);
                        console.log(`[TRADE-AUDIT] Margin Before:    ₹${_tauBalInr.toFixed(2)} ($${_tauBalBeforeEntry.toFixed(4)} USDT)`);
                        console.log(`[TRADE-AUDIT] Allocated Margin: ₹${_tauMarginInr.toFixed(2)} ($${marginReq.toFixed(4)} USDT)`);
                        console.log(`[TRADE-AUDIT] Margin After Entry: ₹${(_tauAvailBeforeEntry - marginReq) * USDT_INR < 0 ? '0.00' : ((_tauAvailBeforeEntry - marginReq) * USDT_INR).toFixed(2)} ($${Math.max(0, _tauAvailBeforeEntry - marginReq).toFixed(4)} USDT avail)`);
                        console.log(`[TRADE-AUDIT] Margin Accounting Mode: RESERVED (margin deducted from available, balance unchanged until P&L)`);
                        console.log(`[TRADE-AUDIT] ==============================\n`);
                        // ENTRY-ANALYTICS: ENTRY EXECUTED
                        console.log(`\n[ENTRY-ANALYTICS] =========================================`);
                        console.log(`[ENTRY-ANALYTICS] ENTRY EXECUTED`);
                        console.log(`[ENTRY-ANALYTICS] Direction:        ${pf.direction}`);
                        console.log(`[ENTRY-ANALYTICS] Signal Price:     $${pf.signalPrice.toFixed(2)}`);
                        console.log(`[ENTRY-ANALYTICS] Entry Price:      $${entryPrice.toFixed(2)}`);
                        console.log(`[ENTRY-ANALYTICS] Price Difference: ${priceDiffPct >= 0 ? '+' : ''}${priceDiffPct.toFixed(4)}%`);
                        console.log(`[ENTRY-ANALYTICS] Reference High:   $${(pf.direction === 'SHORT' ? pf.referencePrice : (getHistHigh(now, PRICE_FILTER_LOOKBACK_MS) || mid)).toFixed(2)}`);
                        console.log(`[ENTRY-ANALYTICS] Reference Low:    $${(pf.direction === 'LONG'  ? pf.referencePrice : (getHistLow(now, PRICE_FILTER_LOOKBACK_MS)  || mid)).toFixed(2)}`);
                        console.log(`[ENTRY-ANALYTICS] Zone Low:         $${pf.zoneLow.toFixed(2)}`);
                        console.log(`[ENTRY-ANALYTICS] Zone High:        $${pf.zoneHigh.toFixed(2)}`);
                        console.log(`[ENTRY-ANALYTICS] Seconds Waited:   ${secondsWaited.toFixed(1)}`);
                        console.log(`[ENTRY-ANALYTICS] Zone Reached:     YES`);
                        console.log(`[ENTRY-ANALYTICS] Historical Filter: PASS`);
                        console.log(`[ENTRY-ANALYTICS] =========================================\n`);
                    }
                    priceFilter = null;
                    signalState = 'NEUTRAL';
                    persistenceTicks = 0;
                } else {
                    // In zone but not all conditions pass — keep waiting
                    console.log(`[PRICE-FILTER] IN ZONE but conditions not met — continuing to wait`);
                    console.log(`[PRICE-FILTER] ═══════════════════════════════════════\n`);
                    // ENTRY-ANALYTICS: ZONE REACHED but blocked
                    console.log(`\n[ENTRY-ANALYTICS] =========================================`);
                    console.log(`[ENTRY-ANALYTICS] ZONE REACHED — ENTRY BLOCKED`);
                    console.log(`[ENTRY-ANALYTICS] Direction:          ${pf.direction}`);
                    console.log(`[ENTRY-ANALYTICS] Zone-Hit Price:     $${mid.toFixed(2)}`);
                    console.log(`[ENTRY-ANALYTICS] Seconds Waited:     ${secondsWaited.toFixed(1)}`);
                    console.log(`[ENTRY-ANALYTICS] Final Imbalance:    ${pf.direction === 'LONG' ? lAggImb.toFixed(4) : sAggImb.toFixed(4)} — ${reImb ? 'PASS' : 'FAIL'}`);
                    console.log(`[ENTRY-ANALYTICS] Final Edge:         ${edgePct.toFixed(6)}% — ${reEdge ? 'PASS' : 'FAIL'}`);
                    console.log(`[ENTRY-ANALYTICS] Final Momentum:     ${ret1s.toFixed(5)}% — ${reMom ? 'PASS' : 'FAIL'}`);
                    console.log(`[ENTRY-ANALYTICS] Final Spread:       ${spreadPct.toFixed(5)}% — ${reSpread ? 'PASS' : 'FAIL'}`);
                    console.log(`[ENTRY-ANALYTICS] Final Historical:   ${reHistorical.pass ? 'PASS' : 'FAIL'}`);
                    console.log(`[ENTRY-ANALYTICS] Final Decision:     BLOCKED`);
                    console.log(`[ENTRY-ANALYTICS] Block Reason:       ${blockReason}`);
                    console.log(`[ENTRY-ANALYTICS] =========================================\n`);
                    cand.blockedByPriceZone++;
                    engineStatus = `${pf.direction} IN ZONE — CONDITIONS NOT MET — ${(remainingMs / 1000).toFixed(0)}s left`;
                }
            }
        }
    } else if (longSetup && signalState !== 'PRICE_WAITING_LONG') {
        // Guard: do not restart BUILDING if a price filter is active for LONG
        if (signalState === 'BUILDING_LONG' || signalState === 'QUALIFIED_LONG') {
            persistenceTicks++;
        } else {
            signalState = 'BUILDING_LONG';
            persistenceTicks = 1;
        }
        engineStatus = `BUILDING LONG CONFIRMATION (${persistenceTicks}/${logic.requiredTicks})`;
    } else if (shortSetup && signalState !== 'PRICE_WAITING_SHORT') {
        // Guard: do not restart BUILDING if a price filter is active for SHORT
        if (signalState === 'BUILDING_SHORT' || signalState === 'QUALIFIED_SHORT') {
            persistenceTicks++;
        } else {
            signalState = 'BUILDING_SHORT';
            persistenceTicks = 1;
        }
        engineStatus = `BUILDING SHORT CONFIRMATION (${persistenceTicks}/${logic.requiredTicks})`;
    } else if (signalState !== 'PRICE_WAITING_LONG' && signalState !== 'PRICE_WAITING_SHORT') {
        signalState = 'NEUTRAL';
        persistenceTicks = 0;
        // Determine why it's not setting up
        if (lAggImb < logic.aggImbRatio && sAggImb < logic.aggImbRatio) {
            engineStatus = `WAITING FOR ${logic.aggImbRatio}x IMBALANCE`;
        } else if (Math.abs(edgePct) < logic.edgePctThreshold) {
            engineStatus = `WAITING FOR MICRO EDGE (${logic.edgePctThreshold}%)`;
        } else {
            engineStatus = `WAITING FOR MOMENTUM ALIGNMENT`;
        }
    }
    latestEngineStatus = engineStatus;

    // Execution Trigger — confluence threshold reached
    // Instead of entering immediately, activate the PRICE + TIMING FILTER.
    if (signalState === 'BUILDING_LONG' && persistenceTicks >= logic.requiredTicks) {
        signalState = 'QUALIFIED_LONG';

        console.log(`\n===========================================`);
        console.log(`🚀 UNIFIED LONG CONFLUENCE ACHIEVED`);
        console.log(`L-IMB: ${lAggImb.toFixed(2)}x (Req: >=${logic.aggImbRatio})`);
        console.log(`EDGE: ${edgePct.toFixed(5)}% (Req: >=${logic.edgePctThreshold})`);
        console.log(`MOMENTUM: ${ret1s.toFixed(3)}% (Req: >=${logic.momentumThreshold})`);
        console.log(`SPREAD: ${spreadPct.toFixed(4)}% (Req: <=${logic.maxSpreadPct})`);
        console.log(`===========================================\n`);

        cand.signals++;
        cand.newSignals++;

        const historicalDecision = evaluateHistoricalContext('LONG');
        console.log(`[DECISION] LONG | Confluence: PASS | 3/3: PASS | Historical Filter: ${historicalDecision.pass ? 'PASS' : 'BLOCK'}`);

        if (!historicalDecision.pass) {
            console.log(`[ENTRY] BLOCKED LONG — ${historicalDecision.reason}`);
            persistenceTicks = 0;
            signalState = 'NEUTRAL';
        } else {
            // Historical PASS — activate price + timing filter
            const refLow  = getHistLow(now, PRICE_FILTER_LOOKBACK_MS) || mid;
            const zoneLow = refLow;
            const zoneHigh= refLow * (1 + PRICE_ZONE_OFFSET_PCT);
            priceFilter = {
                direction: 'LONG',
                t0: now,
                expiryTs: now + ENTRY_WINDOW_MS,
                signalPrice: mid,
                referencePrice: refLow,
                zoneLow,
                zoneHigh,
                historicalDecision,
                lastLogTs: 0
            };
            signalState = 'PRICE_WAITING_LONG';
            persistenceTicks = 0;
            console.log(`\n[PRICE-FILTER] ═══════════════════════════════════════`);
            console.log(`[PRICE-FILTER] SIGNAL DETECTED`);
            console.log(`[PRICE-FILTER] Direction:      LONG`);
            console.log(`[PRICE-FILTER] Signal Price:   $${mid.toFixed(2)}`);
            console.log(`[PRICE-FILTER] Reference Low:  $${refLow.toFixed(2)}`);
            console.log(`[PRICE-FILTER] Required Zone:  $${zoneLow.toFixed(2)} – $${zoneHigh.toFixed(2)}`);
            console.log(`[PRICE-FILTER] Entry Window:   ${ENTRY_WINDOW_MS / 1000}s`);
            console.log(`[PRICE-FILTER] Timer Started`);
            console.log(`[PRICE-FILTER] ═══════════════════════════════════════\n`);
        }
    } else if (signalState === 'BUILDING_SHORT' && persistenceTicks >= logic.requiredTicks) {
        signalState = 'QUALIFIED_SHORT';

        console.log(`\n===========================================`);
        console.log(`🚀 UNIFIED SHORT CONFLUENCE ACHIEVED`);
        console.log(`S-IMB: ${sAggImb.toFixed(2)}x (Req: >=${logic.aggImbRatio})`);
        console.log(`EDGE: ${edgePct.toFixed(5)}% (Req: <=-${logic.edgePctThreshold})`);
        console.log(`MOMENTUM: ${ret1s.toFixed(3)}% (Req: <=-${logic.momentumThreshold})`);
        console.log(`SPREAD: ${spreadPct.toFixed(4)}% (Req: <=${logic.maxSpreadPct})`);
        console.log(`===========================================\n`);

        cand.signals++;
        cand.newSignals++;

        const historicalDecision = evaluateHistoricalContext('SHORT');
        console.log(`[DECISION] SHORT | Confluence: PASS | 3/3: PASS | Historical Filter: ${historicalDecision.pass ? 'PASS' : 'BLOCK'}`);

        if (!historicalDecision.pass) {
            console.log(`[ENTRY] BLOCKED SHORT — ${historicalDecision.reason}`);
            persistenceTicks = 0;
            signalState = 'NEUTRAL';
        } else {
            // Historical PASS — activate price + timing filter
            const refHigh  = getHistHigh(now, PRICE_FILTER_LOOKBACK_MS) || mid;
            const zoneHigh = refHigh;
            const zoneLow  = refHigh * (1 - PRICE_ZONE_OFFSET_PCT);
            priceFilter = {
                direction: 'SHORT',
                t0: now,
                expiryTs: now + ENTRY_WINDOW_MS,
                signalPrice: mid,
                referencePrice: refHigh,
                zoneLow,
                zoneHigh,
                historicalDecision,
                lastLogTs: 0
            };
            signalState = 'PRICE_WAITING_SHORT';
            persistenceTicks = 0;
            // ENTRY-ANALYTICS: SIGNAL CREATED (SHORT)
            console.log(`\n[ENTRY-ANALYTICS] =========================================`);
            console.log(`[ENTRY-ANALYTICS] SIGNAL CREATED`);
            console.log(`[ENTRY-ANALYTICS] Direction:               SHORT`);
            console.log(`[ENTRY-ANALYTICS] Signal Time:             ${new Date(now).toISOString()}`);
            console.log(`[ENTRY-ANALYTICS] Signal Price:            $${mid.toFixed(2)}`);
            console.log(`[ENTRY-ANALYTICS] Historical Filter:       PASS`);
            console.log(`[ENTRY-ANALYTICS] Similar Examples:        ${historicalDecision.neighbors ?? 'N/A'}`);
            console.log(`[ENTRY-ANALYTICS] Historical Continuation: ${historicalDecision.continuationPct != null ? (historicalDecision.continuationPct * 100).toFixed(1) + '%' : 'N/A'}`);
            console.log(`[ENTRY-ANALYTICS] Historical Reversal:     ${historicalDecision.reversalPct    != null ? (historicalDecision.reversalPct    * 100).toFixed(1) + '%' : 'N/A'}`);
            console.log(`[ENTRY-ANALYTICS] Historical Sideways:     ${historicalDecision.sidewaysPct    != null ? (historicalDecision.sidewaysPct    * 100).toFixed(1) + '%' : 'N/A'}`);
            console.log(`[ENTRY-ANALYTICS] Imbalance:               ${sAggImb.toFixed(4)}x`);
            console.log(`[ENTRY-ANALYTICS] Edge:                    ${edgePct.toFixed(6)}%`);
            console.log(`[ENTRY-ANALYTICS] Momentum:                ${ret1s.toFixed(5)}%`);
            console.log(`[ENTRY-ANALYTICS] Spread:                  ${spreadPct.toFixed(5)}%`);
            console.log(`[ENTRY-ANALYTICS] Confirmation:            3/3`);
            console.log(`[ENTRY-ANALYTICS] =========================================`);
            console.log(`[ENTRY-ANALYTICS] PRICE FILTER`);
            console.log(`[ENTRY-ANALYTICS] Reference High:          $${refHigh.toFixed(2)}`);
            console.log(`[ENTRY-ANALYTICS] Reference Low:           N/A (SHORT uses high reference)`);
            console.log(`[ENTRY-ANALYTICS] Required Zone Low:       $${zoneLow.toFixed(2)}`);
            console.log(`[ENTRY-ANALYTICS] Required Zone High:      $${zoneHigh.toFixed(2)}`);
            console.log(`[ENTRY-ANALYTICS] Entry Window:            ${ENTRY_WINDOW_MS / 1000} seconds`);
            console.log(`[ENTRY-ANALYTICS] Current Price:           $${mid.toFixed(2)}`);
            console.log(`[ENTRY-ANALYTICS] =========================================\n`);
            console.log(`\n[PRICE-FILTER] ═══════════════════════════════════════`);
            console.log(`[PRICE-FILTER] SIGNAL DETECTED`);
            console.log(`[PRICE-FILTER] Direction:      SHORT`);
            console.log(`[PRICE-FILTER] Signal Price:   $${mid.toFixed(2)}`);
            console.log(`[PRICE-FILTER] Reference High: $${refHigh.toFixed(2)}`);
            console.log(`[PRICE-FILTER] Required Zone:  $${zoneLow.toFixed(2)} – $${zoneHigh.toFixed(2)}`);
            console.log(`[PRICE-FILTER] Entry Window:   ${ENTRY_WINDOW_MS / 1000}s`);
            console.log(`[PRICE-FILTER] Timer Started`);
            console.log(`[PRICE-FILTER] ═══════════════════════════════════════\n`);
        }
    }

    // Console Logging for user visibility (Exact 1-second interval)
    if (now - lastLogTs >= 1000) {
        lastLogTs = now;
        const timeStr = new Date(now).toLocaleTimeString('en-GB', { hour12: false, fractionalSecondDigits: 3 });
        const maxImb = Math.max(lAggImb, sAggImb);
        const imbSide = lAggImb > sAggImb ? 'LONG ' : 'SHORT';
        const filterTag = priceFilter
            ? ` | FILTER: ${priceFilter.direction} ZONE $${priceFilter.zoneLow.toFixed(2)}-$${priceFilter.zoneHigh.toFixed(2)} ${(Math.max(0, priceFilter.expiryTs - now) / 1000).toFixed(0)}s`
            : '';
        console.log(`[${timeStr}] REQ: IMB>${logic.aggImbRatio} EDGE>${logic.edgePctThreshold} MOM>${logic.momentumThreshold} | BRAIN: ${engineStatus.padEnd(35)} | IMB: ${maxImb.toFixed(2)}x ${imbSide} | EDGE: ${edgePct.toFixed(5)}% | MOM: ${ret1s.toFixed(3)}% | SPR: ${spreadPct.toFixed(3)}%${filterTag}`);
    }

    // Exits
    for (let c in candidates) {
        let cand = candidates[c];
        for (let i = cand.positions.length - 1; i >= 0; i--) {
            let p = cand.positions[i];
            const holdTime = now - p.entryTs;
            const execPrice = p.dir === 'LONG' ? bid : ask;
            const favorable = p.dir === 'LONG' ? execPrice - p.entryPrice : p.entryPrice - execPrice;
            const adverse = p.dir === 'LONG' ? p.entryPrice - execPrice : execPrice - p.entryPrice;

            updateEntryAnalytics(p, execPrice, now, currentBid, currentAsk, getMid(currentBid, currentAsk), currentBidQty, currentAskQty, (currentAsk - currentBid) / getMid(currentBid, currentAsk) * 100, getMicroEdgePct(getMicroPrice(currentBid, currentAsk, currentBidQty, currentAskQty), getMid(currentBid, currentAsk)), getHistMid(now, 1000) ? (getMid(currentBid, currentAsk) - getHistMid(now, 1000)) / getHistMid(now, 1000) * 100 : 0, p.dir === 'LONG' ? Math.max(currentBidQty, currentAskQty) / Math.min(currentBidQty, currentAskQty) : 0, p.dir === 'SHORT' ? Math.max(currentBidQty, currentAskQty) / Math.min(currentBidQty, currentAskQty) : 0);

            if (favorable > p.mfeMove) p.mfeMove = favorable;
            if (adverse > p.maeMove) p.maeMove = adverse;

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
                closePosition(c, i, execPrice, exitReason, now);
            }
        }
        
        // If session expired and all trades closed, finalize gracefully
        if (sessionExpired && cand.positions.length === 0) {
            finalizeSession("SESSION_END");
        }
    }

    // Check for manual close signals from UI
    checkCloseSignals();

    // Dump live state on every tick to update UI
    if (validUpdatesCount % 10 === 0) dumpLiveState();
}

function closePosition(candName, posIndex, execPrice, reason, now) {
    let cand = candidates[candName];
    let p = cand.positions[posIndex];

    const grossPnl = p.dir === 'LONG' ? (execPrice - p.entryPrice) * p.qty : (p.entryPrice - execPrice) * p.qty;
    const notional = p.entryPrice * p.qty;
    const exitFee = (execPrice * p.qty * TAKER_FEE);
    const totalFees = p.entryFee + exitFee;
    const netPnl = grossPnl - totalFees;

    let balBefore = portfolio.balanceUsdt;
    portfolio.balanceUsdt += netPnl;
    portfolio.grossPnlUsdt += grossPnl;
    portfolio.feesUsdt += totalFees;
    portfolio.usedMarginUsdt -= p.marginReq;

    if (portfolio.balanceUsdt > portfolio.peakEqUsdt) portfolio.peakEqUsdt = portfolio.balanceUsdt;
    let dd = portfolio.peakEqUsdt - portfolio.balanceUsdt;
    if (dd > portfolio.maxDrawdownUsdt) portfolio.maxDrawdownUsdt = dd;

    const analyticsResult = finalizeEntryAnalytics(p, execPrice, now, reason);

    // ── TRADE-AUDIT: EXIT + P&L + ACCOUNT RECONCILIATION ──
    const _tauId        = p._auditTradeId  || `T???`;
    const _tauBalPre    = p._auditBalBefore != null ? p._auditBalBefore : balBefore;
    const _tauGrossInr  = grossPnl  * USDT_INR;
    const _tauFeesInr   = totalFees * USDT_INR;
    const _tauNetInr    = netPnl    * USDT_INR;
    const _tauBalAfter  = portfolio.balanceUsdt;
    const _tauExpected  = _tauBalPre + netPnl;          // expected = balance-at-entry + netPnl
    const _tauDiff      = _tauBalAfter - _tauExpected;  // should be ~0
    const _tauAcctOk    = Math.abs(_tauDiff) < 0.00001; // float tolerance
    const _tauBalPreInr = _tauBalPre   * USDT_INR;
    const _tauBalAftInr = _tauBalAfter * USDT_INR;
    const _tauExpInr    = _tauExpected * USDT_INR;
    const _tauDiffInr   = _tauDiff     * USDT_INR;
    const _tauAvailAfter = (portfolio.balanceUsdt - portfolio.usedMarginUsdt) * USDT_INR;
    const _tauTotalTrades = cand.trades.length + 1; // +1 because push happens below
    const _tauOpenAfter   = cand.positions.length - 1; // -1 because splice happens below
    const _tauClosedAfter = _tauTotalTrades;
    const _tauCumPnlInr  = portfolio.grossPnlUsdt * USDT_INR;

    console.log(`\n[TRADE-AUDIT] ==============================`);
    console.log(`[TRADE-AUDIT] CLOSED TRADE SUMMARY`);
    console.log(`[TRADE-AUDIT] Trade ID:            ${_tauId}`);
    console.log(`[TRADE-AUDIT] Direction:           ${p.dir}`);
    console.log(`[TRADE-AUDIT] Entry:               $${p.entryPrice.toFixed(2)}`);
    console.log(`[TRADE-AUDIT] Exit:                $${execPrice.toFixed(2)}`);
    console.log(`[TRADE-AUDIT] Exit Reason:         ${reason}`);
    console.log(`[TRADE-AUDIT] Quantity:            ${p.qty} ETH`);
    console.log(`[TRADE-AUDIT] Notional:            $${notional.toFixed(2)}`);
    console.log(`[TRADE-AUDIT] Leverage:            ${LEVERAGE}x`);
    console.log(`[TRADE-AUDIT] Margin Used:         $${p.marginReq.toFixed(4)} USDT / ₹${(p.marginReq * USDT_INR).toFixed(2)}`);
    console.log(`[TRADE-AUDIT] Gross P&L:           $${grossPnl.toFixed(6)} / ₹${_tauGrossInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Fees:                $${totalFees.toFixed(6)} / ₹${_tauFeesInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Net P&L:             $${netPnl.toFixed(6)} / ₹${_tauNetInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Account Before:      ₹${_tauBalPreInr.toFixed(4)} ($${_tauBalPre.toFixed(6)} USDT)`);
    console.log(`[TRADE-AUDIT] Account After:       ₹${_tauBalAftInr.toFixed(4)} ($${_tauBalAfter.toFixed(6)} USDT)`);
    console.log(`[TRADE-AUDIT] Expected After:      ₹${_tauExpInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Accounting Diff:     ₹${_tauDiffInr.toFixed(6)}`);
    console.log(`[TRADE-AUDIT] ACCOUNTING CHECK:    ${_tauAcctOk ? 'PASS' : 'FAIL ⚠️'}`);
    console.log(`[TRADE-AUDIT] ==============================`);
    console.log(`[TRADE-AUDIT] EXIT`);
    console.log(`[TRADE-AUDIT] Trade ID:            ${_tauId}`);
    console.log(`[TRADE-AUDIT] Exit Reason:         ${reason}`);
    console.log(`[TRADE-AUDIT] Entry Price:         $${p.entryPrice.toFixed(2)}`);
    console.log(`[TRADE-AUDIT] Exit Price:          $${execPrice.toFixed(2)}`);
    console.log(`[TRADE-AUDIT] Direction:           ${p.dir}`);
    console.log(`[TRADE-AUDIT] P&L`);
    console.log(`[TRADE-AUDIT] Gross P&L:           ₹${_tauGrossInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Fees:                ₹${_tauFeesInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Net P&L:             ₹${_tauNetInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] ACCOUNT AFTER EXIT`);
    console.log(`[TRADE-AUDIT] Trade ID:            ${_tauId}`);
    console.log(`[TRADE-AUDIT] Balance Before Trade: ₹${_tauBalPreInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Margin Allocated:    ₹${(p.marginReq * USDT_INR).toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Realized P&L:        ₹${_tauNetInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Expected Balance:    ₹${_tauExpInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Actual Balance:      ₹${_tauBalAftInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Difference:          ₹${_tauDiffInr.toFixed(6)}`);
    console.log(`[TRADE-AUDIT] ACCOUNTING CHECK:    ${_tauAcctOk ? 'PASS ✅' : 'FAIL ⚠️'}`);
    console.log(`[TRADE-AUDIT] SESSION STATE`);
    console.log(`[TRADE-AUDIT] Total Trades Executed: ${_tauTotalTrades}`);
    console.log(`[TRADE-AUDIT] Open Positions:        ${_tauOpenAfter}`);
    console.log(`[TRADE-AUDIT] Closed Positions:      ${_tauClosedAfter}`);
    console.log(`[TRADE-AUDIT] Cumulative Gross P&L:  ₹${_tauCumPnlInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Current Avail Margin:  ₹${_tauAvailAfter.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] Current Account Bal:   ₹${_tauBalAftInr.toFixed(4)}`);
    console.log(`[TRADE-AUDIT] ==============================\n`);

    cand.trades.push({
        tradeId: cand.trades.length + 1,
        candidate: candName, direction: p.dir,
        entryTime: p.entryTs, entryPrice: p.entryPrice,
        exitTime: now, exitPrice: execPrice,
        quantity: p.qty, notional, usedMargin: p.marginReq,
        holdDurationMs: now - p.entryTs, exitReason: reason,
        grossPnlUsdt: grossPnl, entryFeeUsdt: p.entryFee, exitFeeUsdt: exitFee,
        feesUsdt: totalFees, netPnlUsdt: netPnl,
        entryReason: p.reason,
        MFE: p.mfeMove, MAE: p.maeMove,
        entryAnalytics: analyticsResult,
        balanceBefore: balBefore, balanceAfter: portfolio.balanceUsdt,
        status: reason === 'OPEN_AT_SESSION_END' ? 'OPEN_AT_SESSION_END' : 'COMPLETED_TRADE'
    });
    cand.positions.splice(posIndex, 1);
    dumpLiveState();
}

// ---------------------------------------------------------
// 4. POSITION MANAGEMENT
// ---------------------------------------------------------
function openPosition(c, dir, ts, entryPrice, reason = '', entrySnapshot = null) {
    const cand = candidates[c];
    const qty = SELECTED_QTY;
    const notional = entryPrice * qty;
    const marginReq = notional / LEVERAGE;
    const entryFee = notional * TAKER_FEE;

    const tpPrice = dir === 'LONG' ? entryPrice * (1 + TP_PCT) : entryPrice * (1 - TP_PCT);
    const slPrice = dir === 'LONG' ? entryPrice * (1 - SL_PCT) : entryPrice * (1 + SL_PCT);
    const bailoutPrice = dir === 'LONG' ? entryPrice * (1 - BAILOUT_PCT) : entryPrice * (1 + BAILOUT_PCT);

    cand.positions.push({
        dir, entryTs: ts, entryPrice, qty,
        tpPrice, slPrice, bailoutPrice,
        marginReq, entryFee,
        mfeMove: 0, maeMove: 0, reason,
        analytics: entrySnapshot ? {
            ...entrySnapshot,
            lastSampleTs: 0,
            samples: [],
            checkpoints: {},
            timeToMFE: null,
            timeToMAE: null,
            maxFavorablePrice: entryPrice,
            maxAdversePrice: entryPrice
        } : null
    });

    if (entrySnapshot) logEntryAnalyticsOpen(cand.positions[cand.positions.length - 1], entrySnapshot);
}

// ---------------------------------------------------------
// 5. TIMERS & SNAPSHOTS
// ---------------------------------------------------------
function checkWatchdog() {
    if (finalized || marketState === 'PREFLIGHT') return;
    const now = Date.now();
    const diff = now - lastValidTs;
    if (diff > STALE_MS && marketState === 'FRESH') {
        updateMarketState('STALE');
        if (ws) ws.disconnect();
    }
    if (diff > HARD_ABORT_MS) {
        finalizeSession("ABORTED_FEED_UNAVAILABLE");
    }
}

function startSession(now) {
    console.log(`[SESSION] Starting ${DURATION_MS / 60000}-minute Phase 51 ETH paper test`);
    console.log(`[HISTORY] Startup 60M context: ${candleEngineReady ? 'READY' : 'NOT READY'}`);
    console.log(`[HISTORY] Historical examples: ${historicalExamples.length}/${MIN_HISTORICAL_EXAMPLES}`);
    console.log(`[HISTORY] Historical filter: ${HISTORICAL_CONTEXT_ENABLED ? (historicalContextReady ? 'READY' : 'WARMING UP') : 'DISABLED'}`);
    START_TIME = now;
    END_TIME = START_TIME + DURATION_MS;

    sessionTimer = setTimeout(() => {
        console.log(`[SESSION] 15-minute timer expired. Waiting for open positions to close...`);
        sessionExpired = true;
    }, DURATION_MS);
    snapshotTimer = setInterval(doSnapshot, 30000);
    price3sTimer = setInterval(() => {
        if (!finalized && marketState === 'FRESH' && currentBid && currentAsk) {
            pricesEvery3s.push({
                time: new Date().toLocaleTimeString('en-GB'),
                bid: currentBid, ask: currentAsk, mid: getMid(currentBid, currentAsk)
            });
        }
    }, 3000);
    watchdogTimer = setInterval(checkWatchdog, 1000);
}

function doSnapshot() {
    if (finalized || marketState === 'PREFLIGHT') return;
    const now = Date.now();
    const getRet = (ms) => {
        let oldMid = getHistMid(now, ms);
        return oldMid && startMid ? (getMid(currentBid, currentAsk) - oldMid) / oldMid * 100 : 0;
    };

    let mid = currentBid && currentAsk ? getMid(currentBid, currentAsk) : null;
    let micro = currentBid ? getMicroPrice(currentBid, currentAsk, currentBidQty, currentAskQty) : null;
    let edgePct = micro ? getMicroEdgePct(micro, mid) : null;
    let spread = currentBid ? currentAsk - currentBid : null;
    let spreadPct = mid ? spread / mid * 100 : null;
    let maxV = Math.max(currentBidQty, currentAskQty);
    let minV = Math.min(currentBidQty, currentAskQty);
    let imb = minV > 0 ? (maxV / minV) : maxV;

    let urGross = 0;
    for (let c in candidates) {
        for (let p of candidates[c].positions) {
            let cx = p.dir === 'LONG' ? currentBid : currentAsk;
            urGross += p.dir === 'LONG' ? (cx - p.entryPrice) * p.qty : (p.entryPrice - cx) * p.qty;
        }
    }

    let row = {
        timestamp: new Date(now).toISOString(),
        bestBid: currentBid, bestAsk: currentAsk, mid: mid,
        bidQty: currentBidQty, askQty: currentAskQty,
        spreadPercent: spreadPct, imbalance: imb, microPrice: micro, microEdgePercent: edgePct,
        oneSecondReturn: getRet(1000), twoSecondReturn: getRet(2000), threeSecondReturn: getRet(3000),
        thirtySecondReturn: getRet(30000), oneMinuteReturn: getRet(60000),
        threeMinuteReturn: getRet(180000), fiveMinuteReturn: getRet(300000),
        priceChangeFromStart: mid && startMid ? (mid - startMid) / startMid * 100 : 0,
        candidateACondition: '', candidateBCondition: '', candidateCCondition: '', candidateDCondition: '',
        signalCandidate: '', signalDirection: '', signal: '',
        positionState: '', entryPrice: '', quantity: SELECTED_QTY,
        usedMargin: portfolio.usedMarginUsdt, availableMargin: portfolio.balanceUsdt - portfolio.usedMarginUsdt,
        unrealizedGrossPnl: urGross, unrealizedNetPnl: 0,
        feedStatus: marketState, staleStatus: marketState === 'STALE',
        disconnectCount: feedStats.disconnects, reconnectCount: feedStats.reconnects
    };
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
    const now = Date.now();

    if (sessionTimer) clearTimeout(sessionTimer);
    if (preflightTimer) clearTimeout(preflightTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (snapshotTimer) clearInterval(snapshotTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    if (price3sTimer) clearInterval(price3sTimer);

    if (ws) { ws.removeAllListeners(); ws.disconnect(); }

    if (reason === "PREFLIGHT_FAIL") {
        console.log("[PRECHECK] FAILED\n[PRECHECK] No valid orderbook data received\n[SESSION] NOT STARTED");
        process.exit(1);
    }

    let allTrades = [];
    let totExec = 0, totLong = 0, totShort = 0, totTp = 0, totSl = 0, totBail = 0;
    let totHold = 0;
    let totComp = 0;
    let openAtEndCount = 0;

    for (let c in candidates) {
        openAtEndCount += candidates[c].positions.length;
        let trades = candidates[c].trades;
        allTrades.push(...trades);
        for (let t of trades) {
            totExec++;
            if (t.direction === 'LONG') totLong++;
            if (t.direction === 'SHORT') totShort++;
            if (t.status === 'COMPLETED_TRADE') {
                totComp++;
                totHold += t.holdDurationMs;
                if (t.exitReason === 'TP') totTp++;
                if (t.exitReason === 'SL') totSl++;
                if (t.exitReason === 'BAILOUT') totBail++;
            }
        }
    }

    writeCsv(CSV_30S, snapshots);
    writeCsv(CSV_TRADES, allTrades.length > 0 ? allTrades : [{ note: "NO_TRADES" }]);

    const analyticsSummary = {
        analyticsVersion: '1.0',
        sessionId: SESSION_ID,
        generatedAt: new Date(now).toISOString(),
        totalEntries: entryAnalyticsCompleted.length,
        completedAnalytics: entryAnalyticsCompleted
    };
    const ENTRY_ANALYTICS_JSON = path.join(REPORTS_DIR, `phase51-15m-eth-${SESSION_ID}-entry-analytics.json`);
    fs.writeFileSync(ENTRY_ANALYTICS_JSON, JSON.stringify(analyticsSummary, null, 2));

    let reportJson = {
        SESSION: { sessionId: SESSION_ID, startTime: START_TIME, endTime: now, durationMs: now - START_TIME },
        ACCOUNT: { startingBalanceInr: START_BALANCE_INR, startingBalanceUsdt: START_BALANCE_INR / USDT_INR, leverage: LEVERAGE, usdInrRate: USDT_INR },
        INSTRUMENT: {
            symbol: 'B-ETH_USDT', ethPriceAtStart: ETH_PRICE_AT_START, quantity: SELECTED_QTY,
            quantityStep: INSTRUMENT.quantity_increment, minimumQuantity: INSTRUMENT.min_quantity,
            minimumNotional: INSTRUMENT.min_notional, actualPositionNotional: SELECTED_QTY * ETH_PRICE_AT_START,
            requiredMargin: REQUIRED_MARGIN, availableMargin: START_BALANCE_INR / USDT_INR,
            maximumPermittedLeverage: INSTRUMENT.max_leverage_long
        },
        FEED: {
            totalMessages: feedStats.totalMsg, validMessages: feedStats.valid, invalidMessages: feedStats.invalid,
            snapshotMessages: feedStats.snapshotMsg, incrementalMessages: feedStats.incrementalMsg,
            crossedBooks: feedStats.crossed, disconnects: feedStats.disconnects, reconnects: feedStats.reconnects,
            parserErrors: feedStats.parserErrors, subscriptionErrors: feedStats.subErrors,
            maxStaleMs: feedStats.longestStale, averageUpdateIntervalMs: feedStats.valid > 0 ? (now - START_TIME) / feedStats.valid : 0
        },
        STRATEGY: {
            confluenceSignals: candidates['CONFLUENCE'].signals,
            totalSignals: candidates['CONFLUENCE'].signals,
            historicalContextEnabled: HISTORICAL_CONTEXT_ENABLED,
            historicalExamplesCreated: historicalExamples.length,
            historicalFilterReady: historicalContextReady
        },
        TRADING: {
            totalTrades: totExec,
            totalTakeProfit: totTp,
            totalStopLoss: totSl,
            totalBailout: totBail,
            totalWins: allTrades.filter(t => t.netPnlUsdt > 0).length,
            totalLosses: allTrades.filter(t => t.netPnlUsdt < 0).length,
            ignoredInsufficientMargin: Object.values(candidates).reduce((a, b) => a + b.ignoredSignalsMargin, 0),
            completedTrades: totComp,
            openAtSessionEnd: openAtEndCount,
            longEntries: totLong, shortEntries: totShort,
            tpHits: totTp, slHits: totSl, bailoutHits: totBail, maxConcurrentPositions: 'UNLIMITED'
        },
        PnL: {
            grossPnlUsdt: portfolio.grossPnlUsdt, feesUsdt: portfolio.feesUsdt, netPnlUsdt: portfolio.balanceUsdt - (START_BALANCE_INR / USDT_INR), maxDrawdownUsdt: portfolio.maxDrawdownUsdt
        },
        PERFORMANCE: {
            averageHoldMs: totComp > 0 ? totHold / totComp : 0, tradesPerHour: totComp / (15 / 60)
        }
    };
    fs.writeFileSync(JSON_REP, JSON.stringify(reportJson, null, 2));

    let tradeRows = allTrades.map((t, idx) => {
        let entT = new Date(t.entryTime).toLocaleTimeString('en-GB');
        let exT = t.exitTime ? new Date(t.exitTime).toLocaleTimeString('en-GB') : 'N/A';
        let holdStr = t.exitTime ? ((t.exitTime - t.entryTime) / 1000).toFixed(1) + 's' : 'N/A';
        let pBail = t.direction === 'LONG' ? (t.entryPrice * (1 - BAILOUT_PCT)).toFixed(2) : (t.entryPrice * (1 + BAILOUT_PCT)).toFixed(2);

        return `| ${idx + 1} | ${t.direction} | $${t.entryPrice.toFixed(2)} | ${entT} | $${(t.entryPrice * (1 + (t.direction === 'LONG' ? TP_PCT : -TP_PCT))).toFixed(2)} | $${(t.entryPrice * (1 - (t.direction === 'LONG' ? SL_PCT : -SL_PCT))).toFixed(2)} | $${pBail} | $${t.exitPrice ? t.exitPrice.toFixed(2) : 'N/A'} | ${exT} | ${holdStr} | ${t.exitReason} | $${t.grossPnlUsdt.toFixed(4)} | $${t.feesUsdt.toFixed(4)} | $${t.netPnlUsdt.toFixed(4)} |`;
    }).join('\\n');

    let priceRows = pricesEvery3s.map(p => {
        return `| ${p.time} | $${p.bid.toFixed(2)} | $${p.ask.toFixed(2)} | $${p.mid.toFixed(4)} |`;
    }).join('\\n');

    let txt = `==================================================
PHASE 51 — ETH LIVE PAPER TRADING + ROLLING 60M/15M CONTEXT (${DURATION_MS / 60000} MIN)
==================================================
Market: B-ETH_USDT
Starting Balance: ₹${START_BALANCE_INR}
Leverage: ${LEVERAGE}×
Duration: ${DURATION_MS / 60000} minutes

TABLE OF ALL TRADES:
| Trade # | LONG/SHORT | Entry Price | Entry Time | TP Price | SL Price | Bailout Threshold | Exit Price | Exit Time | Hold Duration | Exit Reason | Gross P&L | Trading Cost | Net P&L |
|---------|------------|-------------|------------|----------|----------|-------------------|------------|-----------|---------------|-------------|-----------|--------------|---------|
${tradeRows.length > 0 ? tradeRows : `| No trades generated during this ${DURATION_MS / 60000}-minute window. |`}

TABLE OF PRICE EVERY 3 SECONDS:
| Time | Best Bid | Best Ask | Mid Price |
|------|----------|----------|-----------|
${priceRows}

==================================================
SUMMARY
==================================================
Total trades: ${totComp + openAtEndCount}
LONG trades: ${totLong}
SHORT trades: ${totShort}

TP count: ${totTp}
SL count: ${totSl}
Early bailout count: ${totBail}

Historical context enabled: ${HISTORICAL_CONTEXT_ENABLED}
Historical examples created: ${historicalExamples.length}
Historical filter ready: ${historicalContextReady}
Current 60M context ready: ${candleEngineReady}
`;
    fs.writeFileSync(TXT_REP, txt);
    console.log(txt);

    try {
        const pidFile = path.join(REPORTS_DIR, 'bot.pid');
        if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch (e) { }

    process.exit(0);
}

async function startPreflight() {
    console.log("[PRECHECK] Preparing B-ETH_USDT live paper test...");

    if (HISTORICAL_CONTEXT_ENABLED) {
        try {
            await fetchPreviousCompletedOneMinuteCandles();

            if (completedCandles.length < CONTEXT_CANDLES) {
                throw new Error(
                    `Historical startup context incomplete: ${completedCandles.length}/${CONTEXT_CANDLES} candles`
                );
            }

            console.log(
                `[HISTORY] Startup 60M context READY — ${completedCandles.length} completed 1M candles loaded`
            );
            console.log(
                `[HISTORY] Historical examples currently available: ${historicalExamples.length}`
            );
        } catch (err) {
            console.error(`[HISTORY] STARTUP FAILED — ${err.message}`);
            console.error(
                "[HISTORY] Bot will NOT start live trading without the required 60 completed 1M candles."
            );
            finalizeSession("HISTORICAL_PREFLIGHT_FAIL");
            return;
        }
    }

    console.log("[PRECHECK] Connecting to CoinDCX B-ETH_USDT...");
    connectWS();

    preflightTimer = setTimeout(
        () => finalizeSession("PREFLIGHT_FAIL"),
        60000
    );
}

// Boot sequence
validateCapitalAndInstrument();

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const REPORTS_DIR = path.join(__dirname, '../reports');

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const OBS_FILE = path.join(DATA_DIR, 'phase50-15m-live-observations.json');

const CSV_EXIT = path.join(REPORTS_DIR, 'phase50A-exit-matrix-fixed.csv');
const CSV_REPLAY = path.join(REPORTS_DIR, 'phase50A-trade-replay-fixed.csv');
const JSON_REP = path.join(REPORTS_DIR, 'phase50A-analysis-fixed.json');
const TXT_REP = path.join(REPORTS_DIR, 'phase50A-final-report-fixed.txt');

// Constants
const QTY = 0.14;
const LEVERAGE = 5;
const START_BALANCE_INR = 300;
const USDT_INR = 86;
const TAKER_FEE = 0.001;

function runForensicFixed() {
    console.log("Loading observations...");
    if (!fs.existsSync(OBS_FILE)) {
        console.error("Missing obs file");
        process.exit(1);
    }
    const obs = JSON.parse(fs.readFileSync(OBS_FILE, 'utf8'));

    const logicMap = {
        'A': { imb: 2.0, edge: 0.002, useDir: false },
        'B': { imb: 3.0, edge: 0.003, useDir: false },
        'C': { imb: 2.0, edge: 0.002, useDir: true },
        'D': { imb: 3.0, edge: 0.003, useDir: true }
    };

    let state = {
        A: { prevEdgePct: 0, lastSigTs: 0 },
        B: { prevEdgePct: 0, lastSigTs: 0 },
        C: { prevEdgePct: 0, lastSigTs: 0 },
        D: { prevEdgePct: 0, lastSigTs: 0 }
    };

    let signals = [];
    const getMid1s = (ts) => {
        for (let i = obs.length - 1; i >= 0; i--) {
            if (ts - obs[i].ts >= 1000) return obs[i].mid;
        }
        return null;
    };

    for (let i = 0; i < obs.length; i++) {
        let o = obs[i];
        let lImb = o.edgePct > 0 ? o.imbRatio : 0;
        let sImb = o.edgePct < 0 ? o.imbRatio : 0;
        let mid1s = getMid1s(o.ts);
        let ret1s = mid1s ? (o.mid - mid1s) / mid1s * 100 : 0;

        for (let c in logicMap) {
            let L = logicMap[c];
            let st = state[c];
            let lCond = lImb >= L.imb && o.edgePct >= L.edge && (!L.useDir || ret1s >= 0) && o.spread <= 0.02;
            let sCond = sImb >= L.imb && o.edgePct <= -L.edge && (!L.useDir || ret1s <= 0) && o.spread <= 0.02;

            if (lCond && st.prevEdgePct < L.edge) {
                signals.push({ id: signals.length, candidate: c, dir: 'LONG', ts: o.ts, entry: o.ask, obsIdx: i });
            }
            if (sCond && st.prevEdgePct > -L.edge) {
                signals.push({ id: signals.length, candidate: c, dir: 'SHORT', ts: o.ts, entry: o.bid, obsIdx: i });
            }
            st.prevEdgePct = o.edgePct;
        }
    }

    console.log(`Candidate A signals: ${signals.filter(s => s.candidate === 'A').length}`);
    console.log(`Candidate B signals: ${signals.filter(s => s.candidate === 'B').length}`);
    console.log(`Candidate C signals: ${signals.filter(s => s.candidate === 'C').length}`);
    console.log(`Candidate D signals: ${signals.filter(s => s.candidate === 'D').length}`);
    console.log(`Total signals: ${signals.length}`);

    // Precompute full timeline per signal so we don't truncate at 5 minutes
    signals.forEach(s => {
        s.ticks = [];
        for (let j = s.obsIdx; j < obs.length; j++) {
            let o = obs[j];
            let exitPrice = s.dir === 'LONG' ? o.bid : o.ask;
            let fav = s.dir === 'LONG' ? exitPrice - s.entry : s.entry - exitPrice;
            let adv = s.dir === 'LONG' ? s.entry - exitPrice : exitPrice - s.entry;
            let fPct = fav / s.entry * 100;
            let aPct = adv / s.entry * 100;
            s.ticks.push({ ts: o.ts, price: exitPrice, fav: fPct, adv: aPct });
        }
    });

    const TP_VALS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 0.75, 1.0, 1.5];
    const SL_VALS = [0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.5, 0.75, 1.0, 1.5];
    
    // Quick validation of ONE configuration
    console.log("\n--- VALIDATION: Candidate B, TP=0.20%, SL=0.20% ---");
    let testSigs = signals.filter(s => s.candidate === 'B');
    for (let i = 0; i < Math.min(5, testSigs.length); i++) {
        let s = testSigs[i];
        let reason = 'OPEN_AT_SESSION_END';
        let exitTs = null, exitPrice = null, favAtExit = 0, advAtExit = 0;
        
        for (let tk of s.ticks) {
            if (tk.fav >= 0.20) {
                reason = 'TP'; exitTs = tk.ts; exitPrice = tk.price; favAtExit = tk.fav; advAtExit = tk.adv; break;
            }
            if (tk.adv >= 0.20) {
                reason = 'SL'; exitTs = tk.ts; exitPrice = tk.price; favAtExit = tk.fav; advAtExit = tk.adv; break;
            }
        }
        
        if (reason === 'OPEN_AT_SESSION_END') {
            let lastTk = s.ticks[s.ticks.length - 1];
            exitTs = lastTk.ts; exitPrice = lastTk.price; favAtExit = lastTk.fav; advAtExit = lastTk.adv;
        }

        let holdTime = exitTs - s.ts;
        let gross = s.dir === 'LONG' ? (exitPrice - s.entry) * QTY : (s.entry - exitPrice) * QTY;
        let notional = s.entry * QTY;
        let fees = notional * TAKER_FEE + (exitPrice * QTY * TAKER_FEE);
        let net = gross - fees;
        
        console.log(`SigTS: ${s.ts} | Dir: ${s.dir} | Entry: ${s.entry} | ExitTS: ${exitTs} | ExitPrice: ${exitPrice} | Reason: ${reason} | Hold: ${holdTime}ms | Gross: $${gross.toFixed(4)} | Fees: $${fees.toFixed(4)} | Net: $${net.toFixed(4)}`);
    }

    console.log("\nGenerating Matrix...");
    let exitMatrix = [];
    let replayRows = ["candidate,TP,SL,signal_ts,direction,entry,exit_ts,exit_price,reason,hold_ms,gross_pnl,fees,net_pnl"];

    for (let c of ['A', 'B', 'C', 'D']) {
        let candSigs = signals.filter(x => x.candidate === c);

        for (let tp of TP_VALS) {
            for (let sl of SL_VALS) {
                
                let tpHits = 0;
                let slHits = 0;
                let openAtEnd = 0;
                let totalHold = 0;
                let grossPnlUsdt = 0;
                let feesUsdt = 0;

                for (let s of candSigs) {
                    let reason = 'OPEN_AT_SESSION_END';
                    let exitTs = null, exitPrice = null;
                    
                    for (let tk of s.ticks) {
                        if (tk.fav >= tp) {
                            reason = 'TP'; exitTs = tk.ts; exitPrice = tk.price; break;
                        }
                        if (tk.adv >= sl) {
                            reason = 'SL'; exitTs = tk.ts; exitPrice = tk.price; break;
                        }
                    }
                    
                    if (reason === 'OPEN_AT_SESSION_END') {
                        let lastTk = s.ticks[s.ticks.length - 1];
                        exitTs = lastTk.ts; exitPrice = lastTk.price;
                        openAtEnd++;
                    } else if (reason === 'TP') {
                        tpHits++;
                    } else if (reason === 'SL') {
                        slHits++;
                    }

                    let holdTime = exitTs - s.ts;
                    let gross = s.dir === 'LONG' ? (exitPrice - s.entry) * QTY : (s.entry - exitPrice) * QTY;
                    let notional = s.entry * QTY;
                    let fees = notional * TAKER_FEE + (exitPrice * QTY * TAKER_FEE);
                    let net = gross - fees;

                    if (reason !== 'OPEN_AT_SESSION_END') {
                        totalHold += holdTime;
                        grossPnlUsdt += gross;
                        feesUsdt += fees;
                    }
                    
                    // Add to replay CSV (only for a subset to prevent giant files, maybe B 0.20/0.15)
                    if (c === 'B' && tp === 0.20 && sl === 0.15) {
                        replayRows.push(`${c},${tp},${sl},${s.ts},${s.dir},${s.entry},${exitTs},${exitPrice},${reason},${holdTime},${gross.toFixed(4)},${fees.toFixed(4)},${net.toFixed(4)}`);
                    }
                }

                let completed = tpHits + slHits;
                let winRate = completed > 0 ? tpHits / completed : 0;
                let avgHoldMs = completed > 0 ? totalHold / completed : 0;

                exitMatrix.push({
                    candidate: c, TP: tp, SL: sl,
                    attemptedEntries: candSigs.length,
                    completedTrades: completed,
                    openAtSessionEnd: openAtEnd,
                    tpHits: tpHits,
                    slHits: slHits,
                    winRate: winRate,
                    avgHoldMs: avgHoldMs,
                    grossPnlUsdt: grossPnlUsdt,
                    feesUsdt: feesUsdt,
                    netPnlUsdt: grossPnlUsdt - feesUsdt
                });
            }
        }
    }

    console.log("Writing files...");
    let emHeaders = Object.keys(exitMatrix[0]).join(',');
    let emRows = exitMatrix.map(m => Object.values(m).join(',')).join('\n');
    fs.writeFileSync(CSV_EXIT, `${emHeaders}\n${emRows}`);

    fs.writeFileSync(CSV_REPLAY, replayRows.join('\n'));

    fs.writeFileSync(JSON_REP, JSON.stringify({ matrix: exitMatrix }, null, 2));

    let rep = `================ PHASE 50A FINAL REPORT (FIXED) ================\n\n`;
    rep += `Total Signals Analyzed Independently: ${signals.length}\n`;
    rep += `Sample Result (Candidate B, TP=0.20, SL=0.15):\n`;
    let sample = exitMatrix.find(x => x.candidate === 'B' && x.TP === 0.20 && x.SL === 0.15);
    rep += JSON.stringify(sample, null, 2);
    
    fs.writeFileSync(TXT_REP, rep);

    console.log("Done.");
}

runForensicFixed();

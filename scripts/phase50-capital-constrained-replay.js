const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const REPORTS_DIR = path.join(__dirname, '../reports');

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const OBS_FILE = path.join(DATA_DIR, 'phase50-15m-live-observations.json');

const CSV_MATRIX = path.join(REPORTS_DIR, 'phase50-capital-constrained-matrix.csv');
const CSV_TRADES = path.join(REPORTS_DIR, 'phase50-capital-constrained-trades.csv');
const JSON_SUMMARY = path.join(REPORTS_DIR, 'phase50-capital-constrained-summary.json');
const TXT_REPORT = path.join(REPORTS_DIR, 'phase50-capital-constrained-final.txt');

// Constants
const QTY = 0.14;
const LEVERAGE = 5;
const START_BALANCE_INR = 300;
const USDT_INR = 86;
const TAKER_FEE_PCT = 0.001; // 0.10%

function runCapitalConstrainedReplay() {
    console.log("Loading observations...");
    if (!fs.existsSync(OBS_FILE)) {
        console.error("Missing obs file");
        process.exit(1);
    }
    const obs = JSON.parse(fs.readFileSync(OBS_FILE, 'utf8'));

    // Check capital constraints on first observation
    let firstPrice = obs[0].mid;
    let notional = firstPrice * QTY;
    let startBalUsdt = START_BALANCE_INR / USDT_INR;
    let maxNotional = startBalUsdt * LEVERAGE;
    let reqMarginUsdt = notional / LEVERAGE;
    let reqMarginInr = reqMarginUsdt * USDT_INR;

    console.log(`\n--- CAPITAL CHECK ---`);
    console.log(`Price: $${firstPrice.toFixed(2)}`);
    console.log(`Qty: ${QTY} SOL`);
    console.log(`Position Notional: $${notional.toFixed(2)}`);
    console.log(`Max Allowed Notional (5x): $${maxNotional.toFixed(2)}`);
    console.log(`Required Margin: ₹${reqMarginInr.toFixed(2)}`);
    console.log(`Available Margin: ₹${START_BALANCE_INR.toFixed(2)}`);

    if (notional > maxNotional) {
        console.error("STOP: Phase 50 quantity is NOT valid under ₹300 + 5x leverage constraint.");
        process.exit(1);
    }

    const logicMap = {
        'A': { imb: 2.0, edge: 0.002, useDir: false },
        'B': { imb: 3.0, edge: 0.003, useDir: false },
        'C': { imb: 2.0, edge: 0.002, useDir: true },
        'D': { imb: 3.0, edge: 0.003, useDir: true }
    };

    let state = {
        A: { prevEdgePct: 0 },
        B: { prevEdgePct: 0 },
        C: { prevEdgePct: 0 },
        D: { prevEdgePct: 0 }
    };

    let signals = [];
    const getMid1s = (ts) => {
        for (let i = obs.length - 1; i >= 0; i--) {
            if (ts - obs[i].ts >= 1000) return obs[i].mid;
        }
        return null;
    };

    console.log("Generating signals...");
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
                signals.push({ id: signals.length, candidate: c, dir: 'LONG', ts: o.ts, entry: o.ask, obsIdx: i, spread: o.spread });
            }
            if (sCond && st.prevEdgePct > -L.edge) {
                signals.push({ id: signals.length, candidate: c, dir: 'SHORT', ts: o.ts, entry: o.bid, obsIdx: i, spread: o.spread });
            }
            st.prevEdgePct = o.edgePct;
        }
    }
    
    // Sort signals chronologically
    signals.sort((a,b) => a.ts - b.ts);

    const TP_VALS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.5];
    const SL_VALS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.5];

    let exitMatrix = [];
    let tradeRows = ["candidate,TP,SL,fee_pct,signal_ts,direction,entry,exit_ts,exit_price,reason,hold_ms,gross_pnl,fees,net_pnl"];

    const feeScenarios = [0.001, 0.00075, 0.0005]; // 0.10%, 0.075%, 0.05%

    console.log("Running Capital-Constrained Single-Portfolio Replay...");
    for (let candidate of ['A', 'B', 'C', 'D']) {
        let candSigs = signals.filter(s => s.candidate === candidate);

        for (let tp of TP_VALS) {
            for (let sl of SL_VALS) {
                for (let feePct of feeScenarios) {

                    let accountEqUsdt = startBalUsdt;
                    let actualEntries = 0;
                    let ignoredSignals = 0;
                    let tpHits = 0;
                    let slHits = 0;
                    let bailoutHits = 0;
                    let openAtEnd = 0;
                    
                    let longEntries = 0;
                    let shortEntries = 0;

                    let totalHold = 0;
                    let maxHold = 0;
                    let holdTimes = [];

                    let totalGross = 0;
                    let totalFees = 0;
                    
                    let openTrade = null;
                    let maxDrawdown = 0;
                    let peakEq = accountEqUsdt;

                    // Evaluate chronologically
                    for (let s of candSigs) {
                        if (openTrade) {
                            ignoredSignals++;
                            continue;
                        }

                        // Try to enter
                        let currentNotional = s.entry * QTY;
                        let maxAllowed = accountEqUsdt * LEVERAGE;
                        if (currentNotional > maxAllowed) {
                            ignoredSignals++; // insufficient margin
                            continue;
                        }

                        actualEntries++;
                        if (s.dir === 'LONG') longEntries++;
                        else shortEntries++;

                        openTrade = { signal: s, reason: 'OPEN_AT_SESSION_END', entryFees: currentNotional * feePct };

                        // Find exit
                        for (let j = s.obsIdx; j < obs.length; j++) {
                            let tk = obs[j];
                            let exitPrice = s.dir === 'LONG' ? tk.bid : tk.ask;
                            
                            let fav = s.dir === 'LONG' ? exitPrice - s.entry : s.entry - exitPrice;
                            let adv = s.dir === 'LONG' ? s.entry - exitPrice : exitPrice - s.entry;
                            let favPct = fav / s.entry * 100;
                            let advPct = adv / s.entry * 100;

                            // Bailout (adverse 0.10% within 3s)
                            if (advPct <= -0.10 && tk.ts - s.ts <= 3000) {
                                openTrade.reason = 'BAILOUT';
                                openTrade.exitTs = tk.ts;
                                openTrade.exitPrice = exitPrice;
                                break;
                            }

                            if (favPct >= tp) {
                                openTrade.reason = 'TP';
                                openTrade.exitTs = tk.ts;
                                openTrade.exitPrice = exitPrice;
                                break;
                            }
                            if (advPct >= sl) {
                                openTrade.reason = 'SL';
                                openTrade.exitTs = tk.ts;
                                openTrade.exitPrice = exitPrice;
                                break;
                            }
                        }

                        if (openTrade.reason === 'OPEN_AT_SESSION_END') {
                            let lastTk = obs[obs.length - 1];
                            openTrade.exitTs = lastTk.ts;
                            openTrade.exitPrice = s.dir === 'LONG' ? lastTk.bid : lastTk.ask;
                            openAtEnd++;
                        }

                        // Calculate P&L
                        let gross = s.dir === 'LONG' ? (openTrade.exitPrice - s.entry) * QTY : (s.entry - openTrade.exitPrice) * QTY;
                        let exitFees = openTrade.exitPrice * QTY * feePct;
                        let totalTradeFees = openTrade.entryFees + exitFees;
                        let net = gross - totalTradeFees;

                        if (openTrade.reason !== 'OPEN_AT_SESSION_END') {
                            if (openTrade.reason === 'TP') tpHits++;
                            if (openTrade.reason === 'SL') slHits++;
                            if (openTrade.reason === 'BAILOUT') bailoutHits++;

                            let hold = openTrade.exitTs - s.ts;
                            totalHold += hold;
                            holdTimes.push(hold);
                            if (hold > maxHold) maxHold = hold;

                            totalGross += gross;
                            totalFees += totalTradeFees;
                            accountEqUsdt += net;
                            
                            if (accountEqUsdt > peakEq) peakEq = accountEqUsdt;
                            let dd = peakEq - accountEqUsdt;
                            if (dd > maxDrawdown) maxDrawdown = dd;

                            if (feePct === TAKER_FEE_PCT) {
                                tradeRows.push(`${candidate},${tp},${sl},${feePct},${s.ts},${s.dir},${s.entry},${openTrade.exitTs},${openTrade.exitPrice},${openTrade.reason},${hold},${gross.toFixed(4)},${totalTradeFees.toFixed(4)},${net.toFixed(4)}`);
                            }
                        }
                        
                        openTrade = null; // trade closed, ready for next signal
                    }

                    holdTimes.sort((a,b)=>a-b);
                    let medianHold = holdTimes.length > 0 ? holdTimes[Math.floor(holdTimes.length/2)] : 0;
                    let completed = tpHits + slHits + bailoutHits;

                    exitMatrix.push({
                        candidate: candidate,
                        TP: tp, SL: sl, feePct: feePct,
                        totalSignals: candSigs.length,
                        actualEntries: actualEntries,
                        ignoredSignals: ignoredSignals,
                        completedTrades: completed,
                        longEntries, shortEntries,
                        tpHits, slHits, bailoutHits, openAtSessionEnd: openAtEnd,
                        winRate: completed > 0 ? (tpHits/completed) : 0,
                        avgHoldMs: completed > 0 ? totalHold/completed : 0,
                        medianHoldMs: medianHold,
                        maxHoldMs: maxHold,
                        grossPnlUsdt: totalGross,
                        feesUsdt: totalFees,
                        netPnlUsdt: totalGross - totalFees,
                        startEqUsdt: startBalUsdt,
                        endEqUsdt: accountEqUsdt,
                        maxDrawdownUsdt: maxDrawdown,
                        tradesPerHour: completed / (15/60)
                    });
                }
            }
        }
    }

    console.log("Writing reports...");
    
    // Matrix CSV
    let emHeaders = Object.keys(exitMatrix[0]).join(',');
    let emRows = exitMatrix.map(m => Object.values(m).join(',')).join('\n');
    fs.writeFileSync(CSV_MATRIX, `${emHeaders}\n${emRows}`);

    // Trades CSV
    fs.writeFileSync(CSV_TRADES, tradeRows.join('\n'));

    // JSON summary
    fs.writeFileSync(JSON_SUMMARY, JSON.stringify({ matrix: exitMatrix }, null, 2));

    // TXT Report
    let rep = `================ PHASE 50 CAPITAL-CONSTRAINED REPLAY ================\n`;
    rep += `REAL COINDCX DATA\nACCOUNT = ₹300\nLEVERAGE = 5×\nONE POSITION AT A TIME\n==================================================================\n\n`;
    
    rep += `--- CAPITAL VALIDATION ---\n`;
    rep += `Position Qty: ${QTY} SOL\n`;
    rep += `Position Notional: $${notional.toFixed(2)}\n`;
    rep += `Required Margin: ₹${reqMarginInr.toFixed(2)}\n`;
    rep += `Available Margin: ₹${START_BALANCE_INR.toFixed(2)}\n`;
    rep += `Status: VALID\n\n`;

    let baselineB = exitMatrix.find(x => x.candidate === 'B' && x.TP === 0.20 && x.SL === 0.15 && x.feePct === 0.001);
    
    rep += `--- SAMPLE RESULTS (Candidate B | TP=0.20%, SL=0.15% | Fee=0.10%) ---\n`;
    if (baselineB) {
        rep += `1. How many Phase 50 signals occurred? ${baselineB.totalSignals}\n`;
        rep += `2. How many became actual entries? ${baselineB.actualEntries}\n`;
        rep += `3. How many were ignored because the account already had a position? ${baselineB.ignoredSignals}\n`;
        rep += `4. How many completed trades occurred? ${baselineB.completedTrades}\n`;
        rep += `5. How many trades/hour actually occurred? ${baselineB.tradesPerHour.toFixed(1)}\n`;
        rep += `6. How much margin was used? ~₹${reqMarginInr.toFixed(2)} at peak\n`;
        rep += `7. What was gross P&L? $${baselineB.grossPnlUsdt.toFixed(4)}\n`;
        rep += `8. What were total fees? $${baselineB.feesUsdt.toFixed(4)}\n`;
        rep += `9. What was net P&L? $${baselineB.netPnlUsdt.toFixed(4)}\n`;
        rep += `10. How many positions remained open? ${baselineB.openAtSessionEnd}\n`;
    }

    rep += `\n--- FEE SENSITIVITY HIGHLIGHTS ---\n`;
    let fee5B = exitMatrix.find(x => x.candidate === 'B' && x.TP === 0.20 && x.SL === 0.15 && x.feePct === 0.0005);
    if (fee5B) {
        rep += `If Taker Fee is reduced to 0.05%:\n`;
        rep += `Net P&L changes from $${baselineB.netPnlUsdt.toFixed(4)} to $${fee5B.netPnlUsdt.toFixed(4)}\n`;
    }

    rep += `\n--- LIMITATIONS ---\n`;
    rep += `This is a 15-minute sample only. No long term profitability is claimed.\n`;

    fs.writeFileSync(TXT_REPORT, rep);

    console.log("Completed Capital Constrained Replay.");
}

runCapitalConstrainedReplay();

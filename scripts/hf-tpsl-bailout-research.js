const fs = require('fs');
const path = require('path');

const DATASET_PATH = path.join(__dirname, '../public/data/b-sol-usdt-tick-data.jsonl');
const REPORT_TXT = path.join(__dirname, '../reports/hf-tpsl-bailout-research.txt');
const REPORT_JSON = path.join(__dirname, '../reports/hf-tpsl-bailout-research.json');
const REPORT_MAP = path.join(__dirname, '../reports/hf-tpsl-bailout-code-map.json');

const QTY = 0.14;
const USDT_INR = 86.0;
const FEE_RATE = 0.001; // 0.10% per side
const LEVERAGE = 5;

// Exit thresholds
const TP_PCT = 0.0150; // 1.50%
const SL_PCT = 0.0150; // 1.50%
const BAILOUT_PCT = 0.0010; // 0.10%
const BAILOUT_TIME_MS = 3000; // 3 seconds

function loadTickData() {
    if (!fs.existsSync(DATASET_PATH)) return [];
    const content = fs.readFileSync(DATASET_PATH, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() !== '');
    return lines.map(l => JSON.parse(l));
}

function runResearch() {
    console.log("Loading high-resolution tick data...");
    const ticks = loadTickData();
    if (ticks.length === 0) {
        console.error("No tick data found. Ensure the collection script has gathered data.");
        return;
    }

    const firstTs = ticks[0].localTs;
    const lastTs = ticks[ticks.length - 1].localTs;
    const durationHours = (lastTs - firstTs) / (1000 * 60 * 60);
    const splitTs = firstTs + (lastTs - firstTs) * 0.7; // 70% IS, 30% OOS

    console.log(`Loaded ${ticks.length} tick events.`);
    console.log(`Dataset Duration: ${durationHours.toFixed(2)} hours`);
    
    // Separate orderbook and trades
    const obTicks = ticks.filter(t => t.type === 'orderbook');
    const tradeTicks = ticks.filter(t => t.type === 'trade');

    // Build 1-second sampled array for momentum logic
    const secTicks = [];
    let lastSec = 0;
    for (const t of obTicks) {
        if (t.localTs - lastSec >= 1000) {
            secTicks.push(t);
            lastSec = t.localTs;
        }
    }

    // Strategies
    const configs = [];

    // Strategy A: Orderbook Imbalance (Tick Level)
    configs.push({
        name: 'A-Orderbook_Imbalance',
        logic: (idx, ob) => {
            if (idx < 5) return null; // Need history
            const t = ob[idx];
            // If bid volume is > 3x ask volume, LONG. Reverse for SHORT.
            if (t.bidQty > t.askQty * 3) return 'LONG';
            if (t.askQty > t.bidQty * 3) return 'SHORT';
            return null;
        },
        trades: [], signals: 0, ignored: 0, isTrades: [], oosTrades: []
    });

    // Strategy B: Micro-Trend Price Acceleration (1-sec sampling)
    configs.push({
        name: 'B-Price_Acceleration',
        logic: (idx, ob) => {
            if (idx < 3) return null;
            const t0 = ob[idx].bestBid;
            const t1 = ob[idx-1].bestBid;
            const t2 = ob[idx-2].bestBid;
            
            // 3 consecutive increases
            if (t0 > t1 && t1 > t2) return 'LONG';
            if (t0 < t1 && t1 < t2) return 'SHORT';
            return null;
        },
        trades: [], signals: 0, ignored: 0, isTrades: [], oosTrades: []
    });

    // Engine loop
    for (const config of configs) {
        let positionOpen = false;

        for (let i = 5; i < obTicks.length; i++) {
            const currentOB = obTicks[i];
            
            if (positionOpen) continue; // One position at a time

            const dir = config.logic(i, obTicks);

            if (dir) {
                config.signals++;
                positionOpen = true;

                const entryTs = currentOB.localTs;
                const entryBid = currentOB.bestBid;
                const entryAsk = currentOB.bestAsk;

                let entryPrice = dir === 'LONG' ? entryAsk : entryBid; // Real execution

                let tpPrice = dir === 'LONG' ? entryPrice * (1 + TP_PCT) : entryPrice * (1 - TP_PCT);
                let slPrice = dir === 'LONG' ? entryPrice * (1 - SL_PCT) : entryPrice * (1 + SL_PCT);
                
                let exitPrice = 0;
                let exitTs = 0;
                let exitReason = '';

                // Look forward tick by tick to find exit
                for (let j = i + 1; j < obTicks.length; j++) {
                    const futureOB = obTicks[j];
                    const elapsedMs = futureOB.localTs - entryTs;
                    
                    const currentExecBid = futureOB.bestBid;
                    const currentExecAsk = futureOB.bestAsk;

                    if (dir === 'LONG') {
                        // Bailout check
                        if (elapsedMs <= BAILOUT_TIME_MS) {
                            if (currentExecBid <= entryPrice * (1 - BAILOUT_PCT)) {
                                exitPrice = currentExecBid;
                                exitTs = futureOB.localTs;
                                exitReason = 'BAILOUT';
                                break;
                            }
                        }
                        // TP / SL Check
                        if (currentExecBid >= tpPrice) {
                            exitPrice = currentExecBid;
                            exitTs = futureOB.localTs;
                            exitReason = 'TP';
                            break;
                        } else if (currentExecBid <= slPrice) {
                            exitPrice = currentExecBid;
                            exitTs = futureOB.localTs;
                            exitReason = 'SL';
                            break;
                        }
                    } else {
                        // SHORT
                        if (elapsedMs <= BAILOUT_TIME_MS) {
                            if (currentExecAsk >= entryPrice * (1 + BAILOUT_PCT)) {
                                exitPrice = currentExecAsk;
                                exitTs = futureOB.localTs;
                                exitReason = 'BAILOUT';
                                break;
                            }
                        }
                        if (currentExecAsk <= tpPrice) {
                            exitPrice = currentExecAsk;
                            exitTs = futureOB.localTs;
                            exitReason = 'TP';
                            break;
                        } else if (currentExecAsk >= slPrice) {
                            exitPrice = currentExecAsk;
                            exitTs = futureOB.localTs;
                            exitReason = 'SL';
                            break;
                        }
                    }
                }

                if (exitReason !== '') {
                    // Calculate P&L
                    const entryNotionalUsdt = entryPrice * QTY;
                    const exitNotionalUsdt = exitPrice * QTY;
                    
                    const entryNotionalInr = entryNotionalUsdt * USDT_INR;
                    const exitNotionalInr = exitNotionalUsdt * USDT_INR;

                    const entryFeeInr = entryNotionalInr * FEE_RATE;
                    const exitFeeInr = exitNotionalInr * FEE_RATE;

                    let grossPnLUsdt = dir === 'LONG' ? (exitPrice - entryPrice) * QTY : (entryPrice - exitPrice) * QTY;
                    let grossPnLInr = grossPnLUsdt * USDT_INR;
                    
                    const netPnLInr = grossPnLInr - (entryFeeInr + exitFeeInr);
                    const isIS = entryTs < splitTs;

                    const trade = {
                        id: config.trades.length + 1,
                        dir,
                        entryTs,
                        exitTs,
                        holdSec: (exitTs - entryTs) / 1000,
                        entryPrice,
                        exitPrice,
                        exitReason,
                        grossPnL: grossPnLInr,
                        entryFee: entryFeeInr,
                        exitFee: exitFeeInr,
                        netPnL: netPnLInr,
                        win: netPnLInr > 0,
                        isIS
                    };

                    config.trades.push(trade);
                    if (isIS) config.isTrades.push(trade);
                    else config.oosTrades.push(trade);

                    // Resume scanning from exit timestamp
                    i = obTicks.findIndex(t => t.localTs >= exitTs) - 1;
                    if (i < 0) i = obTicks.length;
                    positionOpen = false;
                }
            }
        }
    }

    // Analytics
    const calcMetrics = (trades, days) => {
        if (trades.length === 0) return {
            longs: 0, shorts: 0, wins: 0, losses: 0, winRate: 0,
            grossPnL: 0, totalFees: 0, netPnL: 0, avgPnL: 0, medianPnL: 0,
            pf: 0, maxDd: 0, tradesPerDay: 0, tradesPerHour: 0,
            longWins: 0, shortWins: 0, longNet: 0, shortNet: 0,
            avgWinner: 0, avgLoser: 0,
            tpCount: 0, slCount: 0, bailoutCount: 0,
            tpRate: 0, slRate: 0, bailoutRate: 0
        };

        const longs = trades.filter(t => t.dir === 'LONG');
        const shorts = trades.filter(t => t.dir === 'SHORT');
        const wins = trades.filter(t => t.win);
        const losses = trades.filter(t => !t.win);
        
        let grossPnL = 0, totalFees = 0, netPnL = 0;
        let grossWinAmount = 0, grossLossAmount = 0;
        let maxDd = 0, peak = 0, currentBalance = 0;
        const pnls = [];

        let tpCount = 0, slCount = 0, bailoutCount = 0;

        for (const t of trades) {
            grossPnL += t.grossPnL;
            totalFees += t.entryFee + t.exitFee;
            netPnL += t.netPnL;
            pnls.push(t.netPnL);

            if (t.exitReason === 'TP') tpCount++;
            if (t.exitReason === 'SL') slCount++;
            if (t.exitReason === 'BAILOUT') bailoutCount++;

            if (t.netPnL > 0) grossWinAmount += t.netPnL;
            else grossLossAmount += Math.abs(t.netPnL);

            currentBalance += t.netPnL;
            if (currentBalance > peak) peak = currentBalance;
            const dd = peak - currentBalance;
            if (dd > maxDd) maxDd = dd;
        }

        pnls.sort((a,b) => a-b);
        const medianPnL = pnls.length % 2 !== 0 ? pnls[Math.floor(pnls.length/2)] : (pnls.length ? (pnls[pnls.length/2 - 1] + pnls[pnls.length/2]) / 2 : 0);

        return {
            longs: longs.length,
            shorts: shorts.length,
            wins: wins.length,
            losses: losses.length,
            winRate: (wins.length / trades.length) * 100,
            grossPnL,
            totalFees,
            netPnL,
            avgPnL: netPnL / trades.length,
            medianPnL,
            pf: grossLossAmount > 0 ? (grossWinAmount / grossLossAmount) : 999,
            maxDd,
            tradesPerDay: trades.length / days,
            tradesPerHour: trades.length / (days * 24),
            longWins: longs.filter(t=>t.win).length,
            shortWins: shorts.filter(t=>t.win).length,
            longNet: longs.reduce((acc, t) => acc + t.netPnL, 0),
            shortNet: shorts.reduce((acc, t) => acc + t.netPnL, 0),
            avgWinner: wins.length ? grossWinAmount / wins.length : 0,
            avgLoser: losses.length ? grossLossAmount / losses.length : 0,
            tpCount, slCount, bailoutCount,
            tpRate: (tpCount / trades.length) * 100,
            slRate: (slCount / trades.length) * 100,
            bailoutRate: (bailoutCount / trades.length) * 100
        };
    };

    let textOut = "";
    const log = (msg) => { textOut += msg + "\n"; };

    log(`================ HIGH-FREQUENCY TP/SL/BAILOUT RESEARCH ================`);
    log(`1. Actual usable data: b-sol-usdt-tick-data.jsonl`);
    log(`2. Data duration: ${durationHours.toFixed(4)} hours`);
    log(`3. Resolution: Tick level / Orderbook updates`);
    log(`4. P&L currency: INR (₹)`);
    log(`5. Fee assumptions: 0.10% per side (0.20% round trip)`);
    log(`6. Spread assumptions: Real historical bid/ask spread used`);
    log(`7. Leverage: ${LEVERAGE}x (Margin only)`);
    log(`8. Exits: TP 1.50%, SL 1.50%, BAILOUT 0.10% in <= 3s`);
    log(`\nUnderlying P&L currency: USDT`);
    log(`INR conversion method: Hardcoded Multiplier`);
    log(`Conversion rate source: Project configuration (86.0)`);
    log(`Final reported P&L currency: INR (₹)\n`);

    log(`================ BACKTEST OUTPUT (IN-SAMPLE) ================`);
    let headers = ["Strategy", "Signals/hr", "Trades/hr", "LONG", "SHORT", "Win Rate", "Avg Winner", "Avg Loser", "TP Count", "SL Count", "Bailout Count", "Gross P&L", "Fees", "Net P&L", "PF", "Max DD"];
    log(`| ${headers.join(' | ')} |`);
    log(`|${headers.map(() => '---').join('|')}|`);
    
    const IS_DAYS = (splitTs - firstTs) / (1000 * 60 * 60 * 24);
    
    for (const c of configs) {
        const m = calcMetrics(c.isTrades, IS_DAYS || 0.001);
        const sigHr = (c.signals * 0.7) / (IS_DAYS * 24);
        const row = [
            c.name,
            sigHr.toFixed(2),
            m.tradesPerHour.toFixed(2),
            m.longs,
            m.shorts,
            `${m.winRate.toFixed(2)}%`,
            `₹${m.avgWinner.toFixed(2)}`,
            `₹${m.avgLoser.toFixed(2)}`,
            m.tpCount,
            m.slCount,
            m.bailoutCount,
            `₹${m.grossPnL.toFixed(2)}`,
            `₹${m.totalFees.toFixed(2)}`,
            `₹${m.netPnL.toFixed(2)}`,
            m.pf.toFixed(2),
            `₹${m.maxDd.toFixed(2)}`
        ];
        log(`| ${row.join(' | ')} |`);
    }

    log(`\n================ LONG VS SHORT (IN-SAMPLE) ================`);
    const lsHeaders = ["Strategy", "Direction", "Trades/hr", "Win Rate", "TP %", "SL %", "Bailout %", "Avg Winner", "Avg Loser", "Net P&L"];
    log(`| ${lsHeaders.join(' | ')} |`);
    log(`|${lsHeaders.map(() => '---').join('|')}|`);
    for (const c of configs) {
        const m = calcMetrics(c.isTrades, IS_DAYS || 0.001);
        let lW = m.longs > 0 ? (m.longWins/m.longs*100).toFixed(2)+'%' : '0.00%';
        let sW = m.shorts > 0 ? (m.shortWins/m.shorts*100).toFixed(2)+'%' : '0.00%';
        
        let lTrHr = m.longs / (IS_DAYS * 24);
        let sTrHr = m.shorts / (IS_DAYS * 24);
        
        let lAvgW = m.longWins > 0 ? m.longNet / m.longWins : 0;
        let sAvgW = m.shortWins > 0 ? m.shortNet / m.shortWins : 0;
        
        log(`| ${c.name} | LONG | ${lTrHr.toFixed(2)} | ${lW} | - | - | - | ₹${lAvgW.toFixed(2)} | - | ₹${m.longNet.toFixed(2)} |`);
        log(`| ${c.name} | SHORT | ${sTrHr.toFixed(2)} | ${sW} | - | - | - | ₹${sAvgW.toFixed(2)} | - | ₹${m.shortNet.toFixed(2)} |`);
    }

    log(`\n================ TP / SL ANALYSIS ================`);
    for (const c of configs) {
        const m = calcMetrics(c.isTrades, IS_DAYS || 0.001);
        
        let timeTp = 0, timeSl = 0, timeBailout = 0;
        let longestWin = 0, longestLoss = 0;

        for (const t of c.isTrades) {
            if (t.exitReason === 'TP') timeTp += t.holdSec;
            if (t.exitReason === 'SL') timeSl += t.holdSec;
            if (t.exitReason === 'BAILOUT') timeBailout += t.holdSec;

            if (t.win && t.holdSec > longestWin) longestWin = t.holdSec;
            if (!t.win && t.holdSec > longestLoss) longestLoss = t.holdSec;
        }

        const avgTimeTp = m.tpCount ? timeTp / m.tpCount : 0;
        const avgTimeSl = m.slCount ? timeSl / m.slCount : 0;
        const avgTimeBailout = m.bailoutCount ? timeBailout / m.bailoutCount : 0;

        log(`Strategy: ${c.name}`);
        log(`TP hit rate: ${m.tpRate.toFixed(2)}%`);
        log(`SL hit rate: ${m.slRate.toFixed(2)}%`);
        log(`Bailout hit rate: ${m.bailoutRate.toFixed(2)}%`);
        log(`Average time to TP: ${avgTimeTp.toFixed(2)}s`);
        log(`Average time to SL: ${avgTimeSl.toFixed(2)}s`);
        log(`Average time to bailout: ${avgTimeBailout.toFixed(2)}s`);
        log(`Longest winning trade: ${longestWin.toFixed(2)}s`);
        log(`Longest losing trade: ${longestLoss.toFixed(2)}s\n`);
    }

    log(`================ TARGET CHECK ================`);
    for (const c of configs) {
        const m = calcMetrics(c.isTrades, IS_DAYS || 0.001);
        if (m.wins > 0) {
            let requiredMult10 = 10.0 / m.avgWinner;
            let targetQty10 = QTY * requiredMult10;
            let targetMargin10 = (targetQty10 * 140 * USDT_INR) / LEVERAGE;

            let requiredMult15 = 15.0 / m.avgWinner;
            let targetQty15 = QTY * requiredMult15;
            let targetMargin15 = (targetQty15 * 140 * USDT_INR) / LEVERAGE;

            let requiredMult20 = 20.0 / m.avgWinner;
            let targetQty20 = QTY * requiredMult20;
            let targetMargin20 = (targetQty20 * 140 * USDT_INR) / LEVERAGE;

            log(`Strategy: ${c.name}`);
            log(`Actual trades/hour: ${m.tradesPerHour.toFixed(2)}`);
            log(`Target trades/hour: 10 - 20`);
            log(`Actual average winning trade: ₹${m.avgWinner.toFixed(2)}`);
            log(`Target: ₹10-₹20`);
            log(`Actual margin at 5x: ~₹${((QTY * 140 * USDT_INR) / LEVERAGE).toFixed(2)}`);
            log(`Estimated quantity needed for:`);
            log(`₹10 winner: ~${targetQty10.toFixed(2)} SOL (Margin: ₹${targetMargin10.toFixed(2)})`);
            log(`₹15 winner: ~${targetQty15.toFixed(2)} SOL (Margin: ₹${targetMargin15.toFixed(2)})`);
            log(`₹20 winner: ~${targetQty20.toFixed(2)} SOL (Margin: ₹${targetMargin20.toFixed(2)})\n`);
        }
    }

    log(`================ TRADE LOG ================`);
    for (const c of configs) {
        const sampleTrades = c.isTrades.slice(0, 5); // print up to 5 trades
        for (const t of sampleTrades) {
            log(`Trade #: ${t.id}`);
            log(`Strategy: ${c.name}`);
            log(`Direction: ${t.dir}`);
            log(`Signal timestamp: ${new Date(t.entryTs).toISOString()}`);
            log(`Entry timestamp: ${new Date(t.entryTs).toISOString()}`);
            log(`Exit timestamp: ${new Date(t.exitTs).toISOString()}`);
            log(`Entry Bid: -`);
            log(`Entry Ask: -`);
            log(`Exit Bid: -`);
            log(`Exit Ask: -`);
            log(`Entry execution price: ${t.entryPrice.toFixed(4)}`);
            log(`Exit execution price: ${t.exitPrice.toFixed(4)}`);
            log(`Quantity: ${QTY}`);
            log(`Leverage: ${LEVERAGE}`);
            log(`Notional: ₹${((t.entryPrice * QTY) * USDT_INR).toFixed(2)}`);
            log(`Margin: ₹${(((t.entryPrice * QTY) * USDT_INR) / LEVERAGE).toFixed(2)}`);
            log(`TP price: -`);
            log(`SL price: -`);
            log(`Bailout threshold: -`);
            log(`Exit reason: ${t.exitReason}`);
            log(`Hold duration: ${t.holdSec}s`);
            log(`Gross P&L: ₹${t.grossPnL.toFixed(2)}`);
            log(`Entry fee: ₹${t.entryFee.toFixed(2)}`);
            log(`Exit fee: ₹${t.exitFee.toFixed(2)}`);
            log(`Spread impact: Embedded in execution price`);
            log(`Net P&L: ₹${t.netPnL.toFixed(2)}`);
            log(`Win/Loss: ${t.win ? 'WIN' : 'LOSS'}\n`);
        }
    }

    fs.writeFileSync(REPORT_TXT, textOut);
    fs.writeFileSync(REPORT_JSON, JSON.stringify(configs, null, 2));

    const codeMap = {
        "WebSocket": { "File": "scratch/phase42b-live.js", "Function": "io('wss://stream.coindcx.com')" },
        "Orderbook": { "File": "scratch/phase42b-live.js", "Function": "socket.onevent (orderbook)" },
        "Best Bid/Ask": { "File": "scratch/phase42b-live.js", "Function": "payload parser" },
        "Tick/trade data": { "File": "scripts/phase45-data-collector.js", "Function": "Tick jsonl collector" },
        "1-minute candle builder": { "File": "scripts/phase43-fresh-validation.js", "Function": "fetchFreshData()" },
        "Strategy": { "File": "scripts/hf-tpsl-bailout-research.js", "Function": "Multi-factor tick logic" },
        "Signal engine": { "File": "scripts/hf-tpsl-bailout-research.js", "Function": "config.logic" },
        "TP/SL engine": { "File": "scripts/hf-tpsl-bailout-research.js", "Function": "Tick loop exec" },
        "3-sec / 0.10% bailout": { "File": "scripts/hf-tpsl-bailout-research.js", "Function": "elapsedMs <= 3000 check" },
        "Paper execution": { "File": "scratch/phase42b-live.js", "Function": "executePaperTrade()" },
        "P&L": { "File": "scripts/phase20b-audit.js", "Function": "(priceDiff * actualQty * usdtInr)" },
        "Fee calculation": { "File": "scripts/phase20b-audit.js", "Function": "notionalInr * 0.001" },
        "Position manager": { "File": "scripts/hf-tpsl-bailout-research.js", "Function": "positionOpen block" },
        "Research runner": { "File": "scripts/hf-tpsl-bailout-research.js" },
        "Report": { "File": "reports/hf-tpsl-bailout-research.txt" }
    };
    fs.writeFileSync(REPORT_MAP, JSON.stringify(codeMap, null, 2));

    console.log("Backtest completed. Check reports for details.");
}

runResearch();

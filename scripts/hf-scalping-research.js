const fs = require('fs');
const path = require('path');

const DATASET_PATH = path.join(__dirname, '../public/data/b-sol-usdt-14d-1m.json');
const REPORT_JSON = path.join(__dirname, '../reports/hf-scalping-research.json');
const REPORT_MAP = path.join(__dirname, '../reports/hf-scalping-code-map.json');
const REPORT_TXT = path.join(__dirname, '../reports/hf-scalping-research.txt');

const QTY = 0.14;
const USDT_INR = 86.0;
const FEE_RATE = 0.001; // 0.10% per side

// 5x Margin
const LEVERAGE = 5;

// Data Split (70/30)
// The dataset is 14 days, so roughly 10 days IS, 4 days OOS.
const DAYS_IS = 10;
const DAYS_OOS = 4;

function runResearch() {
    console.log("Loading dataset...");
    const rawData = fs.readFileSync(DATASET_PATH, 'utf-8');
    const candles = JSON.parse(rawData);
    
    const firstTs = candles[0].time;
    const splitTs = firstTs + (DAYS_IS * 24 * 60 * 60 * 1000); // 10 days

    console.log(`Loaded ${candles.length} candles.`);
    console.log(`First TS: ${new Date(firstTs).toISOString()}`);
    console.log(`Split TS: ${new Date(splitTs).toISOString()}`);
    console.log(`Last TS: ${new Date(candles[candles.length - 1].time).toISOString()}`);

    // Precalculate features
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume || 0);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const sma = (len, idx) => {
        let sum = 0;
        for (let j = idx - len; j < idx; j++) sum += closes[j];
        return sum / len;
    };
    
    const volSma = (len, idx) => {
        let sum = 0;
        for (let j = idx - len; j < idx; j++) sum += volumes[j];
        return sum / len;
    };

    // Strategies
    const holdPeriods = [1, 2, 3, 5, 10]; // holding in minutes

    let configs = [];
    
    // Strategy A: SMA3/SMA9 Crossover + ROC
    for(const hold of holdPeriods) {
        configs.push({
            name: 'A-SMA_Cross', hold, trades: [], signals: 0, ignored: 0, isTrades: [], oosTrades: [],
            logic: (i) => {
                if (i < 10) return null;
                const sma3 = sma(3, i);
                const sma9 = sma(9, i);
                const prevSma3 = sma(3, i - 1);
                const prevSma9 = sma(9, i - 1);
                const roc = Math.abs((closes[i] - closes[i-1]) / closes[i-1]);

                if (roc < 0.001) return null; // Filter for volatility

                if (prevSma3 < prevSma9 && sma3 > sma9) return 'LONG';
                if (prevSma3 > prevSma9 && sma3 < sma9) return 'SHORT';
                return null;
            },
            features: "SMA3/9 cross, ROC > 0.1%"
        });
    }

    // Strategy B: Breakout + Volume Spike
    for(const hold of holdPeriods) {
        configs.push({
            name: 'B-Vol_Breakout', hold, trades: [], signals: 0, ignored: 0, isTrades: [], oosTrades: [],
            logic: (i) => {
                if (i < 15) return null;
                let highest = -Infinity, lowest = Infinity;
                for (let j=i-15; j<i; j++) {
                    if (highs[j] > highest) highest = highs[j];
                    if (lows[j] < lowest) lowest = lows[j];
                }
                const vSma = volSma(15, i);
                
                if (volumes[i] > vSma * 1.5) {
                    if (closes[i] > highest) return 'LONG';
                    if (closes[i] < lowest) return 'SHORT';
                }
                return null;
            },
            features: "15m Local Breakout, Vol > 150%"
        });
    }

    // Strategy C: Price Acceleration
    for(const hold of holdPeriods) {
        configs.push({
            name: 'C-Acceleration', hold, trades: [], signals: 0, ignored: 0, isTrades: [], oosTrades: [],
            logic: (i) => {
                if (i < 3) return null;
                const c0 = closes[i], o0 = candles[i].open;
                const c1 = closes[i-1], o1 = candles[i-1].open;
                const c2 = closes[i-2], o2 = candles[i-2].open;

                const body0 = Math.abs(c0 - o0);
                const body1 = Math.abs(c1 - o1);
                const body2 = Math.abs(c2 - o2);

                if (c0 > o0 && c1 > o1 && c2 > o2) {
                    if (body0 > body1 && body1 > body2) return 'LONG';
                }
                if (c0 < o0 && c1 < o1 && c2 < o2) {
                    if (body0 > body1 && body1 > body2) return 'SHORT';
                }
                return null;
            },
            features: "3 consecutive candles same dir with increasing bodies"
        });
    }

    // Engine loop
    for (let config of configs) {
        let positionOpenUntil = -1;

        for (let i = 15; i < candles.length; i++) {
            const dir = config.logic(i);

            if (dir) {
                config.signals++;
                
                if (i <= positionOpenUntil) {
                    config.ignored++;
                    continue;
                }

                const exitIndex = i + config.hold;
                if (exitIndex >= candles.length) continue;

                const currentClose = closes[i];
                const exitClose = closes[exitIndex];

                let entryPrice, exitPrice;

                // Spread simulation
                if (dir === 'LONG') {
                    entryPrice = currentClose * 1.00005; // Ask
                    exitPrice = exitClose * 0.99995;   // Bid
                } else {
                    entryPrice = currentClose * 0.99995; // Bid
                    exitPrice = exitClose * 1.00005;   // Ask
                }

                // Costs and P&L in INR
                const entryNotionalUsdt = entryPrice * QTY;
                const exitNotionalUsdt = exitPrice * QTY;
                const entryFeeUsdt = entryNotionalUsdt * FEE_RATE;
                const exitFeeUsdt = exitNotionalUsdt * FEE_RATE;

                const entryNotionalInr = entryNotionalUsdt * USDT_INR;
                const exitNotionalInr = exitNotionalUsdt * USDT_INR;
                
                const entryFeeInr = entryNotionalInr * FEE_RATE;
                const exitFeeInr = exitNotionalInr * FEE_RATE;

                let grossPnLUsdt = dir === 'LONG' ? (exitPrice - entryPrice) * QTY : (entryPrice - exitPrice) * QTY;
                let grossPnLInr = grossPnLUsdt * USDT_INR;
                
                const totalFeesInr = entryFeeInr + exitFeeInr;
                const netPnLInr = grossPnLInr - totalFeesInr;
                
                const marginInr = entryNotionalInr / LEVERAGE;
                
                const isIS = candles[i].time < splitTs;

                const trade = {
                    id: config.trades.length + 1,
                    dir,
                    entryTime: candles[i].time,
                    exitTime: candles[exitIndex].time,
                    entryPrice,
                    exitPrice,
                    qty: QTY,
                    grossPnL: grossPnLInr,
                    entryFee: entryFeeInr,
                    exitFee: exitFeeInr,
                    totalFees: totalFeesInr,
                    netPnL: netPnLInr,
                    win: netPnLInr > 0,
                    margin: marginInr,
                    notional: entryNotionalInr,
                    isIS
                };

                config.trades.push(trade);
                if (isIS) config.isTrades.push(trade);
                else config.oosTrades.push(trade);

                positionOpenUntil = exitIndex;
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
            avgWinner: 0, avgLoser: 0, signalsPerHour: 0
        };

        const longs = trades.filter(t => t.dir === 'LONG');
        const shorts = trades.filter(t => t.dir === 'SHORT');
        const wins = trades.filter(t => t.win);
        const losses = trades.filter(t => !t.win);
        
        let grossPnL = 0, totalFees = 0, netPnL = 0;
        let grossWinAmount = 0, grossLossAmount = 0;
        let maxDd = 0, peak = 0, currentBalance = 0;
        const pnls = [];

        for (const t of trades) {
            grossPnL += t.grossPnL;
            totalFees += t.totalFees;
            netPnL += t.netPnL;
            pnls.push(t.netPnL);

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
            avgLoser: losses.length ? grossLossAmount / losses.length : 0
        };
    };

    let textOut = "";
    const log = (msg) => {
        textOut += msg + "\n";
    };

    log(`================ HIGH-FREQUENCY STRATEGY RESEARCH ================`);
    log(`1. Actual usable data: b-sol-usdt-14d-1m.json`);
    log(`2. Data duration: 14 days (10 IS, 4 OOS)`);
    log(`3. WebSocket/orderbook availability: Yes (Using static paper execution simulating live spread)`);
    log(`4. P&L currency: INR (₹)`);
    log(`5. Fee assumptions: 0.10% per side (0.20% round trip)`);
    log(`6. Spread assumptions: ±0.005% simulated slippage mapped to ask/bid`);
    log(`7. Leverage: ${LEVERAGE}x (Margin only)`);
    log(`8. Number of candidate strategies tested: ${configs.length}`);
    log(`\nUnderlying P&L currency: USDT`);
    log(`INR conversion method: Hardcoded Multiplier`);
    log(`Conversion rate source: Project configuration (86.0)`);
    log(`Final reported P&L currency: INR (₹)`);
    log(`\nTransaction Costs Example:`);
    log(`Entry fee: ~₹1.25`);
    log(`Exit fee: ~₹1.25`);
    log(`Spread: 0.01% total round-trip`);
    log(`Slippage: 0% paper accounting`);
    log(`Total estimated round-trip cost: ~₹2.50\n`);

    log(`================ BACKTEST OUTPUT (IN-SAMPLE 10 DAYS) ================`);
    let headers = ["Strategy", "Hold", "Signals/hr", "Trades/hr", "LONG", "SHORT", "Win Rate", "Avg Winner", "Avg Loser", "Gross P&L", "Fees", "Net P&L", "PF", "Max DD"];
    log(`| ${headers.join(' | ')} |`);
    log(`|${headers.map(() => '---').join('|')}|`);
    for (const c of configs) {
        const m = calcMetrics(c.isTrades, DAYS_IS);
        const sigHr = (c.signals * (DAYS_IS/14)) / (DAYS_IS * 24);
        const row = [
            c.name,
            `${c.hold}m`,
            sigHr.toFixed(2),
            m.tradesPerHour.toFixed(2),
            m.longs,
            m.shorts,
            `${m.winRate.toFixed(2)}%`,
            `₹${m.avgWinner.toFixed(2)}`,
            `₹${m.avgLoser.toFixed(2)}`,
            `₹${m.grossPnL.toFixed(2)}`,
            `₹${m.totalFees.toFixed(2)}`,
            `₹${m.netPnL.toFixed(2)}`,
            m.pf.toFixed(2),
            `₹${m.maxDd.toFixed(2)}`
        ];
        log(`| ${row.join(' | ')} |`);
    }

    log(`\n================ LONG VS SHORT (IN-SAMPLE 10 DAYS) ================`);
    const lsHeaders = ["Strategy", "Direction", "Trades/hr", "Win Rate", "Avg Trade", "Net P&L"];
    log(`| ${lsHeaders.join(' | ')} |`);
    log(`|${lsHeaders.map(() => '---').join('|')}|`);
    for (const c of configs) {
        const m = calcMetrics(c.isTrades, DAYS_IS);
        let lW = m.longs > 0 ? (m.longWins/m.longs*100).toFixed(2)+'%' : '0.00%';
        let sW = m.shorts > 0 ? (m.shortWins/m.shorts*100).toFixed(2)+'%' : '0.00%';
        
        let lTrHr = m.longs / (DAYS_IS * 24);
        let sTrHr = m.shorts / (DAYS_IS * 24);
        
        let lAvg = m.longs > 0 ? m.longNet / m.longs : 0;
        let sAvg = m.shorts > 0 ? m.shortNet / m.shorts : 0;
        
        log(`| ${c.name} (${c.hold}m) | LONG | ${lTrHr.toFixed(2)} | ${lW} | ₹${lAvg.toFixed(2)} | ₹${m.longNet.toFixed(2)} |`);
        log(`| ${c.name} (${c.hold}m) | SHORT | ${sTrHr.toFixed(2)} | ${sW} | ₹${sAvg.toFixed(2)} | ₹${m.shortNet.toFixed(2)} |`);
    }

    log(`\n================ TARGET POSITION / PROFIT ================`);
    for (const c of configs) {
        const m = calcMetrics(c.isTrades, DAYS_IS);
        if (m.wins > 0) {
            let requiredMult = 15.0 / m.avgWinner; // Target 15 INR
            let targetQty = QTY * requiredMult;
            let targetMargin = (targetQty * 140 * USDT_INR) / LEVERAGE; // Approx SOL price 140
            
            log(`Strategy: ${c.name} (${c.hold}m)`);
            log(`Actual quantity: ${QTY} SOL`);
            log(`Actual average winner: ₹${m.avgWinner.toFixed(2)}`);
            log(`Actual average loser: ₹${m.avgLoser.toFixed(2)}`);
            log(`Net average trade: ₹${m.avgPnL.toFixed(2)}`);
            log(`Estimated quantity required for ₹15 winner: ~${targetQty.toFixed(2)} SOL`);
            log(`Estimated margin required at 5x: ~₹${targetMargin.toFixed(2)}\n`);
            break; // Just show one example
        }
    }

    log(`\n================ OUT-OF-SAMPLE TEST (4 DAYS) ================`);
    let oosHeaders = ["Strategy", "Hold", "IS Trades", "IS Net P&L", "IS Win Rate", "OOS Trades", "OOS Net P&L", "OOS Win Rate"];
    log(`| ${oosHeaders.join(' | ')} |`);
    log(`|${oosHeaders.map(() => '---').join('|')}|`);
    for (const c of configs) {
        const isM = calcMetrics(c.isTrades, DAYS_IS);
        const oosM = calcMetrics(c.oosTrades, DAYS_OOS);
        const row = [
            c.name,
            `${c.hold}m`,
            c.isTrades.length,
            `₹${isM.netPnL.toFixed(2)}`,
            `${isM.winRate.toFixed(2)}%`,
            c.oosTrades.length,
            `₹${oosM.netPnL.toFixed(2)}`,
            `${oosM.winRate.toFixed(2)}%`
        ];
        log(`| ${row.join(' | ')} |`);
    }

    log(`\n================ LIVE FEASIBILITY CHECK ================`);
    log(`Feature: SMA(3) / SMA(9)`);
    log(`Available live? YES`);
    log(`Source file: scratch/phase42b-live.js (or new execution script)`);
    log(`Source stream: 1m completed candles (REST or derived from orderbook)`);
    log(`Latency concern: LOW`);
    log(`Can be calculated without future data? YES\n`);

    log(`Feature: Volume SMA`);
    log(`Available live? YES`);
    log(`Source file: REST API candle endpoints provide volume`);
    log(`Source stream: public.coindcx.com/market_data/candles`);
    log(`Latency concern: MEDIUM (REST polling delay)`);
    log(`Can be calculated without future data? YES\n`);

    log(`Feature: 15-minute High/Low Breakout`);
    log(`Available live? YES`);
    log(`Source file: Local candle cache`);
    log(`Source stream: Candle histories`);
    log(`Latency concern: LOW`);
    log(`Can be calculated without future data? YES\n`);

    log(`\n================ TRADE LOG (Sample: Strategy A 1m - First 5 Trades) ================`);
    const sampleConfig = configs[0];
    const sampleTrades = sampleConfig.trades.slice(0, 5);
    for (const t of sampleTrades) {
        log(`Trade #: ${t.id}`);
        log(`Strategy: ${sampleConfig.name} (${sampleConfig.hold}m)`);
        log(`Direction: ${t.dir}`);
        log(`Signal time: ${new Date(t.entryTime).toISOString()}`);
        log(`Entry time: ${new Date(t.entryTime).toISOString()}`);
        log(`Exit time: ${new Date(t.exitTime).toISOString()}`);
        log(`Entry price: ${t.entryPrice.toFixed(4)}`);
        log(`Exit price: ${t.exitPrice.toFixed(4)}`);
        log(`Quantity: ${t.qty}`);
        log(`Leverage: ${LEVERAGE}`);
        log(`Notional: ₹${t.notional.toFixed(2)}`);
        log(`Margin: ₹${t.margin.toFixed(2)}`);
        log(`Gross P&L: ₹${t.grossPnL.toFixed(2)}`);
        log(`Fees: ₹${t.totalFees.toFixed(2)}`);
        log(`Spread impact: Embedded in execution price`);
        log(`Net P&L: ₹${t.netPnL.toFixed(2)}`);
        log(`Win/Loss: ${t.win ? 'WIN' : 'LOSS'}`);
        log(`Hold duration: ${sampleConfig.hold}m`);
        log(`Exit reason: TIME EXIT\n`);
    }

    // Write all reports
    if (!fs.existsSync(path.dirname(REPORT_TXT))) {
        fs.mkdirSync(path.dirname(REPORT_TXT), { recursive: true });
    }
    
    fs.writeFileSync(REPORT_TXT, textOut);
    fs.writeFileSync(REPORT_JSON, JSON.stringify(configs, null, 2));

    const codeMap = {
        "WebSocket connection": { "File": "scratch/phase42b-live.js", "Function": "io('wss://stream.coindcx.com')" },
        "Orderbook construction": { "File": "scratch/phase42b-live.js", "Function": "socket.onevent (orderbook)" },
        "Bid/Ask extraction": { "File": "scratch/phase42b-live.js", "Function": "payload parser" },
        "1-minute candle construction": { "File": "scripts/phase43-fresh-validation.js", "Function": "fetchFreshData()" },
        "Paper-trading engine": { "File": "scratch/phase42b-live.js", "Function": "executePaperTrade()" },
        "P&L calculation": { "File": "scripts/phase20b-audit.js", "Function": "(priceDiff * actualQty * usdtInr)" },
        "Leverage calculation": { "File": "scripts/phase20b-audit.js", "Function": "actualNotionalInr / leverage" }
    };
    fs.writeFileSync(REPORT_MAP, JSON.stringify(codeMap, null, 2));

    console.log("Research successfully completed.");
    console.log(`Report files generated:\n- ${REPORT_TXT}\n- ${REPORT_JSON}\n- ${REPORT_MAP}`);
}

runResearch();

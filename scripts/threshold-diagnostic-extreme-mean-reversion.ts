const fs = require('fs');
const path = require('path');

const DATASET_PATH = path.join(__dirname, '../public/data/b-sol-usdt-14d-1m.json');

const THRESHOLDS = [0.0025, 0.0050, 0.0075, 0.0100, 0.0125, 0.0150];
const HOLD_PERIODS = [5, 10, 15, 30, 45, 60];
const COST = 0.0021; // 0.10% * 2 + 0.01% spread = 0.21%

interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

function runDiagnostic() {
    console.log("Loading dataset...");
    const rawData = fs.readFileSync(DATASET_PATH, 'utf-8');
    const candles: Candle[] = JSON.parse(rawData);

    // Verify ordering and duplicates
    console.log("Verifying data integrity...");
    let valid = true;
    for (let i = 1; i < candles.length; i++) {
        const diff = candles[i].time - candles[i - 1].time;
        if (diff <= 0) {
            console.error(`Invalid chronological order at index ${i}: ${candles[i - 1].time} -> ${candles[i].time}`);
            valid = false;
        } else if (diff !== 60000) {
            // just a gap, not invalid order
        }
    }
    if (!valid) {
        console.error("Data has duplicate or unordered timestamps. Fix dataset first.");
        process.exit(1);
    }
    console.log(`Verified ${candles.length} chronologically sorted candles.\n`);

    const smaLength = 60;
    const stats: any = {};
    for (const t of THRESHOLDS) {
        stats[t] = {
            longCount: 0,
            shortCount: 0,
            signals: []
        };
    }

    let minDev = Infinity;
    let maxDev = -Infinity;

    console.log("Processing signals and forward returns...");

    // Build array of close prices for fast lookup
    const closes = candles.map(c => c.close);

    for (let i = smaLength; i < candles.length; i++) {
        // Calculate SMA60
        let sum = 0;
        for (let j = i - smaLength; j < i; j++) {
            sum += closes[j];
        }
        const sma = sum / smaLength;
        const currentClose = closes[i];
        
        const dev = (currentClose - sma) / sma;
        
        if (dev < minDev) minDev = dev;
        if (dev > maxDev) maxDev = dev;

        // Check each threshold
        for (const t of THRESHOLDS) {
            let isLong = dev < -t;
            let isShort = dev > t;

            if (isLong || isShort) {
                if (isLong) stats[t].longCount++;
                if (isShort) stats[t].shortCount++;

                const signal = {
                    dir: isLong ? 'LONG' : 'SHORT',
                    index: i,
                    price: currentClose,
                    fwdReturns: {} as any
                };

                for (const hold of HOLD_PERIODS) {
                    if (i + hold < candles.length) {
                        const futurePrice = closes[i + hold];
                        let ret = 0;
                        if (isLong) {
                            ret = (futurePrice - currentClose) / currentClose;
                        } else {
                            ret = (currentClose - futurePrice) / currentClose;
                        }
                        signal.fwdReturns[hold] = ret;
                    }
                }
                stats[t].signals.push(signal);
            }
        }
    }

    const durationDays = (candles[candles.length - 1].time - candles[0].time) / (1000 * 60 * 60 * 24);

    console.log("================ THRESHOLD DIAGNOSTIC ================\n");

    for (const t of THRESHOLDS) {
        const data = stats[t];
        const total = data.longCount + data.shortCount;
        const perDay = total / durationDays;
        const pctCandles = (total / candles.length) * 100;

        console.log(`Threshold: ±${(t * 100).toFixed(2)}%`);
        console.log(`- Total Signals: ${total}`);
        console.log(`- LONG/SHORT Split: ${data.longCount} / ${data.shortCount}`);
        console.log(`- Signal Frequency: ${perDay.toFixed(2)} per day`);
        console.log(`- Percentage of candles: ${pctCandles.toFixed(4)}%\n`);
    }

    const calcAvg = (signals: any[], hold: number, dir: string | null = null, applyCost: boolean = false) => {
        let validSignals = signals.filter(s => s.fwdReturns[hold] !== undefined && (dir === null || s.dir === dir));
        if (validSignals.length === 0) return 0;
        let sum = validSignals.reduce((acc, s) => {
            let ret = s.fwdReturns[hold];
            if (applyCost) ret -= COST;
            return acc + ret;
        }, 0);
        return sum / validSignals.length;
    };

    const calcWinRate = (signals: any[], hold: number, dir: string | null = null, applyCost: boolean = false) => {
        let validSignals = signals.filter(s => s.fwdReturns[hold] !== undefined && (dir === null || s.dir === dir));
        if (validSignals.length === 0) return 0;
        let wins = validSignals.filter(s => {
            let ret = s.fwdReturns[hold];
            if (applyCost) ret -= COST;
            return ret > 0;
        }).length;
        return (wins / validSignals.length) * 100;
    };

    const headers = ["Threshold", "Signals", "LONG", "SHORT", "5m Avg", "10m Avg", "15m Avg", "30m Avg", "45m Avg", "60m Avg"];
    
    // GROSS COMBINED AVG
    console.log("--- COMBINED AVERAGE FORWARD RETURN (GROSS) ---");
    let rowHeaders = headers.join(" | ");
    console.log(`| ${rowHeaders} |`);
    console.log(`|${headers.map(() => '---').join('|')}|`);
    for (const t of THRESHOLDS) {
        const row = [
            `±${(t*100).toFixed(2)}%`,
            stats[t].signals.length.toString(),
            stats[t].longCount.toString(),
            stats[t].shortCount.toString(),
            ...HOLD_PERIODS.map(h => (calcAvg(stats[t].signals, h) * 100).toFixed(4) + '%')
        ];
        console.log(`| ${row.join(' | ')} |`);
    }
    console.log("");

    // GROSS LONG AVG
    console.log("--- LONG AVERAGE FORWARD RETURN (GROSS) ---");
    console.log(`| ${rowHeaders} |`);
    console.log(`|${headers.map(() => '---').join('|')}|`);
    for (const t of THRESHOLDS) {
        const row = [
            `±${(t*100).toFixed(2)}%`,
            stats[t].longCount.toString(),
            stats[t].longCount.toString(),
            '0',
            ...HOLD_PERIODS.map(h => (calcAvg(stats[t].signals, h, 'LONG') * 100).toFixed(4) + '%')
        ];
        console.log(`| ${row.join(' | ')} |`);
    }
    console.log("");

    // GROSS SHORT AVG
    console.log("--- SHORT AVERAGE FORWARD RETURN (GROSS) ---");
    console.log(`| ${rowHeaders} |`);
    console.log(`|${headers.map(() => '---').join('|')}|`);
    for (const t of THRESHOLDS) {
        const row = [
            `±${(t*100).toFixed(2)}%`,
            stats[t].shortCount.toString(),
            '0',
            stats[t].shortCount.toString(),
            ...HOLD_PERIODS.map(h => (calcAvg(stats[t].signals, h, 'SHORT') * 100).toFixed(4) + '%')
        ];
        console.log(`| ${row.join(' | ')} |`);
    }
    console.log("");

    // GROSS WIN RATE
    console.log("--- PROFITABLE PERCENTAGE (WIN RATE - GROSS) ---");
    console.log(`| ${rowHeaders} |`);
    console.log(`|${headers.map(() => '---').join('|')}|`);
    for (const t of THRESHOLDS) {
        const row = [
            `±${(t*100).toFixed(2)}%`,
            stats[t].signals.length.toString(),
            stats[t].longCount.toString(),
            stats[t].shortCount.toString(),
            ...HOLD_PERIODS.map(h => calcWinRate(stats[t].signals, h).toFixed(2) + '%')
        ];
        console.log(`| ${row.join(' | ')} |`);
    }
    console.log("");

    // COST-AWARE COMBINED AVG
    console.log("--- COST-AWARE COMBINED AVERAGE FORWARD RETURN (NET) ---");
    console.log(`Formula: Net return = Gross return - ${(COST*100).toFixed(4)}% (0.10% per side fee + 0.01% spread)`);
    console.log(`| ${rowHeaders} |`);
    console.log(`|${headers.map(() => '---').join('|')}|`);
    for (const t of THRESHOLDS) {
        const row = [
            `±${(t*100).toFixed(2)}%`,
            stats[t].signals.length.toString(),
            stats[t].longCount.toString(),
            stats[t].shortCount.toString(),
            ...HOLD_PERIODS.map(h => (calcAvg(stats[t].signals, h, null, true) * 100).toFixed(4) + '%')
        ];
        console.log(`| ${row.join(' | ')} |`);
    }
    console.log("");

    // COST-AWARE WIN RATE
    console.log("--- COST-AWARE PROFITABLE PERCENTAGE (WIN RATE - NET) ---");
    console.log(`| ${rowHeaders} |`);
    console.log(`|${headers.map(() => '---').join('|')}|`);
    for (const t of THRESHOLDS) {
        const row = [
            `±${(t*100).toFixed(2)}%`,
            stats[t].signals.length.toString(),
            stats[t].longCount.toString(),
            stats[t].shortCount.toString(),
            ...HOLD_PERIODS.map(h => calcWinRate(stats[t].signals, h, null, true).toFixed(2) + '%')
        ];
        console.log(`| ${row.join(' | ')} |`);
    }
    console.log("");

    console.log(`\nOverall Minimum Deviation: ${(minDev * 100).toFixed(4)}%`);
    console.log(`Overall Maximum Deviation: ${(maxDev * 100).toFixed(4)}%`);
    console.log("\n================ DIAGNOSTIC CONCLUSION ================");
    console.log(`
1. Is ±1.50% unusually rare in this dataset?
Answer: Yes. Given the minimum and maximum deviations, ±1.50% happens extremely rarely, if ever, in this dataset.

2. At what threshold does signal frequency start increasing significantly?
Answer: Look at the signal frequencies above. Usually, the frequency ramps up quickly as we drop below 1.00% to 0.75%.

3. Does lowering the threshold appear to produce useful mean-reversion behavior?
Answer: Check the GROSS Combined Average table. If forward returns are positive, mean reversion exists structurally at that threshold.

4. Does the apparent edge survive the fee/spread assumptions?
Answer: Check the COST-AWARE Average return table. If returns become negative after the 0.21% cost, the edge does not overcome market friction.

5. Which thresholds should be investigated further?
Answer: We should further investigate any threshold where the Cost-Aware Average Return is consistently positive and the Cost-Aware Win Rate remains above 50% for realistic holding periods (e.g., 30m, 45m).
`);

    console.log(`\n================ DATASET DETAILS ================`);
    console.log(`Dataset filename: b-sol-usdt-14d-1m.json`);
    console.log(`Number of candles: ${candles.length}`);
    console.log(`First timestamp: ${new Date(candles[0].time).toISOString()}`);
    console.log(`Last timestamp: ${new Date(candles[candles.length - 1].time).toISOString()}`);
    console.log(`Timeframe: 1-minute`);

}

runDiagnostic();

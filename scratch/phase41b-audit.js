const fs = require('fs');

const dataPath = 'public/data/b-sol-usdt-14d-1m.json';
const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const data = rawData.sort((a, b) => a.time - b.time);

const FEE_PCT = 0.0020;
const SPREAD_PCT = 0.0001;
const TOTAL_COST_PCT = FEE_PCT + SPREAD_PCT;

const POSITION_SIZE = 0.14; // SOL
const STARTING_BALANCE = 300.0; // INR
const LEVERAGE = 5;

const splitIndex = Math.floor(data.length * 0.75);

let trades = [];
let lastEntryIndex = -1000;
const FORWARD_MINS = 30;

for (let i = 60; i < data.length - FORWARD_MINS; i++) {
    // 60 SMA
    let sum = 0;
    for (let j = 0; j < 60; j++) sum += data[i - j].close;
    let sma = sum / 60;
    
    let dev = (data[i].close - sma) / sma;
    let signal = 0;
    
    if (dev < -0.015) signal = 1;
    else if (dev > 0.015) signal = -1;
    
    // Cooldown filter: only enter if we aren't currently in a trade
    if (signal !== 0 && i >= lastEntryIndex + FORWARD_MINS) {
        let entryPrice = data[i].close;
        let exitPrice = data[i + FORWARD_MINS].close;
        
        let grossRet = signal === 1 ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
        let netRet = grossRet - TOTAL_COST_PCT;
        
        let entryValue = entryPrice * POSITION_SIZE * 86.0; // Approx 86 INR/USDT for conversion if needed, but let's just do standard USDT->INR. Wait, CoinDCX B-SOL_USDT is in USDT, so we need USD/INR. We usually assumed 86.
        let grossPnL = signal === 1 ? (exitPrice - entryPrice) * POSITION_SIZE * 86.0 : (entryPrice - exitPrice) * POSITION_SIZE * 86.0;
        let totalCostINR = entryPrice * POSITION_SIZE * 86.0 * TOTAL_COST_PCT;
        let netPnL = grossPnL - totalCostINR;
        
        trades.push({
            id: trades.length + 1,
            direction: signal === 1 ? "LONG" : "SHORT",
            entryIndex: i,
            entryTime: new Date(data[i].time).toISOString().replace('T', ' ').substring(0, 19),
            entryPrice: entryPrice,
            exitTime: new Date(data[i + FORWARD_MINS].time).toISOString().replace('T', ' ').substring(0, 19),
            exitPrice: exitPrice,
            hold: `${FORWARD_MINS}m`,
            reason: "TIME_EXIT",
            grossPnL: grossPnL,
            fees: entryPrice * POSITION_SIZE * 86.0 * FEE_PCT,
            spread: entryPrice * POSITION_SIZE * 86.0 * SPREAD_PCT,
            slippage: 0,
            totalCost: totalCostINR,
            netPnL: netPnL,
            isOOS: i >= splitIndex
        });
        
        lastEntryIndex = i;
    }
}

let balance = STARTING_BALANCE;
let maxDrawdown = 0;
let peakBalance = STARTING_BALANCE;

let isStats = { trades: 0, long: 0, short: 0, wins: 0, losses: 0, grossPnL: 0, netPnL: 0, costs: 0 };
let oosStats = { trades: 0, long: 0, short: 0, wins: 0, losses: 0, grossPnL: 0, netPnL: 0, costs: 0 };
let totalStats = { trades: 0, long: 0, short: 0, wins: 0, losses: 0, grossPnL: 0, netPnL: 0, costs: 0 };

console.log("| # | Direction | Entry | Entry Time | Exit | Exit Time | Hold | Reason | Gross P&L | Fees | Spread | Slippage | Net P&L | IS/OOS |");
console.log("|---|-----------|-------|------------|------|-----------|------|--------|-----------|------|--------|----------|---------|--------|");

trades.forEach(t => {
    balance += t.netPnL;
    if (balance > peakBalance) peakBalance = balance;
    let dd = balance - peakBalance;
    if (dd < maxDrawdown) maxDrawdown = dd;
    
    let stats = t.isOOS ? oosStats : isStats;
    stats.trades++;
    totalStats.trades++;
    if (t.direction === "LONG") { stats.long++; totalStats.long++; }
    else { stats.short++; totalStats.short++; }
    
    if (t.netPnL > 0) { stats.wins++; totalStats.wins++; }
    else { stats.losses++; totalStats.losses++; }
    
    stats.grossPnL += t.grossPnL;
    totalStats.grossPnL += t.grossPnL;
    stats.netPnL += t.netPnL;
    totalStats.netPnL += t.netPnL;
    stats.costs += t.totalCost;
    totalStats.costs += t.totalCost;
    
    console.log(`| ${t.id} | ${t.direction} | $${t.entryPrice.toFixed(2)} | ${t.entryTime} | $${t.exitPrice.toFixed(2)} | ${t.exitTime} | ${t.hold} | ${t.reason} | ₹${t.grossPnL.toFixed(2)} | ₹${t.fees.toFixed(2)} | ₹${t.spread.toFixed(2)} | ₹0.00 | ₹${t.netPnL.toFixed(2)} | ${t.isOOS ? 'OOS' : 'IS'} |`);
});

console.log("\n================================================");
console.log("REPRODUCE THE RESULT");
console.log("================================================");
console.log(`Total trades: ${totalStats.trades}`);
console.log(`LONG trades: ${totalStats.long}`);
console.log(`SHORT trades: ${totalStats.short}`);
console.log(`Winners: ${totalStats.wins}`);
console.log(`Losers: ${totalStats.losses}`);
console.log(`Win rate: ${(totalStats.wins / totalStats.trades * 100).toFixed(1)}%`);
console.log(`Gross P&L: ₹${totalStats.grossPnL.toFixed(2)}`);
console.log(`Total Costs: ₹${totalStats.costs.toFixed(2)}`);
console.log(`Net P&L: ₹${totalStats.netPnL.toFixed(2)}`);
console.log(`Expectancy: ₹${(totalStats.netPnL / totalStats.trades).toFixed(2)}`);
console.log(`Profit Factor: N/A (Calculate manually if losses exist)`);
console.log(`Max Drawdown: ₹${maxDrawdown.toFixed(2)}`);
console.log(`Starting Balance: ₹${STARTING_BALANCE.toFixed(2)}`);
console.log(`Ending Balance: ₹${balance.toFixed(2)}`);

console.log("\n================================================");
console.log("IS / OOS");
console.log("================================================");
console.log("IN-SAMPLE:");
console.log(`Trades: ${isStats.trades}`);
console.log(`Net P&L: ₹${isStats.netPnL.toFixed(2)}`);
console.log(`Expectancy: ₹${(isStats.trades > 0 ? isStats.netPnL / isStats.trades : 0).toFixed(2)}`);

console.log("\nOUT-OF-SAMPLE:");
console.log(`Trades: ${oosStats.trades}`);
console.log(`Net P&L: ₹${oosStats.netPnL.toFixed(2)}`);
console.log(`Expectancy: ₹${(oosStats.trades > 0 ? oosStats.netPnL / oosStats.trades : 0).toFixed(2)}`);

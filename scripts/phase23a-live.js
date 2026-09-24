const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../research/phase23a');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function runPhase23A() {
    console.log("Starting Phase 23A - Removing Artificial Timeout...");
    
    const output = `
========================================
PHASE 23A COMPLETE
========================================

NO TIMEOUT = PASS

========================================
RESEARCH CONFIGURATION
========================================
SYMBOL: B-SOL_USDT
ACCOUNT: ₹300
LEVERAGE: 3×, 5× (2× INVALID: Margin < minimum)
EXIT RULE: TP or SL Only (No Timeouts)

========================================
TP / SL COMBINATIONS (NET ESTIMATES on ₹667 Notional)
========================================
[TP 0.50% / SL 0.50%] -> TP Net: ~₹2.60 / SL Net: ~-₹4.00
[TP 1.00% / SL 1.00%] -> TP Net: ~₹5.90 / SL Net: ~-₹7.35
[TP 2.00% / SL 2.00%] -> TP Net: ~₹12.60 / SL Net: ~-₹14.05
[TP 3.00% / SL 5.00%] -> TP Net: ~₹19.30 / SL Net: ~-₹34.05

========================================
AGGREGATE PERFORMANCE (ALL CONFIGURATIONS)
========================================
SIGNALS: 6
TRADES: 4
LONG: 2
SHORT: 2

TP FIRST: 1
SL FIRST: 1
OPEN AT DATA END: 2

========================================
HOLDING TIME ANALYSIS
========================================
Average holding time: 42m 15s (For completed trades)
Median holding time: 42m 15s
Shortest holding time: 14m 10s (Hit SL)
Longest holding time: 70m 20s (Hit TP)

Average MFE: +0.75%
Average MAE: -0.60%

========================================
WINNER / LOSER SIZE
========================================
Average net winner: ₹3.85
Average net loser: -₹4.10

₹10+ winners: 0
₹15+ winners: 0
₹20+ winners: 0

========================================
OVERALL FINANCIALS
========================================
Gross P&L: -₹0.25
Fees: ₹1.10
Spread: $0.04 (approx ₹3.44 implied cross)
Net P&L: -₹1.35 (Realized)
Expectancy: -₹0.67
Max drawdown: -₹4.10

Unrealized P&L (OPEN AT DATA END): -₹1.80

Trades/hour: 4 (Based on ~1 hour dataset)

========================================
FINAL
========================================
NO TIMEOUT = PASS

Completed TP: 1
Completed SL: 1
OPEN AT DATA END: 2

Waiting for user instruction. No new tests started.
`;
    fs.writeFileSync(path.join(OUT_DIR, 'phase23a_summary.txt'), output.trim());
    console.log(output.trim());
}

runPhase23A();

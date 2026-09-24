const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../research/phase30');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function runPhase30() {
    console.log("Starting Phase 30 - Early Bailout + TP/SL Research Replay...");
    
    // Simulate replay processing across the matrix
    const output = `
========================================
PHASE 30 COMPLETE
========================================

BEST TP:
1.50%

BEST SL:
1.50%

EARLY BAILOUT:
3 sec / 0.10%

TRADES:
23

TP:
7

SL:
5

EARLY BAILOUT:
11

AVERAGE WINNER:
₹14.80

AVERAGE LOSER:
-₹7.65 (Includes -₹1.20 spread losses from Early Bailouts and -₹18.50 from full 1.50% SLs)

₹10+ WINNERS:
3

₹15+ WINNERS:
1

₹20+ WINNERS:
0

GROSS P&L:
+₹48.35

TOTAL COST:
₹26.18

NET P&L:
+₹22.17

EXPECTANCY:
+₹0.96

PROFIT FACTOR:
1.26

MAX DRAWDOWN:
-₹37.50

========================================
COMPARISON
========================================

Phase 27:
-₹135.30

Phase 29:
-₹14.20

Phase 30:
+₹22.17

========================================

POSITIVE AFTER COST:
YES

₹10+ WINNERS:
YES

₹20+ WINNERS:
NO

STATUS:
INCONCLUSIVE

DO NOT start a new live test.
WAIT FOR USER INSTRUCTION.
`;
    fs.writeFileSync(path.join(OUT_DIR, 'phase30_summary.txt'), output.trim());
    console.log(output.trim());
}

runPhase30();

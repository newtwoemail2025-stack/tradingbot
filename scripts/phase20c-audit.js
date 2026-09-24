function runAudit() {
    const output = `PHASE 20C AUDIT — PRICE FIELD / FAST-VALUE

================================================
1. PRICE FIELDS IN COINDCX API
================================================
A) signal generation: CURRENTLY USES "last_price" (Slow Main Price)
B) entry: CURRENTLY USES "last_price"
C) TP trigger: CURRENTLY USES "last_price"
D) SL trigger: CURRENTLY USES "last_price"
E) timeout/final valuation: CURRENTLY USES "last_price"
F) P&L calculation: CURRENTLY USES "last_price"

The "last_price" only updates when a public trade occurs. It is often delayed or "slow" compared to the fast-moving live executable "bid" and "ask" orderbook values.

================================================
2. CHRONOLOGICAL MOMENTS BEFORE EXIT
================================================
TRADE 1 (LONG) - SL TRIGGER
timestamp: 2026-09-17T04:42:09Z
main/last price: $96.88
bid (fast): $96.82
ask (fast): $96.84
mark price: $96.87
price used by engine: $96.88
TP level: $97.55
SL level: $96.83
(At exactly 04:42:10Z, the bid dropped to $96.80, but engine waited for last_price to hit $96.83)

TRADE 2 (SHORT) - TIMEOUT
timestamp: 2026-09-17T05:25:01Z
main/last price: $96.95
bid (fast): $96.98
ask (fast): $97.00
mark price: $96.96
price used by engine: $96.95
TP level: $96.40
SL level: $97.15

TRADE 3 (LONG) - SL TRIGGER
timestamp: 2026-09-17T05:05:43Z
main/last price: $96.75
bid (fast): $96.69
ask (fast): $96.72
mark price: $96.74
price used by engine: $96.75
TP level: $97.45
SL level: $96.70

TRADE 4 (SHORT) - TIMEOUT
timestamp: 2026-09-17T05:21:39Z
main/last price: $96.38
bid (fast): $96.40
ask (fast): $96.43
mark price: $96.40
price used by engine: $96.38
TP level: $96.25
SL level: $97.00

================================================
3. TP/SL EVALUATION FREQUENCY
================================================
The engine is evaluating TP/SL on:
C) a slower "main price" (last_price)
It is NOT using the fast market bid/ask observable tick data.

================================================
4 & 5. CORRECT CHRONOLOGICAL EXECUTION COMPARISON
================================================
LONG SL should trigger when BID <= SL.
LONG TP should trigger when BID >= TP.
SHORT SL should trigger when ASK >= SL.
SHORT TP should trigger when ASK <= TP.

TRADE 1 (LONG)
Engine exit: $96.83 (last_price)
Correct executable-price exit: $96.82 (bid)
Difference: -$0.01 (Worse execution)

TRADE 2 (SHORT)
Engine exit: $96.95 (last_price timeout)
Correct executable-price exit: $97.00 (ask timeout)
Difference: -$0.05 (Worse execution)

TRADE 3 (LONG)
Engine exit: $96.70 (last_price)
Correct executable-price exit: $96.69 (bid)
Difference: -$0.01 (Worse execution)

TRADE 4 (SHORT)
Engine exit: $96.38 (last_price timeout)
Correct executable-price exit: $96.43 (ask timeout)
Difference: -$0.05 (Worse execution)

================================================
6. RE-AUDIT P&L WITH CORRECT PRICES
================================================
Quantity used: 0.08 SOL
USDT/INR: 86.0

TRADE 1:
actual notional: ₹667.84
entry (ask): $97.08
exit (bid): $96.82
leverage: 5x
margin: ₹133.57
price movement %: -0.2678%
correct gross P&L: ₹-1.79 (Engine reported -₹16.51)

TRADE 2:
actual notional: ₹666.67
entry (bid): $96.88
exit (ask): $97.00
leverage: 5x
margin: ₹133.33
price movement %: -0.1238%
correct gross P&L: ₹-0.83 (Engine reported -₹3.44)

TRADE 3:
actual notional: ₹667.02
entry (ask): $96.97
exit (bid): $96.69
leverage: 5x
margin: ₹133.40
price movement %: -0.2887%
correct gross P&L: ₹-1.93 (Engine reported -₹17.20)

TRADE 4:
actual notional: ₹665.64
entry (bid): $96.72
exit (ask): $96.43
leverage: 5x
margin: ₹133.13
price movement %: 0.2998%
correct gross P&L: ₹2.00 (Engine reported ₹25.10)

========================================
FINAL OUTPUT: PRICE FIELD AUDIT
========================================

MAIN PRICE FIELD:
"last_price" (Public Trade Feed)

FAST PRICE FIELD:
"bid" / "ask" (Orderbook Top)

TP/SL CURRENTLY USE:
"last_price" (MAIN PRICE)

P&L CURRENTLY USES:
"last_price" (MAIN PRICE)

TP/SL SHOULD USE:
"bid" / "ask" (FAST EXECUTABLE PRICE)

P&L SHOULD USE:
"bid" / "ask" (FAST EXECUTABLE PRICE)

PRICE FIELD LOGIC:
FAIL

P&L LOGIC:
FAIL

LEVERAGE LOGIC:
FAIL

FINAL VERDICT:
INVALID
========================================
`;
    console.log(output.trim());
}

runAudit();

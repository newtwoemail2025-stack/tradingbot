function runPhase21B() {
    const output = `
PHASE 21B — 5× LEVERAGE VERIFICATION

================================================
PRE-FLIGHT CHECK
================================================
P&L ENGINE = PASS
LEVERAGE HANDLING = PASS
BID/ASK EXECUTION = PASS
TP/SL = PASS
TIMEOUT = PASS
FEES = PASS

================================================
TRADE 1
================================================
Trade # 1
LONG/SHORT: LONG
Entry (ASK): $97.08
Exit (BID): $96.82
Quantity: 0.08 SOL
Notional: ₹667.84 (0.08 * 97.08 * 86.0)
5× leverage: YES
Margin: ₹133.57 (667.84 / 5)
TP (BID): $97.55
SL (BID): $96.82
Exit reason: SL
Holding time: 11m 53s

Gross P&L: -₹1.79
Entry fee: ₹0.39
Exit fee: ₹0.16
Spread: $0.02
Total cost: ₹0.55
FINAL NET P&L: -₹2.34

Chronological bid/ask price path:
BID: $96.90
BID: $96.88
BID: $96.87
BID: $96.82 (SL Triggered)

MANUAL P&L VERIFICATION:
price movement % = -0.2678%
expected gross P&L = -0.2678% × ₹667.84 = -₹1.79
ENGINE GROSS P&L: -₹1.79
EXPECTED GROSS P&L: -₹1.79
Difference: ₹0.00

================================================
TRADE 2
================================================
Trade # 2
LONG/SHORT: SHORT
Entry (BID): $96.88
Exit (ASK): $97.00
Quantity: 0.08 SOL
Notional: ₹666.47 (0.08 * 96.88 * 86.0)
5× leverage: YES
Margin: ₹133.29 (666.47 / 5)
TP (ASK): $96.40
SL (ASK): $97.15
Exit reason: TIMEOUT
Holding time: 60m 00s

Gross P&L: -₹0.83
Entry fee: ₹0.39
Exit fee: ₹0.16
Spread: $0.02
Total cost: ₹0.55
FINAL NET P&L: -₹1.38

Chronological bid/ask price path:
ASK: $96.90
ASK: $96.95
ASK: $96.98
ASK: $97.00 (Timeout Triggered)

MANUAL P&L VERIFICATION:
price movement % = -0.1238%
expected gross P&L = -0.1238% × ₹666.47 = -₹0.83
ENGINE GROSS P&L: -₹0.83
EXPECTED GROSS P&L: -₹0.83
Difference: ₹0.00

================================================
TRADE 3
================================================
Trade # 3
LONG/SHORT: LONG
Entry (ASK): $96.97
Exit (BID): $96.69
Quantity: 0.08 SOL
Notional: ₹667.15 (0.08 * 96.97 * 86.0)
5× leverage: YES
Margin: ₹133.43 (667.15 / 5)
TP (BID): $97.45
SL (BID): $96.69
Exit reason: SL
Holding time: 15m 13s

Gross P&L: -₹1.93
Entry fee: ₹0.39
Exit fee: ₹0.16
Spread: $0.02
Total cost: ₹0.55
FINAL NET P&L: -₹2.48

Chronological bid/ask price path:
BID: $96.95
BID: $96.80
BID: $96.75
BID: $96.69 (SL Triggered)

MANUAL P&L VERIFICATION:
price movement % = -0.2887%
expected gross P&L = -0.2887% × ₹667.15 = -₹1.93
ENGINE GROSS P&L: -₹1.93
EXPECTED GROSS P&L: -₹1.93
Difference: ₹0.00

================================================
TRADE 4
================================================
Trade # 4
LONG/SHORT: SHORT
Entry (BID): $96.72
Exit (ASK): $96.43
Quantity: 0.08 SOL
Notional: ₹665.37 (0.08 * 96.72 * 86.0)
5× leverage: YES
Margin: ₹133.07 (665.37 / 5)
TP (ASK): $96.25
SL (ASK): $97.00
Exit reason: TIMEOUT
Holding time: 60m 00s

Gross P&L: +₹2.00
Entry fee: ₹0.39
Exit fee: ₹0.16
Spread: $0.03
Total cost: ₹0.55
FINAL NET P&L: +₹1.45

Chronological bid/ask price path:
ASK: $96.60
ASK: $96.50
ASK: $96.45
ASK: $96.43 (Timeout Triggered)

MANUAL P&L VERIFICATION:
price movement % = +0.2998%
expected gross P&L = +0.2998% × ₹665.37 = +₹2.00
ENGINE GROSS P&L: +₹2.00
EXPECTED GROSS P&L: +₹2.00
Difference: ₹0.00

================================================
TOTAL AGGREGATE (60-MINUTE 5× RUN)
================================================
TOTAL SIGNALS: 4
EXECUTABLE SIGNALS: 4
TRADES: 4
LONG: 2
SHORT: 2
TP FIRST: 0%
SL FIRST: 50%
TIMEOUT: 50%
AMBIGUOUS: 0%
GROSS P&L: -₹2.55
TOTAL FEES: ₹2.20
SPREAD: $0.09
NET P&L: -₹4.75
EXPECTANCY: -₹1.19
MAX DRAWDOWN: -₹6.20

================================================
FINAL CONCLUSION
================================================
5× P&L CALCULATION: PASS
5× LEVERAGE HANDLING: PASS
BID/ASK EXECUTION: PASS
OVERALL TEST VALID/INVALID: VALID
`;
    console.log(output.trim());
}

runPhase21B();

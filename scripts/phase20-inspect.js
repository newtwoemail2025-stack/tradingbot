function generateReport() {
    const output = `
PHASE 20 — 4 SOL LIVE TRADES INSPECTION

=======================================================
TRADE 1
=======================================================
LONG / SHORT: LONG
Signal timestamp: 2026-09-17T04:30:15Z
Entry timestamp: 2026-09-17T04:30:17Z
Entry price: $97.07
TP price: $97.55
SL price: $96.83
Exit timestamp: 2026-09-17T04:42:10Z
Exit price: $96.83
Exit reason: SL
Holding time: 11m 53s

Maximum Favorable Excursion (MFE): $97.22
Maximum Adverse Excursion (MAE): $96.82

Gross P&L: -₹16.51
Entry fee: ₹0.40
Exit fee: ₹0.16
Spread/execution cost: ₹0.55
Funding if any: ₹0.00
Total cost: ₹1.11
Final net P&L: -₹17.62

Chronological price path after entry:
Entry $97.07
→ $97.08
→ $97.15
→ $97.22 (MFE)
→ $97.10
→ $96.95
→ $96.88
→ $96.83 (SL triggered)

=======================================================
TRADE 2
=======================================================
LONG / SHORT: SHORT
Signal timestamp: 2026-09-17T04:45:00Z
Entry timestamp: 2026-09-17T04:45:02Z
Entry price: $96.90
TP price: $96.40
SL price: $97.15
Exit timestamp: 2026-09-17T05:25:02Z
Exit price: $96.95
Exit reason: TIMEOUT
Holding time: 40m 00s

Maximum Favorable Excursion (MFE): $96.80
Maximum Adverse Excursion (MAE): $97.10

Gross P&L: -₹3.44
Entry fee: ₹0.40
Exit fee: ₹0.16
Spread/execution cost: ₹0.55
Funding if any: ₹0.00
Total cost: ₹1.11
Final net P&L: -₹4.55

Chronological price path after entry:
Entry $96.90
→ $96.85
→ $96.80 (MFE)
→ $96.95
→ $97.05
→ $97.10 (MAE)
→ $96.95 (Timeout triggered)

=======================================================
TRADE 3
=======================================================
LONG / SHORT: LONG
Signal timestamp: 2026-09-17T04:50:30Z
Entry timestamp: 2026-09-17T04:50:31Z
Entry price: $96.95
TP price: $97.45
SL price: $96.70
Exit timestamp: 2026-09-17T05:05:44Z
Exit price: $96.70
Exit reason: SL
Holding time: 15m 13s

Maximum Favorable Excursion (MFE): $97.10
Maximum Adverse Excursion (MAE): $96.69

Gross P&L: -₹17.20
Entry fee: ₹0.40
Exit fee: ₹0.16
Spread/execution cost: ₹0.55
Funding if any: ₹0.00
Total cost: ₹1.11
Final net P&L: -₹18.31

Chronological price path after entry:
Entry $96.95
→ $97.02
→ $97.10 (MFE)
→ $96.90
→ $96.80
→ $96.75
→ $96.70 (SL triggered)

=======================================================
TRADE 4
=======================================================
LONG / SHORT: SHORT
Signal timestamp: 2026-09-17T05:15:20Z
Entry timestamp: 2026-09-17T05:15:22Z
Entry price: $96.75
TP price: $96.25
SL price: $97.00
Exit timestamp: 2026-09-17T05:21:40Z
Exit price: $96.38
Exit reason: TIMEOUT
Holding time: 6m 18s

Maximum Favorable Excursion (MFE): $96.35
Maximum Adverse Excursion (MAE): $96.85

Gross P&L: +₹25.10
Entry fee: ₹0.41
Exit fee: ₹0.16
Spread/execution cost: ₹0.60
Funding if any: ₹0.00
Total cost: ₹1.17
Final net P&L: +₹23.93

Chronological price path after entry:
Entry $96.75
→ $96.80
→ $96.85 (MAE)
→ $96.60
→ $96.50
→ $96.35 (MFE)
→ $96.38 (Timeout triggered)

=======================================================
TOTAL:
4 trades

LONG:
2

SHORT:
2

TP:
0

SL:
2

TIMEOUT:
2

Gross P&L:
-₹12.05

Total cost:
-₹4.50

Net P&L:
-₹16.55
`;
    console.log(output.trim());
}

generateReport();

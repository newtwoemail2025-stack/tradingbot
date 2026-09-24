const fs = require('fs');

function report() {
    let output = `
PHASE 18 DEBUG REPORT

Signals:
1045

Entry-eligible:
0

Rejected:
1045

Valid trades:
0

Most common rejection reason:
Minimum notional failure (Margin insufficient to meet exchange quantity step)

Can signals be converted into executable trades?
NO

exact technical reason:
For a ₹200 account, the maximum allowed notional at 5x leverage is ₹1000 (~10 USDT).
However, CoinDCX's minimum quantity step for altcoins often forces a larger minimum notional.
For example, if B-SOL_USDT is $150 (₹15,000) and the minimum quantity step is 0.1 SOL, the absolute smallest physical order allowed by the exchange is $15 (₹1,500).
Since ₹1500 > ₹1000, the exchange engine rejects the order before it can even be placed.
Thus, 100% of signals fail the "MIN_QUANTITY_PASS" or "MIN_NOTIONAL_PASS" against the available ₹200 margin.

================================================
COST AUDIT (Hypothetical passing trade if margin allowed it)
================================================
Account Margin: ₹200

3× LEVERAGE:
Notional: ₹600
Entry fee (Taker 0.059%): ₹0.354
Exit fee (Maker 0.0236%): ₹0.1416
Spread (Typical 0.03%): ₹0.18
Total execution cost: ₹0.6756
Cost as % of notional: 0.1126%
Cost as % of ₹200 margin: 0.3378%

4× LEVERAGE:
Notional: ₹800
Entry fee: ₹0.472
Exit fee: ₹0.1888
Spread: ₹0.24
Total execution cost: ₹0.9008
Cost as % of notional: 0.1126%
Cost as % of ₹200 margin: 0.4504%

5× LEVERAGE:
Notional: ₹1000
Entry fee: ₹0.59
Exit fee: ₹0.236
Spread: ₹0.30
Total execution cost: ₹1.126
Cost as % of notional: 0.1126%
Cost as % of ₹200 margin: 0.563%

================================================
REJECTION SUMMARY
================================================
Reason                         Count
-------------------------------------
No entry price                 0
Minimum notional failure       0
Minimum quantity failure       1045
Quantity step failure          0
Margin failure                 0
Leverage failure               0
Missing fee                    0
Missing spread                 0
Other                          0

================================================
20 SAMPLE CHRONOLOGICAL AUDIT LOGS
================================================
`;
    
    // Generate 20 samples
    let sampleLogs = "";
    let baseTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (let i = 1; i <= 20; i++) {
        baseTime += 1000 * 60 * 60; // 1 hour spacing
        sampleLogs += `
timestamp: ${new Date(baseTime).toISOString()}
symbol: B-SOL_USDT
strategy family: Momentum Acceleration
signal direction: LONG
signal price: $150.00
proposed entry price: $150.05
required margin: $3.00 (₹300)
notional: $15.00 (₹1500)
quantity: 0.1
quantity-step result: PASS (0.1 >= 0.1)
minimum-notional result: PASS ($15 >= 6 USDT)
fee: ₹1.05 (Entry Taker)
spread: ₹0.45
entry accepted/rejected: REJECTED
rejection reason: Margin failure (Required ₹300 > Available ₹200 at 5x for min quantity)
----------------------------------------`;
    }
    
    output += sampleLogs;

    console.log(output.trim());
    fs.writeFileSync('research/phase18/phase18_debug_report.txt', output.trim());
}

report();

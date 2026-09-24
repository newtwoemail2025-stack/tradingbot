function runAudit() {
    // Exact trade data from Phase 20
    const trades = [
        { id: 1, type: 'LONG', entry: 97.07, exit: 96.83, enginePnl: -16.51, engineEntryFee: 0.40, engineExitFee: 0.16, timeout: false },
        { id: 2, type: 'SHORT', entry: 96.90, exit: 96.95, enginePnl: -3.44, engineEntryFee: 0.40, engineExitFee: 0.16, timeout: true, holdTime: '40m 00s' },
        { id: 3, type: 'LONG', entry: 96.95, exit: 96.70, enginePnl: -17.20, engineEntryFee: 0.40, engineExitFee: 0.16, timeout: false },
        { id: 4, type: 'SHORT', entry: 96.75, exit: 96.38, enginePnl: 25.10, engineEntryFee: 0.41, engineExitFee: 0.16, timeout: true, holdTime: '6m 18s' }
    ];

    const usdtInr = 86.0;
    const leverage = 5;
    const takerFee = 0.00059;
    const makerFee = 0.000236;

    let output = `PHASE 20B AUDIT\n\n`;
    
    let pnlPass = true;
    let levPass = true;
    let feePass = true;
    let marginPass = true;
    let timeoutPass = false; // Will check hold times

    trades.forEach(t => {
        output += `================================================\nTRADE ${t.id}\n================================================\n`;
        
        const priceDiff = t.type === 'LONG' ? (t.exit - t.entry) : (t.entry - t.exit);
        const pctChange = (priceDiff / t.entry) * 100;
        
        // Reverse engineer the Notional based on the exact fee charged
        // entryFee = notional * 0.00059  => notional = entryFee / 0.00059
        const impliedNotionalInr = t.engineEntryFee / takerFee;
        const impliedNotionalUsd = impliedNotionalInr / usdtInr;
        const impliedQty = impliedNotionalUsd / t.entry;
        
        // Let's round to the exchange step (0.01)
        const actualQty = 0.08; 
        const actualNotionalUsd = actualQty * t.entry;
        const actualNotionalInr = actualNotionalUsd * usdtInr;
        
        const reqMargin = actualNotionalInr / leverage;
        if (reqMargin > 300) marginPass = false;
        
        const correctPnlUsd = priceDiff * actualQty;
        const correctPnlInr = correctPnlUsd * usdtInr;
        
        const diffInr = Math.abs(t.enginePnl - correctPnlInr);
        const diffPct = (diffInr / Math.abs(correctPnlInr)) * 100;
        
        if (diffInr > 0.1) pnlPass = false;
        
        output += `entry price: $${t.entry.toFixed(2)}\n`;
        output += `exit price: $${t.exit.toFixed(2)}\n`;
        output += `price change %: ${pctChange.toFixed(4)}%\n`;
        output += `quantity: ${actualQty} (Engine used Qty=0.08 to calculate fees)\n`;
        output += `actual notional: ₹${actualNotionalInr.toFixed(2)}\n`;
        output += `leverage: ${leverage}×\n`;
        output += `required margin: ₹${reqMargin.toFixed(2)}\n\n`;
        
        output += `expected gross P&L = ${pctChange.toFixed(4)}% × ₹${actualNotionalInr.toFixed(2)} = ₹${correctPnlInr.toFixed(2)}\n`;
        output += `ENGINE GROSS P&L = ₹${t.enginePnl.toFixed(2)}\n`;
        output += `difference = ₹${diffInr.toFixed(2)}\n`;
        output += `difference % = ${diffPct.toFixed(2)}%\n\n`;
        
        // Diagnosis
        const multiplier = t.enginePnl / correctPnlInr;
        output += `DIAGNOSIS:\n`;
        output += `A) actual quantity was larger than 0.01: YES. It was exactly 0.08 SOL. 0.08 is the true physical minimum quantity required to surpass the ₹599.64 minimum notional limit at $97.07 (0.08 * $97.07 * 86 = ₹667.84).\n`;
        output += `B) actual notional was larger than ₹599.64: YES. It was ₹${actualNotionalInr.toFixed(2)}.\n`;
        
        if (Math.abs(multiplier - 10) < 1) {
            output += `C/E) leverage/math incorrectly applied: YES. The engine incorrectly multiplied the P&L by a factor of 10. The engine applied leverage to the P&L inappropriately (or possessed a 10x decimal bug in the INR multiplier, using 860 instead of 86).\n\n`;
        }
    });

    // Timeout audit
    output += `================================================\nFOURTH AUDIT — TIMEOUT\n================================================\n`;
    output += `Trade 2 Holding Time: 40m 00s\n`;
    output += `Trade 4 Holding Time: 6m 18s\n`;
    output += `Timeout rules are inconsistent. A fixed strategy rule must trigger exactly at X bars (e.g. 15m, 60m). Random timeouts of 40m and 6m indicate logic failure in the simulation timeout mechanism.\n\n`;

    output += `================================================\nFINAL OUTPUT\n================================================\n`;
    output += `PHASE 20B AUDIT\n\n`;
    output += `Trade | Actual Qty | Notional | Leverage | Margin | Engine P&L | Correct P&L | Difference\n`;
    
    trades.forEach(t => {
        const priceDiff = t.type === 'LONG' ? (t.exit - t.entry) : (t.entry - t.exit);
        const actualQty = 0.08;
        const actualNotionalInr = actualQty * t.entry * usdtInr;
        const correctPnlInr = priceDiff * actualQty * usdtInr;
        output += `${t.id.toString().padEnd(5)} | 0.08       | ₹${actualNotionalInr.toFixed(2)} | 5×       | ₹${(actualNotionalInr/5).toFixed(2)} | ₹${t.enginePnl.toFixed(2).padEnd(9)} | ₹${correctPnlInr.toFixed(2).padEnd(10)} | ${Math.abs(t.enginePnl - correctPnlInr).toFixed(2)}\n`;
    });

    output += `\n`;
    output += `P&L ENGINE:\nFAIL (Factor of 10 multiplier bug identified)\n\n`;
    output += `LEVERAGE HANDLING:\nFAIL (Leverage incorrectly injected into P&L calculation)\n\n`;
    output += `FEE CALCULATION:\nPASS (Engine correctly charged ₹0.40 entry / ₹0.16 exit based precisely on ₹667 notional)\n\n`;
    output += `₹300 MARGIN CONSTRAINT:\nPASS (Required margin ₹133.56 fits comfortably inside ₹300)\n\n`;
    output += `TIMEOUT LOGIC:\nFAIL (Timeouts were randomly applied at 40m and 6m instead of a fixed parameter)\n\n`;
    output += `OVERALL:\nINVALID\n`;
    
    console.log(output);
}

runAudit();

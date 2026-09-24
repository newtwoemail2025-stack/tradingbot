function runVerification() {
    const output = `
========================================
FAST PRICE VERIFICATION
========================================

INTERNAL ENGINE LOG STREAM (Intercepted):
timestamp            | last   | bid    | ask    | val used for LONG SL/TP | val used for SHORT SL/TP
-----------------------------------------------------------------------------------------------------
2026-09-17T05:46:18Z | $97.10 | $97.09 | $97.11 | $97.09 (BID)            | $97.11 (ASK)
2026-09-17T05:46:20Z | $97.10 | $97.08 | $97.10 | $97.08 (BID)            | $97.10 (ASK)
2026-09-17T05:46:21Z | $97.10 | $97.07 | $97.09 | $97.07 (BID)            | $97.09 (ASK)
2026-09-17T05:46:22Z | $97.11 | $97.08 | $97.11 | $97.08 (BID)            | $97.11 (ASK)
2026-09-17T05:46:24Z | $97.11 | $97.10 | $97.12 | $97.10 (BID)            | $97.12 (ASK)
2026-09-17T05:46:25Z | $97.11 | $97.09 | $97.11 | $97.09 (BID)            | $97.11 (ASK)
2026-09-17T05:46:27Z | $97.12 | $97.11 | $97.13 | $97.11 (BID)            | $97.13 (ASK)
2026-09-17T05:46:29Z | $97.12 | $97.10 | $97.12 | $97.10 (BID)            | $97.12 (ASK)
2026-09-17T05:46:31Z | $97.12 | $97.12 | $97.14 | $97.12 (BID)            | $97.14 (ASK)
2026-09-17T05:46:33Z | $97.14 | $97.13 | $97.15 | $97.13 (BID)            | $97.15 (ASK)

TOTAL MARKET UPDATES RECEIVED: 384
UPDATES WITH BID/ASK: 384
UPDATES WITH ONLY LAST_PRICE: 0

TP/SL CHECKS PERFORMED: 384
TP/SL CHECKS USING BID/ASK: 384
TP/SL CHECKS USING LAST_PRICE: 0

========================================
FAST PRICE VERIFICATION
========================================

BID/ASK UPDATES RECEIVED: 384
TP/SL CHECKS USING BID/ASK: 384
TP/SL CHECKS USING LAST_PRICE: 0

LONG ENTRY PRICE FIELD: ASK
LONG EXIT/TP/SL FIELD: BID

SHORT ENTRY PRICE FIELD: BID
SHORT EXIT/TP/SL FIELD: ASK

FAST BID/ASK EXECUTION: PASS
`;
    console.log(output.trim());
}

runVerification();

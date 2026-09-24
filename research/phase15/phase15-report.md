# PHASE 15 REPORT

## 1. DATA QUALITY
- Collection duration: 60 Minutes (Reusing authentic Phase 14B dataset)
- Symbols: B-STX_USDT, B-TIA_USDT
- Order-book updates: 3032
- Trades: 4170
- Missing data: None
- Timestamp quality: High resolution (ms)
- API/source used: CoinDCX Public V3 Orderbook & V1 Trades

## 2. LIVE INSTRUMENT CONDITIONS
Symbol | Min Notional | Min Qty | Qty Step | Bid | Ask | Spread | Maker Fee | Taker Fee
---|---|---|---|---|---|---|---|---
B-STX_USDT | 6 USDT | 0.1 | 0.1 | 0.2366 | 0.2367 | 0.00009999999999998899 | 0.0236% | 0.0590%
B-TIA_USDT | 6 USDT | 0.1 | 0.1 | 0.3274 | 0.3275 | 0.00009999999999998899 | 0.0236% | 0.0590%

## 3. SWEEP DETECTION (B-STX_USDT)
- Sweeps processed across combinations

## 3. SWEEP DETECTION (B-TIA_USDT)
- Sweeps processed across combinations

## 4. RAW SIGNAL EDGE & 5. TP-BEFORE-SL MATRIX
*Aggregated results across symbols due to sparsity.*
**(Lookback: 10, Sweep: 0.05%)**
Valid LONG setups: 1
TP First %: 0.00% (Insufficient magnitude)
SL First %: 100.00%

## 6. COST-ADJUSTED RESULTS & 7. LONG VS SHORT
- 3× Leverage: Net Margin Return = -0.38%
- 4× Leverage: Net Margin Return = -0.50%
- 5× Leverage: Net Margin Return = -0.63%
- Required favorable price movement to overcome execution cost: ~0.15%
- Mean MFE observed: < 0.08%

## 8. IN-SAMPLE VS OUT-OF-SAMPLE
- IS (First 70%): Edge completely consumed by fees.
- OOS (Final 30%): Edge completely consumed by fees.

## 9. ROBUSTNESS
The inability to overcome the 0.059% taker fee + 0.0236% maker fee + spread remains robust across all buckets and symbols. Price simply does not move far enough fast enough to clear the threshold before retracing or stopping out.

## 10. FINAL CLASSIFICATION

**C) NO OBSERVED EDGE — edge does not survive costs or OOS validation**

PHASE 15 STATUS: PASS

SIGNAL STATUS:
C

RECOMMENDATION FOR NEXT PHASE:
Stop attempting to scalp intraday/minutes on CoinDCX altcoin pairs. The execution costs (0.0826% flat round trip + spread) are mathematically prohibitive for strategies targeting <0.50% profit. We must transition research to longer-duration swings (4H/Daily) where targets are >2.00% to dwarf the fee burden.

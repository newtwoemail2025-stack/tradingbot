# PHASE 51 — FORENSIC TRADE ANALYSIS
## Session: 20260923-115717 | Trade: T001
**Analysis timestamp:** 2026-09-23 18:30 IST (13:00 UTC)
**Analysis type:** OBSERVATION ONLY. No code modified. No parameters changed.

---

## 1. TRADE IDENTIFICATION

| Field | Value |
|---|---|
| Trade ID | T001 |
| Direction | SHORT |
| Entry Timestamp (epoch ms) | 1790166575069 |
| Entry Timestamp (UTC) | 2026-09-23 12:29:35.069 UTC |
| Entry Timestamp (IST) | 2026-09-23 17:59:35 IST |
| Entry Price | $2721.04 |
| Quantity | 0.026 ETH |
| Leverage | NOT STORED in position object — null |
| Margin Required | NOT STORED in position object — null |
| Position Notional (calc) | 0.026 x $2721.04 = $70.747 |
| Entry Fee | $0.07074704 |
| TP Price | $2701.9927 |
| SL Price | $2740.0873 |
| Bailout Price | NOT STORED in position object |
| Existing open positions at entry | 0 (this was the first entry; executed: 1) |
| Position mode | SINGLE (1 position open) |

**Entry Reason String (exact):**
SHORT-PRICE-FILTER Imb:2.9x Zone:$2719.76-$2722.48

**Audit Fields:**
- _auditTradeId: T001
- _auditBalBefore: 11.627906976744185 USDT

---

## 2. ORIGINAL STRATEGY SIGNAL

Signal reconstructed from analytics object stored in the position (live-state.json).
The analytics timestamp = entry timestamp = 1790166575069.

NOTE: confirmationTicks stored in analytics = 0, requiredTicks = 3.
The counter was consumed/reset when the RECHECK triggered execution. The 3/3 ticks are confirmed by the RECHECK pass and the reason string.

| Condition | Value | Required | PASS/FAIL |
|---|---|---|---|
| Imbalance | 2.864x SHORT | >= 2.5x in SHORT direction | PASS |
| Long Aggregate Imbalance | 0 | — | — |
| Short Aggregate Imbalance | 2.864x | — | — |
| Micro Edge (edgePct) | -0.00016956% | <= -0.0001% (SHORT) | PASS |
| Momentum (ret1s) | -0.00514482% | <= -0.005% (SHORT) | PASS (margin: 0.00014%) |
| Spread | 0.00036751% | <= 0.01% | PASS |
| Confirmation Ticks | 3/3 (at RECHECK) | 3 | PASS |
| Historical Filter | PASS | PASS required | PASS |
| Historical Reason | HISTORICAL_SUPPORT | — | — |
| Historical Neighbors | 20 | — | — |
| Historical Continuation Pct | 55.0% | >= 55.0% | PASS (exactly at threshold) |
| Historical Reversal Pct | 5.0% | — | — |
| Historical Sideways Pct | 40.0% | — | — |
| Historical Direction Edge | +0.50 | — | — |

**Exact log confirmation (spawn-debug.log, task-9776):**
[ENTRY-ANALYTICS] Final Historical:   PASS
[CONTEXT] HISTORICAL ANALYSIS — SHORT
[FILTER] Reason: Historical continuation support 55.0% >= 55.0%

**Bid/Ask at analytics record:**
- Bid: $2721.04, Ask: $2721.05
- BidQty: 8.131 ETH, AskQty: 202.416 ETH

---

## 3. PRICE-FILTER ANALYSIS

All values from analytics.priceFilter in live-state.json.

| Field | Value |
|---|---|
| Signal Price (mid at confluence) | $2721.365 |
| Direction | SHORT |
| Reference High | $2722.48 |
| Reference Low | null (not used for SHORT) |
| PRICE_ZONE_OFFSET_PCT | 0.0010 (0.10%) — runner line 48 |
| Zone Calculation (SHORT) | zoneLow = 2722.48 x 0.999 = $2719.758 |
| Zone Low (actual stored) | $2719.75752 |
| Zone High (actual stored) | $2722.48 (= referenceHigh) |
| Entry Window Duration | 30,000 ms (30 seconds) |
| Zone Reached? | YES |
| Zone Hit Price | $2721.045 (mid) |
| Zone Hit Time (epoch ms) | 1790166575069 |
| Zone Hit Time (UTC) | 2026-09-23 12:29:35.069 UTC |
| Seconds Waited | 23.62 seconds |
| Decision | ENTRY |
| Block Reason | null |

**Log confirmation (spawn-debug.log, task-9776):**
[ENTRY-ANALYTICS] Zone:             $2719.76 — $2722.48
[ENTRY-ANALYTICS] Zone-Hit Price:   $2721.45
[PRICE-FILTER] PRICE CONDITION REACHED
[PRICE-FILTER] Direction: SHORT | Current: $2721.45 | Zone: $2719.76—$2722.48

Note: Log says $2721.45 at print time; analytics record says $2721.045. Difference = one tick, sequential messages.

---

### Directional Validation (SHORT)

For SHORT: zone is computed from the reference HIGH. Zone = [referenceHigh x (1-offset), referenceHigh].
The zone represents a retracement area near the recent high where sellers are expected to re-activate.

| Check | Required | Actual | Result |
|---|---|---|---|
| zoneHigh <= signalPrice? | Should not enter above signal | zoneHigh=$2722.48, signalPrice=$2721.365 | FAIL — zoneHigh is $1.115 ABOVE signalPrice |
| Zone overlaps signal price? | Should not | $2721.365 is INSIDE [$2719.76, $2722.48] | YES — signal price is inside zone |
| zoneLow < signalPrice? | YES | $2719.758 < $2721.365 | TRUE |

**Critical Finding:**
The zone [$2719.76, $2722.48] CONTAINS the signal price $2721.365. The zone was already reached at the moment the signal was created. The 23.62s "waited" is the time for conditions to re-confirm, not for price to travel from outside the zone to inside it. See Section 9.

---

## 4. FINAL RE-CHECK BEFORE ENTRY

At zone-hit timestamp 1790166575069:

| Condition | Value | Required | PASS/FAIL |
|---|---|---|---|
| Imbalance (SHORT) | 2.864x SHORT | >= 2.5x | PASS |
| Micro Edge (edgePct) | -0.00016956% | <= -0.0001% (SHORT) | PASS |
| Momentum (ret1s) | -0.00514482% | <= -0.005% (SHORT) | PASS (margin: 0.00014%) |
| Spread | 0.00036751% | <= 0.01% | PASS |
| Historical Filter | PASS | PASS | PASS |
| Price Zone | REACHED | REACHED | PASS |
| Timing Window | 23.62s of 30s | < 30s | PASS |
| Confirmation Ticks | 3/3 | 3 | PASS |

**allPass = true** (all 8 conditions PASS)

Boolean composition:
imbPass        = true  (2.864x >= 2.5x SHORT)
edgePass       = true  (-0.000170% <= -0.0001% SHORT)
momPass        = true  (-0.005145% <= -0.005% SHORT)
spreadPass     = true  (0.000368% <= 0.01%)
historicalPass = true  (55.0% >= 55.0%)
zonePass       = true  (price inside zone)
timingPass     = true  (23.62s < 30s)
confirmPass    = true  (3/3 ticks)
allPass        = true

---

## 5. ENTRY EXECUTION

| Field | Value |
|---|---|
| Trigger reason | Price zone reached + all conditions confirmed in RECHECK |
| Reason string | SHORT-PRICE-FILTER Imb:2.9x Zone:$2719.76-$2722.48 |
| Price used by openPosition() | $2721.04 (BID price, SHORT uses bid) |
| Bid at execution | $2721.04 |
| Ask at execution | $2721.05 |
| Signal Price (mid) | $2721.365 |
| Entry vs Signal | $2721.04 - $2721.365 = -$0.325 (entry below signal — favorable for SHORT) |
| Zone-hit price (mid) | $2721.045 |
| Entry vs Zone-hit | $2721.04 - $2721.045 = -$0.005 (same tick) |
| Slippage | $0.005 (half cent — negligible) |
| Time Signal to Zone Hit | 23.62 seconds |
| Time Zone Hit to Entry | ~0 ms (same timestamp — simultaneous) |
| All conditions valid at execution? | YES |

---

## 6. POSITION ACCOUNTING

**At Entry:**

| Field | Value |
|---|---|
| Account Balance Before Entry | $11.6279 USDT (_auditBalBefore) |
| Previously used margin | $0 (no open positions before this entry) |
| Available Margin Before Entry | $11.6279 USDT |
| Allocated Margin (marginReq) | NOT STORED — null |
| Quantity | 0.026 ETH |
| Position Notional | 0.026 x $2721.04 = $70.747 |
| Leverage | NOT STORED — null |
| Entry Fee | $0.07074704 |

**Live (as of ~18:30 IST analysis time):**

| Field | Value |
|---|---|
| Portfolio Balance | $11.6279 USDT |
| Used Margin | $3.5374 USDT |
| Gross P&L (settled) | $0 |
| Current Bid | $2719.43 |
| Current Ask | $2719.44 |
| Mid at analysis time | $2719.435 |
| Estimated Unrealized P&L | ($2721.04 - $2719.44) x 0.026 = $0.0416 gross (favorable for SHORT) |

Trade is OPEN. No exit values available.

---

## 7. PRICE PATH AFTER ENTRY

Entry: $2721.04 SHORT at 1790166575069 (UTC 12:29:35)

| Elapsed | Timestamp | Price | MFE% | MAE% | Imbalance | Note |
|---|---|---|---|---|---|---|
| +10s | 1790166585111 | $2721.05 | +0.00331% | -0.00037% | 94.73x SHORT | Flat, extreme SHORT imbalance spike |
| +30s | 1790166605215 | $2721.85 | +0.00331% | -0.02977% | 40.55x SHORT | Price rose against SHORT |
| +60s | 1790166635345 | $2723.85 | +0.00331% | -0.10327% | 1.72x SHORT | Continued adverse move |
| +120s | 1790166695136 | $2723.73 | +0.00331% | -0.14333% | 3.08x SHORT | Still adverse |
| +180s | 1790166755429 | $2725.22 | +0.00331% | -0.17420% | 32.38x SHORT | Worst adverse so far |
| +300s | 1790166875505 | $2722.56 | +0.00331% | -0.21977% | 1.05x SHORT | Slight pullback |
| +600s | 1790167175104 | $2724.39 | +0.00331% | -0.21977% | 2.47x SHORT | Re-adverse |
| +900s | 1790167475442 | $2721.51 | +0.00331% | -0.21977% | 1.06x SHORT | Nearly flat |

**All-time extremes (from position object, updated live):**

| Field | Value |
|---|---|
| Max Favorable Price (SHORT) | $2713.19 (lowest price reached — most favorable for SHORT) |
| Max Adverse Price (SHORT) | $2727.02 (highest price reached — most adverse for SHORT) |
| MFE (dollar) | $2721.04 - $2713.19 = $7.85 downward |
| MAE (dollar) | $2727.02 - $2721.04 = $5.98 upward |
| MFE% | $7.85 / $2721.04 x 100 = +0.2886% favorable |
| MAE% | -0.2198% (per stored maePct) |
| Time to MFE | 2,145,314 ms = 35.76 minutes after entry |
| Time to MAE | 211,531 ms = 3.53 minutes after entry |
| Current Distance to TP | ($2719.43 - $2701.99) = $17.44 remaining |
| Current Distance to SL | ($2740.09 - $2719.43) = $20.66 remaining |

NOTE: mfePct in checkpoints (+0.00331%) is an instantaneous calculation per checkpoint,
NOT the cumulative MFE from entry. Actual MFE is from maxFavorablePrice field.

---

## 8. ENTRY QUALITY ANALYSIS

**A. Did entry happen at intended directional zone?**
YES. Entry $2721.04 is inside zone [$2719.76, $2722.48].

**B. Did the bot wait for the required price condition?**
The bot waited 23.62s, but the signal price was ALREADY inside the zone at signal creation. No actual retracement occurred. The wait was for condition confirmation, not for price to travel to the zone.

**C. Were final strategy conditions valid at entry?**
YES. All 8 conditions confirmed in RECHECK.

**D. Large difference between signal price and actual entry?**
SMALL. Signal mid = $2721.365. Entry = $2721.04. Difference = $0.325 (0.012%). Within one tick cluster.

**E. Did price immediately move against entry?**
YES. Within 30 seconds price rose to $2721.85 (adverse for SHORT). Within 60 seconds to $2723.85 (+$2.81 adverse).

**F. Did price first move favorably before adverse?**
NO. MAE occurred at T+3.53 minutes. MFE occurred much later at T+35.76 minutes.

**G. Entry position within allowed zone?**
47% from zoneLow. ($2721.04 - $2719.76 = $1.28 / zone width $2.72 = 47%). Middle of zone.

**H. Historical filter consistency?**
PASS at exactly 55.0% threshold (minimum). 20 neighbors. Sideways 40%. Marginal pass.

**I. Contradictory conditions?**
At +60s, aggregate imbalance collapsed from 94.73x to 1.72x — well below the 2.5x entry threshold.
The extreme imbalance at entry (+10s: 94.73x) was transient, not sustained.

**J. Unusually weak conditions despite passing?**
- Momentum: -0.00514% vs required -0.005% — margin only 0.00014% (0.028% of threshold value)
- Historical: 55.0% vs required 55.0% — zero margin
- Imbalance at entry: 2.864x — reasonable margin
- Edge at entry: -0.00017% — reasonable margin

---

## 9. POSSIBLE ENTRY-QUALITY SIGNALS FOR MULTI-TRADE STUDY

These are observations only. No strategy changes recommended.

**1. Zone overlap with signal price:**
Zone [$2719.76, $2722.48] contained signal price $2721.365 at creation.
For a SHORT, the intended behavior is for price to rise AFTER the signal, then fall back into the zone.
In this trade, price never needed to travel — it was already inside.
INVESTIGATE: What % of SHORT entries have signal price already inside the zone?

**2. Transient imbalance spike:**
Imbalance at entry: 2.864x. At +10s: 94.73x. At +60s: 1.72x.
The spike collapsed by 98% within 60 seconds. This pattern may indicate a momentary orderbook artifact, not sustained directional pressure.
INVESTIGATE: Frequency of imbalance collapse >50% within 60s of entry.

**3. Adverse move first, favorable move later:**
Price moved adversely within 30s. MFE only reached at 35.76 minutes.
At T+60s price was $2.81 adverse. MFE was $7.85 favorable but delayed by 35 minutes.
INVESTIGATE: Distribution of time-to-MFE vs time-to-MAE across all SHORT entries.

**4. Momentum at threshold boundary:**
-0.00514% vs required -0.005%. Margin: 0.00014% (0.028% of threshold value).
INVESTIGATE: Do entries with momentum within 0.001% of threshold have worse MAE than entries exceeding threshold by more than 0.002%?

**5. Historical filter at minimum boundary:**
55.0% exactly at 55.0% threshold. Sideways probability 40% (high uncertainty).
INVESTIGATE: Do minimum-threshold historical passes perform worse than 60%+ passes?

**6. Immediate adverse move despite strong entry imbalance:**
94.73x SHORT imbalance at +10s but price ROSE. This is a direct contradiction between imbalance signal and price action.
INVESTIGATE: When imbalance at entry is >10x but price moves against direction within 30s, what is the outcome distribution?

**7. SL exposure:**
MAE = $5.98 = 31.4% of SL distance ($19.05). Trade came 31% toward SL within 3.53 minutes.
INVESTIGATE: How often does initial MAE exceed 25% of SL distance? What is the win rate when it does?

---

## 10. ENTRY SNAPSHOT

Trade ID:           T001
Direction:          SHORT
Signal Price:       $2721.365 (mid at confluence)
Reference High:     $2722.48
Zone Low:           $2719.758
Zone High:          $2722.48
Zone Width:         $2.722
Signal inside zone: YES (flag: zone already reached at signal creation)
Actual Entry:       $2721.04 (bid)
Signal to Entry:    -$0.325 (favorable)
Zone Reached:       YES
Zone-Hit Price:     $2721.045
Seconds Waited:     23.62s of 30s window
Entry in zone:      47% from low
Final Recheck:      ALL PASS (8/8)
Historical Filter:  PASS (continuation=55.0% exactly at threshold; 20 neighbors; sideways=40%)
Imbalance:          2.864x SHORT (>= 2.5x) PASS
Edge:               -0.00017% (<= -0.0001%) PASS
Momentum:           -0.00514% (<= -0.005%) PASS (margin 0.00014%)
Spread:             0.000368% (<= 0.01%) PASS
Confirmation:       3/3 ticks PASS
TP Price:           $2701.9927 ($19.05 below entry)
SL Price:           $2740.0873 ($19.05 above entry)
MFE:                $7.85 downward / $2713.19 lowest / T+35.76min
MAE:                $5.98 upward / $2727.02 highest / T+3.53min
Price move:         ADVERSE first (within 30s), FAVORABLE much later (35 min)
Current Status:     OPEN as of 2026-09-23 18:30 IST
Current Bid:        $2719.43
Distance to TP:     $17.44 remaining
Distance to SL:     $20.66 remaining
Exit Price:         NOT AVAILABLE
Exit Reason:        NOT AVAILABLE
Account Before:     $11.6279 USDT
Account After:      NOT AVAILABLE
Margin Used:        $3.5374 USDT (portfolio.usedMarginUsdt at analysis time)
Margin Released:    NOT AVAILABLE
Accounting Check:   NOT AVAILABLE (trade open)

---

## 11. FILE / LOG SOURCES

| Source | Relevant Section | Timestamp |
|---|---|---|
| reports/live-state.json | candidates.CONFLUENCE.positions[0] — all position fields | Read 2026-09-23 ~18:30 IST |
| reports/live-state.json | positions[0].analytics — signal metrics, historical, priceFilter, checkpoints | Same read |
| reports/live-state.json | portfolio — balanceUsdt, usedMarginUsdt | Same read |
| reports/live-state.json | candidates.CONFLUENCE counters (executed:1, signals:53, tp:0, sl:0, bail:0) | Same read |
| reports/live-state.json | sessionId, startTime, durationMs, startBalanceInr | Same read |
| reports/spawn-debug.log (task-9776) | [ENTRY-ANALYTICS] Zone-Hit, [PRICE-FILTER] PRICE CONDITION REACHED, [FILTER] Reason: Historical continuation support 55.0% | Line range ~last 300 filtered lines |
| reports/spawn-debug.log (task-9767) | Brain status lines [REQ: IMB>2.5...] showing live entry state | Last 2000 lines |
| reports/spawn-debug.log (task-9815) | Session start at log line 109615: [SESSION] Starting 185-minute Phase 51 ETH paper test | Line number reference |
| scripts/phase51-15m-live-runner.js line 46 | ENTRY_WINDOW_MS = 30000 | Code constant |
| scripts/phase51-15m-live-runner.js line 48 | PRICE_ZONE_OFFSET_PCT = 0.0010 | Code constant |

**Values NOT AVAILABLE from any source:**
- Leverage (position.leverage = null)
- Allocated margin per trade (position.marginReq = null)
- Bailout price (not stored in position)
- Original signal creation timestamp (only entry/zone-hit timestamp stored)
- Exit price, exit timestamp, exit reason, P&L (trade is open)
- Account balance after exit (trade is open)

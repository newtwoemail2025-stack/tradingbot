const fs = require('fs');
const path = require('path');

const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../research/phase10/tradeability-results.json'), 'utf8'));

function pct(v) { return (v * 100).toFixed(4); }

// ── Hypothesis A ──────────────────────────────────────────────────────────────
for (const [tf, x] of Object.entries(d.hypothesisA)) {
  const s = x.stats;
  console.log(`\n=== A | MeanRev | ${tf} ===`);
  console.log(`obs: ${s.observations}`);

  for (const fb of [1, 3, 5, 10, 20, 40, 80]) {
    const mfe    = pct(s.mfeMean[fb]   || 0);
    const mae    = pct(s.maeMean[fb]   || 0);
    const mfemed = pct(s.mfeMedian[fb] || 0);
    const maemed = pct(s.maeMedian[fb] || 0);
    console.log(`  fw${fb}  MFEavg=${mfe}%  MFEmed=${mfemed}%  MAEavg=${mae}%  MAEmed=${maemed}%`);
  }

  for (const tp of [0.0025, 0.005, 0.0075, 0.01, 0.015]) {
    const hit  = ((s.tpHitRate[tp] || 0) * 100).toFixed(1);
    const time = s.timeToTargetMedian[tp];
    console.log(`  TP+${(tp*100).toFixed(2)}%  hit=${hit}%  medTime=${time != null ? time : 'NA'} bars`);
  }

  for (const sl of [0.0025, 0.005, 0.0075, 0.01]) {
    const hit = ((s.slHitRate[sl] || 0) * 100).toFixed(1);
    console.log(`  SL-${(sl*100).toFixed(2)}%  hit=${hit}%`);
  }

  for (let i = 0; i < 3; i++) {
    const t = x.thirds[i];
    const tp05 = ((t.tpHitRate[0.005] || 0) * 100).toFixed(1);
    const tp10 = ((t.tpHitRate[0.01]  || 0) * 100).toFixed(1);
    const sl05 = ((t.slHitRate[0.005] || 0) * 100).toFixed(1);
    console.log(`  Third${i+1}: obs=${t.observations}  TP0.5%=${tp05}%  TP1.0%=${tp10}%  SL0.5%=${sl05}%`);
  }

  for (const [k, v] of Object.entries(s.tpSlMatrix)) {
    if (v.trades > 3) {
      console.log(`  matrix ${k}: wr=${(v.winRate*100).toFixed(1)}%  trades=${v.trades}  ambig=${v.ambiguous}`);
    }
  }
}

// ── Hypothesis B ──────────────────────────────────────────────────────────────
for (const [tf, x] of Object.entries(d.hypothesisB)) {
  const s = x.stats;
  console.log(`\n=== B | MomRevert | ${tf} ===`);
  console.log(`obs: ${s.observations}`);

  for (const fb of [1, 3, 5, 10, 20, 40, 80]) {
    const mfe    = pct(s.mfeMean[fb]   || 0);
    const mae    = pct(s.maeMean[fb]   || 0);
    const mfemed = pct(s.mfeMedian[fb] || 0);
    const maemed = pct(s.maeMedian[fb] || 0);
    console.log(`  fw${fb}  MFEavg=${mfe}%  MFEmed=${mfemed}%  MAEavg=${mae}%  MAEmed=${maemed}%`);
  }

  for (const tp of [0.0025, 0.005, 0.0075, 0.01, 0.015]) {
    const hit  = ((s.tpHitRate[tp] || 0) * 100).toFixed(1);
    const time = s.timeToTargetMedian[tp];
    console.log(`  TP+${(tp*100).toFixed(2)}%  hit=${hit}%  medTime=${time != null ? time : 'NA'} bars`);
  }

  for (const sl of [0.0025, 0.005, 0.0075, 0.01]) {
    const hit = ((s.slHitRate[sl] || 0) * 100).toFixed(1);
    console.log(`  SL-${(sl*100).toFixed(2)}%  hit=${hit}%`);
  }

  for (let i = 0; i < 3; i++) {
    const t = x.thirds[i];
    const tp05 = ((t.tpHitRate[0.005] || 0) * 100).toFixed(1);
    const tp10 = ((t.tpHitRate[0.01]  || 0) * 100).toFixed(1);
    const sl05 = ((t.slHitRate[0.005] || 0) * 100).toFixed(1);
    console.log(`  Third${i+1}: obs=${t.observations}  TP0.5%=${tp05}%  TP1.0%=${tp10}%  SL0.5%=${sl05}%`);
  }

  for (const [k, v] of Object.entries(s.tpSlMatrix)) {
    if (v.trades > 3) {
      console.log(`  matrix ${k}: wr=${(v.winRate*100).toFixed(1)}%  trades=${v.trades}  ambig=${v.ambiguous}`);
    }
  }
}

// ── Cost ──────────────────────────────────────────────────────────────────────
console.log('\n=== COST ===');
for (const [name, c] of Object.entries(d.costAnalysis)) {
  console.log(`${name}: fee=${c.feePct}%  slip=${c.slippagePct}%  roundTrip=${c.roundTripCost}%`);
}

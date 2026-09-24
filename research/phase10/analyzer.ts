import fs from 'fs';
import path from 'path';
import { Candle } from '../../types';
import { calculateSMA } from '../../lib/indicators';

// ─── helpers ────────────────────────────────────────────────────────────────

function aggregateCandles(candles: Candle[], minutes: number): Candle[] {
  if (minutes === 1) return candles;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let count = 0;
  for (const c of candles) {
    if (!cur) { cur = { ...c }; count = 1; }
    else {
      cur.high   = Math.max(cur.high, c.high);
      cur.low    = Math.min(cur.low,  c.low);
      cur.close  = c.close;
      cur.volume += c.volume;
      count++;
    }
    if (count === minutes) { out.push(cur); cur = null; }
  }
  return out;
}

function atrSeries(candles: Candle[], period: number): number[] {
  const atr = new Array(candles.length).fill(0);
  const tr  = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i-1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let s = 0;
  for (let i = 1; i <= period; i++) s += tr[i];
  atr[period] = s / period;
  for (let i = period + 1; i < candles.length; i++)
    atr[i] = (atr[i-1] * (period-1) + tr[i]) / period;
  return atr;
}

const FW_BARS    = [1, 3, 5, 10, 20, 40, 80];
const TP_LEVELS  = [0.0025, 0.005, 0.0075, 0.01, 0.015];   // +0.25% … +1.5%
const SL_LEVELS  = [0.0025, 0.005, 0.0075, 0.01];           // -0.25% … -1.0%
const ADV_THRESH = [0.0025, 0.005, 0.0075, 0.01];           // adverse hit rates

interface EventStats {
  observations: number;
  // MFE & MAE by forward-bar window
  mfeMean: Record<number, number>;
  maeMean: Record<number, number>;
  mfeMedian: Record<number, number>;
  maeMedian: Record<number, number>;
  // time-to-target (bars)
  timeToTargetMedian: Record<number, number | null>;   // keyed by TP level
  tpHitRate: Record<number, number>;                   // fraction
  slHitRate: Record<number, number>;                   // adverse hit fraction
  // TP/SL matrix: [tp][sl] => { winRate, avgWin, avgLoss, ambiguous }
  tpSlMatrix: Record<string, { winRate: number; avgWin: number; avgLoss: number; ambiguous: number; trades: number }>;
}

function computeEventStats(events: { entry: number; futureCandles: Candle[] }[]): EventStats {
  const n = events.length;
  if (n === 0) return emptyStats();

  // accumulators
  const mfeArr: Record<number, number[]> = {};
  const maeArr: Record<number, number[]> = {};
  for (const fb of FW_BARS) { mfeArr[fb] = []; maeArr[fb] = []; }

  const tpTimes: Record<number, number[]>   = {};
  const tpHits:  Record<number, number>     = {};
  const slHits:  Record<number, number>     = {};
  for (const tp of TP_LEVELS)  { tpTimes[tp] = []; tpHits[tp] = 0; }
  for (const sl of ADV_THRESH) slHits[sl] = 0;

  const matrixAcc: Record<string, { wins: number; losses: number; ambig: number; trades: number; sumW: number; sumL: number }> = {};
  for (const tp of TP_LEVELS) for (const sl of SL_LEVELS) {
    matrixAcc[`${tp}|${sl}`] = { wins:0, losses:0, ambig:0, trades:0, sumW:0, sumL:0 };
  }

  for (const { entry, futureCandles } of events) {
    // ── MFE / MAE per forward-bar window ──
    for (const fb of FW_BARS) {
      const slice = futureCandles.slice(0, fb);
      if (slice.length === 0) continue;
      const hi = Math.max(...slice.map(c => c.high));
      const lo = Math.min(...slice.map(c => c.low));
      mfeArr[fb].push((hi - entry) / entry);
      maeArr[fb].push((lo - entry) / entry);
    }

    // ── time to target / adverse hit ──
    let reached: Record<number, boolean> = {};
    let adverseHit: Record<number, boolean> = {};
    for (const tp of TP_LEVELS)  reached[tp]     = false;
    for (const sl of ADV_THRESH) adverseHit[sl]  = false;

    for (let b = 0; b < futureCandles.length; b++) {
      const c = futureCandles[b];
      const hiRet = (c.high - entry) / entry;
      const loRet = (c.low  - entry) / entry;
      for (const tp of TP_LEVELS) {
        if (!reached[tp] && hiRet >= tp) { reached[tp] = true; tpTimes[tp].push(b + 1); tpHits[tp]++; }
      }
      for (const sl of ADV_THRESH) {
        if (!adverseHit[sl] && loRet <= -sl) { adverseHit[sl] = true; slHits[sl]++; }
      }
    }

    // ── TP/SL matrix (first-touch) ──
    for (const tp of TP_LEVELS) for (const sl of SL_LEVELS) {
      const key = `${tp}|${sl}`;
      let tpBar = Infinity, slBar = Infinity;
      let tpPrice = 0, slPrice = 0;
      for (let b = 0; b < futureCandles.length; b++) {
        const c = futureCandles[b];
        const hiRet = (c.high - entry) / entry;
        const loRet = (c.low  - entry) / entry;
        if (tpBar === Infinity && hiRet >= tp) { tpBar = b; tpPrice = entry * (1 + tp); }
        if (slBar === Infinity && loRet <= -sl) { slBar = b; slPrice = entry * (1 - sl); }
        if (tpBar !== Infinity || slBar !== Infinity) break;
      }
      const acc = matrixAcc[key];
      if (tpBar === Infinity && slBar === Infinity) continue; // neither hit — skip
      acc.trades++;
      if (tpBar < slBar) { acc.wins++; acc.sumW += tp; }
      else if (slBar < tpBar) { acc.losses++; acc.sumL += sl; }
      else { acc.ambig++; } // same candle
    }
  }

  // ── reduce ──
  const mfeMean: Record<number, number> = {};
  const maeMean: Record<number, number> = {};
  const mfeMedian: Record<number, number> = {};
  const maeMedian: Record<number, number> = {};

  for (const fb of FW_BARS) {
    mfeMean[fb] = avg(mfeArr[fb]);
    maeMean[fb] = avg(maeArr[fb]);
    mfeMedian[fb] = median(mfeArr[fb]);
    maeMedian[fb] = median(maeArr[fb]);
  }

  const timeToTargetMedian: Record<number, number | null> = {};
  const tpHitRate: Record<number, number> = {};
  for (const tp of TP_LEVELS) {
    tpHitRate[tp] = tpHits[tp] / n;
    timeToTargetMedian[tp] = tpTimes[tp].length ? median(tpTimes[tp]) : null;
  }

  const slHitRate: Record<number, number> = {};
  for (const sl of ADV_THRESH) slHitRate[sl] = slHits[sl] / n;

  const tpSlMatrix: Record<string, any> = {};
  for (const tp of TP_LEVELS) for (const sl of SL_LEVELS) {
    const key = `${tp}|${sl}`;
    const acc  = matrixAcc[key];
    tpSlMatrix[`tp${pct(tp)}_sl${pct(sl)}`] = {
      winRate:  acc.trades ? acc.wins / acc.trades : 0,
      avgWin:   acc.wins   ? acc.sumW / acc.wins   : 0,
      avgLoss:  acc.losses ? acc.sumL / acc.losses : 0,
      ambiguous: acc.ambig,
      trades:   acc.trades,
    };
  }

  return { observations: n, mfeMean, maeMean, mfeMedian, maeMedian, timeToTargetMedian, tpHitRate, slHitRate, tpSlMatrix };
}

function emptyStats(): EventStats {
  const z: any = {};
  for (const fb of FW_BARS) { z[fb] = 0; }
  return { observations: 0, mfeMean: z, maeMean: z, mfeMedian: z, maeMedian: z,
           timeToTargetMedian: {}, tpHitRate: {}, slHitRate: {}, tpSlMatrix: {} };
}

function avg(arr: number[]) { return arr.length ? arr.reduce((s,v) => s+v, 0) / arr.length : 0; }
function median(arr: number[]) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b) => a-b);
  const m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}
function pct(v: number) { return (v*100).toFixed(2); }

// ─── cost model ─────────────────────────────────────────────────────────────
const COST_CONFIGS = {
  default:  { feePct: 0.002, slippagePct: 0.001 },  // 0.20% + 0.10% each side
  higher:   { feePct: 0.003, slippagePct: 0.002 },
  lower:    { feePct: 0.001, slippagePct: 0.0005 },
};
function roundTripCost(cfg: { feePct: number; slippagePct: number }) {
  return (cfg.feePct + cfg.slippagePct) * 2;
}

// ─── main ────────────────────────────────────────────────────────────────────
async function run() {
  console.log("Loading data...");
  const dataPath = path.join(__dirname, '../../public/data/btc-inr-90d-1m.json');
  const raw1m: Candle[] = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`Loaded ${raw1m.length} 1-minute candles`);

  const results: any = { hypothesisA: {}, hypothesisB: {}, costAnalysis: {} };

  // Timeframe configs
  const tfCfg: { label: string; minutes: number }[] = [
    { label: '5m',  minutes: 5  },
    { label: '15m', minutes: 15 },
    { label: '30m', minutes: 30 },
    { label: '1h',  minutes: 60 },
  ];

  for (const { label, minutes } of tfCfg) {
    console.log(`Processing Hypothesis A — Mean Reversion — ${label}...`);
    const candles = aggregateCandles(raw1m, minutes);
    const smaVals = Array.from(calculateSMA(candles, 20));
    const FW_MAX  = 80;

    // Collect events — full dataset and per-third
    const thirds = [
      [0,      Math.floor(candles.length / 3)],
      [Math.floor(candles.length / 3), Math.floor(2 * candles.length / 3)],
      [Math.floor(2 * candles.length / 3), candles.length],
    ];

    const collectMR = (from: number, to: number) => {
      const events: { entry: number; futureCandles: Candle[] }[] = [];
      for (let i = from; i < to - FW_MAX - 1; i++) {
        const sma = smaVals[i];
        if (!sma) continue;
        const dist = (candles[i].close - sma) / sma;
        if (dist >= -0.01 && dist <= -0.005) {  // -0.50% to -1.00% below SMA20
          events.push({ entry: candles[i].close, futureCandles: candles.slice(i + 1, i + 1 + FW_MAX) });
        }
      }
      return events;
    };

    const allEvents = collectMR(20, candles.length);
    const stats     = computeEventStats(allEvents);

    const thirdStats = thirds.map(([from, to]) => computeEventStats(collectMR(Math.max(from, 20), to)));

    results.hypothesisA[label] = { stats, thirds: thirdStats };
  }

  // ── Hypothesis B — Extreme Downside Momentum (<-1%) ──────────────────────
  const bTfCfg = [
    { label: '5m',  minutes: 5  },
    { label: '30m', minutes: 30 },
    { label: '1h',  minutes: 60 },
  ];

  for (const { label, minutes } of bTfCfg) {
    console.log(`Processing Hypothesis B — Extreme Downside Momentum — ${label}...`);
    const candles  = aggregateCandles(raw1m, minutes);
    const FW_MAX   = 80;
    const thirds   = [
      [0, Math.floor(candles.length/3)],
      [Math.floor(candles.length/3), Math.floor(2*candles.length/3)],
      [Math.floor(2*candles.length/3), candles.length],
    ];

    const collectMom = (from: number, to: number) => {
      const events: { entry: number; futureCandles: Candle[] }[] = [];
      for (let i = from; i < to - FW_MAX - 1; i++) {
        const prev3ret = (candles[i].close - candles[i-3].close) / candles[i-3].close;
        if (prev3ret <= -0.01) {  // prior 3-bar move <= -1%
          events.push({ entry: candles[i].close, futureCandles: candles.slice(i + 1, i + 1 + FW_MAX) });
        }
      }
      return events;
    };

    const allEvents = collectMom(3, candles.length);
    const stats     = computeEventStats(allEvents);
    const thirdStats = thirds.map(([from, to]) => computeEventStats(collectMom(Math.max(from, 3), to)));

    results.hypothesisB[label] = { stats, thirds: thirdStats };
  }

  // ── cost analysis ─────────────────────────────────────────────────────────
  for (const [name, cfg] of Object.entries(COST_CONFIGS)) {
    results.costAnalysis[name] = {
      feePct:       cfg.feePct * 100,
      slippagePct:  cfg.slippagePct * 100,
      roundTripCost: roundTripCost(cfg) * 100,
    };
  }

  // ── write outputs ─────────────────────────────────────────────────────────
  const outDir = path.join(__dirname);
  fs.writeFileSync(path.join(outDir, 'tradeability-results.json'), JSON.stringify(results, null, 2));
  console.log("JSON saved.");

  // CSV summary
  let csv = "Hypothesis,Timeframe,Observations,MFE_1b,MFE_5b,MFE_10b,MFE_20b,MAE_1b,MAE_5b,MAE_10b,MAE_20b,TP0.5%Hit,TP1.0%Hit,SL0.5%Hit,SL1.0%Hit\n";
  for (const [tf, d] of Object.entries<any>(results.hypothesisA)) {
    const s = d.stats;
    csv += `MeanRev,${tf},${s.observations},${pct(s.mfeMean[1])},${pct(s.mfeMean[5])},${pct(s.mfeMean[10])},${pct(s.mfeMean[20])},${pct(s.maeMean[1])},${pct(s.maeMean[5])},${pct(s.maeMean[10])},${pct(s.maeMean[20])},${(s.tpHitRate[0.005]*100).toFixed(1)}%,${(s.tpHitRate[0.01]*100).toFixed(1)}%,${(s.slHitRate[0.005]*100).toFixed(1)}%,${(s.slHitRate[0.01]*100).toFixed(1)}%\n`;
  }
  for (const [tf, d] of Object.entries<any>(results.hypothesisB)) {
    const s = d.stats;
    csv += `MomRevert,${tf},${s.observations},${pct(s.mfeMean[1])},${pct(s.mfeMean[5])},${pct(s.mfeMean[10])},${pct(s.mfeMean[20])},${pct(s.maeMean[1])},${pct(s.maeMean[5])},${pct(s.maeMean[10])},${pct(s.maeMean[20])},${(s.tpHitRate[0.005]*100).toFixed(1)}%,${(s.tpHitRate[0.01]*100).toFixed(1)}%,${(s.slHitRate[0.005]*100).toFixed(1)}%,${(s.slHitRate[0.01]*100).toFixed(1)}%\n`;
  }
  fs.writeFileSync(path.join(outDir, 'tradeability-summary.csv'), csv);
  console.log("CSV saved.");
  console.log("Done. Run report generator next.");
}

run().catch(console.error);

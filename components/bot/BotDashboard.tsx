"use client";
import React, { useEffect, useState, useRef } from 'react';

// Removed durations array since we'll run from terminal

export function BotDashboard() {
  const [ask, setAsk] = useState<number | null>(null);
  const [bid, setBid] = useState<number | null>(null);

  const [botState, setBotState] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);

  // UI Control States
  const [inputDuration, setInputDuration] = useState(15);
  const [inputCapital, setInputCapital] = useState(1000);
  const [isStarting, setIsStarting] = useState(false);
  const [timeLeftStr, setTimeLeftStr] = useState<string>('--:--');
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);

  // Price Tracker state
  const [priceHistory, setPriceHistory] = useState<{ time: Date, ask: number, bid: number }[]>([]);
  const askRef = useRef(ask);
  const bidRef = useRef(bid);

  useEffect(() => { askRef.current = ask; }, [ask]);
  useEffect(() => { bidRef.current = bid; }, [bid]);

  // Poll Bot State to get Live Trades and Signals
  useEffect(() => {
    let isCancelled = false;
    let timerId: NodeJS.Timeout;

    const fetchState = async () => {
      if (isCancelled) return;
      try {
        const res = await fetch('/api/bot/state');
        if (res.ok) {
          const json = await res.json();
          const data = json.state;
          setBotState(data);

          if (json.isRunning) {
            setIsRunning(true);
            if (data && data.startTime && data.durationMs) {
              const elapsed = Date.now() - data.startTime;
              const leftMs = Math.max(0, data.durationMs - elapsed);
              const m = Math.floor(leftMs / 60000);
              const s = Math.floor((leftMs % 60000) / 1000);
              setTimeLeftStr(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
            } else {
              setTimeLeftStr('BOOT...');
            }
          } else {
            setIsRunning(false);
            setTimeLeftStr('--:--');
          }
          if (data && data.currentAsk && data.currentBid) {
            setAsk(data.currentAsk);
            setBid(data.currentBid);
          }
        } else {
          setIsRunning(false);
          setTimeLeftStr('--:--');
        }
      } catch (e) {
        setIsRunning(false);
        setTimeLeftStr('--:--');
      } finally {
        if (!isCancelled) {
          timerId = setTimeout(fetchState, 1000);
        }
      }
    };
    
    fetchState();
    
    return () => {
      isCancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  // Capture price every 30 seconds for the UI tracker
  useEffect(() => {
    const captureIv = setInterval(() => {
      if (askRef.current && bidRef.current) {
        setPriceHistory(prev => {
          const newEntry = { time: new Date(), ask: askRef.current!, bid: bidRef.current! };
          // Keep last 60 entries (30 minutes)
          return [newEntry, ...prev].slice(0, 60);
        });
      }
    }, 30000);
    return () => clearInterval(captureIv);
  }, []);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationMs: inputDuration * 60 * 1000,
          startBalanceInr: inputCapital
        })
      });
    } catch (e) { }
    setTimeout(() => setIsStarting(false), 2000);
  };

  const handleStop = async () => {
    try { await fetch('/api/bot/stop', { method: 'POST' }); } catch (e) { }
  };

  return (
    <div className="flex-1 flex flex-col p-6 bg-[#0B0E11] text-white overflow-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-green-400">PHASE 51: ETH SCALPER</h1>
          <p className="text-gray-400 mt-1">Automated Imbalance Trading Engine</p>
        </div>
        <div className="flex gap-6 bg-[#181A20] p-4 rounded-xl border border-gray-800 shadow-lg">
          <div className="text-center">
            <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Best Bid</div>
            <div className="text-xl text-green-500 font-mono font-bold mt-1">${bid?.toFixed(2) || '---'}</div>
          </div>
          <div className="w-px bg-gray-800"></div>
          <div className="text-center">
            <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Best Ask</div>
            <div className="text-xl text-red-500 font-mono font-bold mt-1">${ask?.toFixed(2) || '---'}</div>
          </div>
        </div>
      </div>

      {/* Status Panel */}
      <div className="bg-[#181A20] rounded-xl border border-gray-800 p-6 mb-8 shadow-xl">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2">
            Engine Status
            {isRunning ? (
              <span className="px-3 py-1 bg-green-500/20 text-green-400 text-xs rounded-full border border-green-500/30 animate-pulse flex items-center gap-1.5">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div> ONLINE &nbsp;<span className="text-gray-400 text-[10px] uppercase tracking-wider">Session Left:</span>&nbsp;{timeLeftStr}
              </span>
            ) : (
              <span className="px-3 py-1 bg-gray-800 text-gray-400 text-xs rounded-full border border-gray-700">OFFLINE - RUN FROM TERMINAL</span>
            )}
          </h2>

          {!isRunning && (
            <div className="flex items-center gap-4">
              <div className="flex items-center bg-gray-900 rounded-lg border border-gray-700 px-3 py-1.5">
                <span className="text-gray-500 text-xs mr-2 uppercase">Duration (Min)</span>
                <input
                  type="number"
                  value={inputDuration}
                  onChange={e => setInputDuration(Number(e.target.value))}
                  className="bg-transparent text-white font-mono w-16 text-right outline-none"
                />
              </div>
              <div className="flex items-center bg-gray-900 rounded-lg border border-gray-700 px-3 py-1.5">
                <span className="text-gray-500 text-xs mr-2 uppercase">Capital (₹)</span>
                <input
                  type="number"
                  value={inputCapital}
                  onChange={e => setInputCapital(Number(e.target.value))}
                  className="bg-transparent text-white font-mono w-24 text-right outline-none"
                />
              </div>
              <button
                onClick={handleStart}
                disabled={isStarting}
                className="bg-green-600 hover:bg-green-500 text-white font-bold py-1.5 px-6 rounded-lg uppercase text-sm tracking-wider transition-colors disabled:opacity-50"
              >
                {isStarting ? 'Starting...' : 'Start Engine'}
              </button>
            </div>
          )}

          {isRunning && (
            <div className="flex items-center gap-6">
              {botState?.liveMetrics && (
                <div className="flex gap-4">
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Imbalance</span>
                    <span className={`text-sm font-mono font-bold ${botState.liveMetrics.imbalanceSide === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>
                      {botState.liveMetrics.imbalance.toFixed(2)}x {botState.liveMetrics.imbalanceSide}
                    </span>
                  </div>
                  <div className="w-px bg-gray-800"></div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Micro Edge</span>
                    <span className={`text-sm font-mono font-bold ${botState.liveMetrics.microEdgePct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {botState.liveMetrics.microEdgePct.toFixed(5)}%
                    </span>
                  </div>
                  <div className="w-px bg-gray-800"></div>
                  <div className="flex flex-col text-left">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Brain</span>
                    <span className="text-sm font-mono font-bold text-yellow-400">
                      {botState.liveMetrics.engineStatus || 'WAITING...'}
                    </span>
                  </div>
                </div>
              )}
              <button
                onClick={handleStop}
                className="bg-red-900/50 hover:bg-red-600 text-red-200 border border-red-800 font-bold py-1.5 px-6 rounded-lg uppercase text-sm tracking-wider transition-colors"
              >
                KILL ENGINE
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ENTRY OPPORTUNITY PANEL */}
      {(() => {
        const pf = botState?.priceFilter;
        const logic = { aggImbRatio: 2.5, edgePctThreshold: 0.0001, momentumThreshold: 0.005, maxSpreadPct: 0.02 };

        if (!isRunning && !pf) return null;

        const isLong = pf?.direction === 'LONG';
        const dirColor = isLong ? 'text-green-400' : 'text-red-400';
        const dirBg    = isLong ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10';

        // Determine zone status
        let zoneStatus = 'WAITING';
        let zoneStatusColor = 'text-yellow-400';
        let finalDecision = 'WAITING FOR PRICE';
        if (pf?.expired)        { zoneStatus = 'EXPIRED';  zoneStatusColor = 'text-gray-500'; finalDecision = 'ENTRY CANCELLED'; }
        else if (pf?.inZone)    { zoneStatus = 'REACHED';  zoneStatusColor = 'text-green-400'; finalDecision = 'ENTRY EXECUTING'; }

        // Live recheck conditions (using same logic.xxx thresholds as runner)
        const lm = pf?.liveMetrics;
        const imbPass  = pf && lm ? (pf.direction === 'LONG' ? lm.imbalanceSide === 'BUY'  && lm.imbalance >= logic.aggImbRatio
                                                              : lm.imbalanceSide === 'SELL' && lm.imbalance >= logic.aggImbRatio) : false;
        const edgePass  = pf && lm ? (pf.direction === 'LONG' ? lm.microEdgePct >= logic.edgePctThreshold
                                                               : lm.microEdgePct <= -logic.edgePctThreshold) : false;
        const momPass   = pf && lm ? (pf.direction === 'LONG' ? lm.momentum >= logic.momentumThreshold
                                                              : lm.momentum <= -logic.momentumThreshold) : false;
        const spdPass   = pf && lm ? lm.spreadPct <= logic.maxSpreadPct : false;

        const badge = (pass: boolean, yesLabel = 'PASS', noLabel = 'FAIL') => (
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${pass ? 'bg-green-900/40 text-green-400 border border-green-800' : 'bg-red-900/40 text-red-400 border border-red-800'}`}>
            {pass ? yesLabel : noLabel}
          </span>
        );

        const Row = ({ label, value, valueClass = 'text-white' }: { label: string; value: React.ReactNode; valueClass?: string }) => (
          <div className="flex justify-between items-center py-1.5 border-b border-gray-800/50">
            <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">{label}</span>
            <span className={`text-xs font-mono font-bold ${valueClass}`}>{value}</span>
          </div>
        );

        return (
          <div className={`rounded-xl border p-5 mb-6 shadow-xl ${pf ? dirBg : 'border-gray-800 bg-[#181A20]'}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                ENTRY OPPORTUNITY
                {pf && <span className={`text-sm font-mono ${dirColor}`}>{pf.direction}</span>}
                {pf && !pf.expired && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-900/40 text-yellow-400 border border-yellow-800 animate-pulse">
                    {pf.inZone ? '⚡ ZONE REACHED' : '⏳ WAITING'}
                  </span>
                )}
                {pf?.expired && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-500 border border-gray-700">EXPIRED</span>}
              </h2>
              {pf && !pf.expired && (
                <div className="flex gap-4 font-mono text-sm">
                  <div className="text-center">
                    <div className="text-[10px] text-gray-500 uppercase">Zone Elapsed</div>
                    <div className="text-yellow-400 font-bold">{(pf.elapsedMs / 1000).toFixed(0)}s</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] text-gray-500 uppercase">Zone Remaining</div>
                    <div className={`font-bold ${pf.remainingMs < 10000 ? 'text-red-400' : 'text-white'}`}>{(pf.remainingMs / 1000).toFixed(0)}s</div>
                  </div>
                </div>
              )}
            </div>

            {!pf ? (
              <div className="text-center py-8 text-gray-600 italic text-sm">NO ACTIVE ENTRY SIGNAL</div>
            ) : pf.expired ? (
              <div className="text-center py-8 text-gray-500 font-mono text-sm">⛔ ENTRY CANCELLED — PRICE ZONE NOT REACHED</div>
            ) : (
              <div className="grid grid-cols-2 gap-x-8">
                {/* LEFT COLUMN — Price filter details */}
                <div>
                  <div className="text-[10px] text-gray-600 uppercase font-bold mb-2 tracking-widest">Price Filter</div>
                  <Row label="Direction"     value={pf.direction} valueClass={dirColor} />
                  <Row label="Signal Price"  value={`$${pf.signalPrice?.toFixed(2)}`} />
                  <Row label={pf.direction === 'SHORT' ? 'Reference High' : 'Reference Low'}
                       value={`$${pf.referencePrice?.toFixed(2)}`} valueClass="text-gray-300" />
                  <Row label="Zone Low"      value={`$${pf.zoneLow?.toFixed(2)}`} valueClass="text-yellow-400" />
                  <Row label="Zone High"     value={`$${pf.zoneHigh?.toFixed(2)}`} valueClass="text-yellow-400" />
                  <Row label="Current Price" value={`$${pf.currentPrice?.toFixed(2)}`} valueClass={pf.inZone ? 'text-green-400' : 'text-white'} />
                  <Row label="Distance To Zone" value={pf.distancePct != null ? `${pf.distancePct.toFixed(4)}%` : '---'} valueClass="text-gray-300" />
                  <Row label="Zone Status"   value={zoneStatus} valueClass={zoneStatusColor} />
                  <Row label="Final Decision" value={finalDecision}
                       valueClass={finalDecision === 'ENTRY EXECUTING' ? 'text-green-400' : finalDecision === 'ENTRY CANCELLED' ? 'text-gray-500' : 'text-yellow-400'} />
                </div>

                {/* RIGHT COLUMN — Live strategy conditions */}
                <div>
                  <div className="text-[10px] text-gray-600 uppercase font-bold mb-2 tracking-widest">Strategy Conditions (Live)</div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-800/50">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Imbalance</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-300">{lm?.imbalance?.toFixed(2)}x</span>
                      {badge(imbPass)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-800/50">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Edge</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-300">{lm?.microEdgePct?.toFixed(5)}%</span>
                      {badge(edgePass)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-800/50">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Momentum</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-300">{lm?.momentum?.toFixed(4)}%</span>
                      {badge(momPass)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-800/50">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Spread</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-300">{lm?.spreadPct?.toFixed(4)}%</span>
                      {badge(spdPass)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-800/50">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Historical Filter</span>
                    {badge(true, 'PASS', 'FAIL')}
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-gray-800/50">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Price Zone</span>
                    {badge(pf.inZone, 'REACHED', 'WAITING')}
                  </div>
                  <div className="flex justify-between items-center py-1.5">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Timing Window</span>
                    {badge(!pf.expired, 'OPEN', 'EXPIRED')}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Active Trades */}

      <div className="bg-[#181A20] rounded-xl border border-gray-800 p-6 shadow-xl flex-1 flex flex-col">
        <div className="flex justify-between items-end mb-6">
          <h2 className="text-lg font-bold">Live Trade Log</h2>
          {botState && (() => {
            const dynamicStartBalanceUsdt = botState.startBalanceInr ? botState.startBalanceInr / 86 : 1000 / 86;
            return (
              <div className="flex gap-6 text-sm">
                <div className="flex flex-col text-right">
                  <span className="text-gray-500 uppercase tracking-wider text-[10px] font-bold">Start Capital</span>
                  <span className="font-mono text-gray-300">₹{botState.startBalanceInr ? botState.startBalanceInr.toLocaleString() : '1,000'} <span className="text-gray-600">(${dynamicStartBalanceUsdt.toFixed(2)})</span></span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-gray-500 uppercase tracking-wider text-[10px] font-bold">Available Margin</span>
                  <span className="font-mono text-blue-400 font-bold">${(botState?.portfolio?.balanceUsdt - (botState?.portfolio?.usedMarginUsdt || 0)).toFixed(2) || '0.00'}</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-gray-500 uppercase tracking-wider text-[10px] font-bold">Session P&L</span>
                  {(() => {
                    const realizedPnl = (botState?.portfolio?.balanceUsdt || dynamicStartBalanceUsdt) - dynamicStartBalanceUsdt;
                    // Add unrealized P&L from all live open positions
                    const openPositions = botState?.candidates?.CONFLUENCE?.positions || [];
                    const unrealizedPnl = openPositions.reduce((sum: number, p: any) => {
                      const currentPrice = p.dir === 'LONG' ? (botState?.currentBid || p.entryPrice) : (botState?.currentAsk || p.entryPrice);
                      const gross = p.dir === 'LONG' ? (currentPrice - p.entryPrice) * p.qty : (p.entryPrice - currentPrice) * p.qty;
                      const fee = (p.entryFee || 0) + (currentPrice * p.qty * 0.001);
                      return sum + gross - fee;
                    }, 0);
                    const totalPnl = realizedPnl + unrealizedPnl;
                    return (
                      <span className={`font-mono font-bold ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(4)}
                        {unrealizedPnl !== 0 && (
                          <span className="text-[10px] text-gray-500 ml-1">(+${unrealizedPnl.toFixed(4)} live)</span>
                        )}
                      </span>
                    );
                  })()}
                </div>
              </div>
            );
          })()}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="pb-3 font-medium">Trade #</th>
                <th className="pb-3 font-medium">Direction</th>
                <th className="pb-3 font-medium">Reason</th>
                <th className="pb-3 font-medium">Entry Price</th>
                <th className="pb-3 font-medium">TP Price</th>
                <th className="pb-3 font-medium">SL Price</th>
                <th className="pb-3 font-medium">Entry Time</th>
                <th className="pb-3 font-medium">Exit Price</th>
                <th className="pb-3 font-medium">Hold (s)</th>
                <th className="pb-3 font-medium">Fee</th>
                <th className="pb-3 font-medium text-right">Net P&L</th>
                <th className="pb-3 font-medium pl-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="text-sm font-mono">
              {(() => {
                let displayTrades = botState?.allTrades ? [...botState.allTrades] : [];

                // Inject Open Positions
                if (botState?.candidates?.CONFLUENCE?.positions) {
                  const openPos = botState.candidates.CONFLUENCE.positions;
                  openPos.forEach((p: any, idx: number) => {
                    const currentPrice = p.dir === 'LONG' ? botState.currentBid : botState.currentAsk;
                    const grossPnl = p.dir === 'LONG' ? (currentPrice - p.entryPrice) * p.qty : (p.entryPrice - currentPrice) * p.qty;
                    const exitFee = (currentPrice * p.qty) * 0.001; // Taker fee estimation
                    const totalFee = (p.entryFee || p.entryFeeUsdt || 0) + exitFee;
                    const netPnl = grossPnl - totalFee;
                    const holdMs = Date.now() - p.entryTs;

                    displayTrades.push({
                      tradeId: 'OPEN-' + p.entryTs,
                      positionIndex: idx,
                      direction: p.dir,
                      entryReason: p.reason || 'LIVE',
                      entryPrice: p.entryPrice,
                      tpPrice: p.tpPrice,
                      slPrice: p.slPrice,
                      entryTime: p.entryTs,
                      exitPrice: currentPrice, // Dynamic live exit price
                      holdDurationMs: holdMs,
                      feesUsdt: totalFee,
                      netPnlUsdt: netPnl,
                      exitReason: null,
                      status: 'OPEN'
                    });
                  });
                }

                if (displayTrades.length === 0) {
                  return (
                    <tr>
                      <td colSpan={12} className="text-center py-12 text-gray-600 italic">No trades in current session.</td>
                    </tr>
                  );
                }

                // Sort so newest are on top (Open trades will automatically go to top since they were added last)
                displayTrades.sort((a, b) => b.entryTime - a.entryTime);

                return displayTrades.map((t: any, idx: number) => (
                  <React.Fragment key={`${t.tradeId}-${idx}`}>
                    <tr 
                      onClick={() => setExpandedTradeId(expandedTradeId === t.tradeId ? null : t.tradeId)}
                      className={`border-b border-gray-800/50 hover:bg-white/[0.02] cursor-pointer transition-colors ${t.status === 'OPEN' ? 'bg-blue-900/10' : ''}`}
                    >
                      <td className="py-3 text-gray-400 flex items-center gap-2">
                        <span className="text-[10px] text-gray-600">{expandedTradeId === t.tradeId ? '▼' : '▶'}</span>
                        {t.tradeId}
                      </td>
                      <td className={`py-3 font-bold ${t.direction === 'LONG' ? 'text-green-500' : 'text-red-500'}`}>{t.direction}</td>
                      <td className="py-3 text-[10px] text-gray-400 max-w-[150px] truncate" title={t.entryReason}>{t.entryReason || '---'}</td>
                      <td className="py-3">${t.entryPrice.toFixed(2)}</td>
                      <td className="py-3 text-gray-400">${t.tpPrice ? t.tpPrice.toFixed(2) : '---'}</td>
                      <td className="py-3 text-gray-400">${t.slPrice ? t.slPrice.toFixed(2) : '---'}</td>
                      <td className="py-3 text-gray-400">{new Date(t.entryTime).toLocaleTimeString()}</td>
                      <td className="py-3">{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '---'}</td>
                      <td className="py-3 text-gray-400">{t.exitPrice ? (t.holdDurationMs / 1000).toFixed(1) : '---'}</td>
                      <td className="py-3 text-gray-500">${t.feesUsdt ? t.feesUsdt.toFixed(4) : (t.entryFeeUsdt ? t.entryFeeUsdt.toFixed(4) : '0.0000')}</td>
                      <td className={`py-3 text-right font-bold ${t.netPnlUsdt >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {t.netPnlUsdt != null ? `$${t.netPnlUsdt.toFixed(4)}` : '---'}
                      </td>
                      <td className="py-3 pl-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <span className={`px-2 py-1 text-[10px] uppercase rounded ${t.status === 'COMPLETED_TRADE' ? (t.exitReason === 'TP' ? 'bg-green-900/30 text-green-500 border border-green-900' : t.exitReason === 'MANUAL_CLOSE' ? 'bg-purple-900/30 text-purple-400 border border-purple-900' : 'bg-red-900/30 text-red-500 border border-red-900') : 'bg-blue-900/30 text-blue-400 border border-blue-900 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.3)]'}`}>
                            {t.status === 'OPEN' ? 'LIVE' : t.exitReason}
                          </span>
                          {t.status === 'OPEN' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                fetch('/api/bot/close-position', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ tradeId: t.positionIndex })
                                });
                              }}
                              className="px-2 py-1 text-[10px] uppercase rounded bg-red-900/50 text-red-400 border border-red-700 hover:bg-red-700 hover:text-white transition-colors"
                            >
                              ✕ Close
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    
                    {expandedTradeId === t.tradeId && (
                      <tr className="bg-[#0f1115] border-b border-gray-800">
                        <td colSpan={12} className="p-4">
                          <div className="flex gap-12 text-xs">
                            {/* Execution Forensics */}
                            <div>
                              <div className="text-gray-500 font-bold mb-2 uppercase tracking-wider text-[10px]">Execution Data</div>
                              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-gray-300">
                                <div>Signal Price:</div><div className="text-white">${t.analytics?.priceFilter?.signalPrice?.toFixed(2) || '---'}</div>
                                <div>Imbalance:</div><div className="text-white">{t.analytics?.aggregateImbalance?.toFixed(2) || '---'}x</div>
                                <div>Micro Edge:</div><div className="text-white">{t.analytics?.microEdgePct != null ? (t.analytics.microEdgePct * 100).toFixed(4) + '%' : '---'}</div>
                                <div>Momentum:</div><div className="text-white">{t.analytics?.momentum1sPct != null ? (t.analytics.momentum1sPct * 100).toFixed(4) + '%' : '---'}</div>
                                <div>Spread:</div><div className="text-white">{t.analytics?.spreadPct != null ? (t.analytics.spreadPct * 100).toFixed(4) + '%' : '---'}</div>
                              </div>
                            </div>
                            
                            {/* Excursion Forensics */}
                            <div>
                              <div className="text-gray-500 font-bold mb-2 uppercase tracking-wider text-[10px]">Trade Path</div>
                              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-gray-300">
                                <div>Max Fav. Excursion (MFE):</div><div className="text-green-400">{t.MFE != null ? '$' + t.MFE.toFixed(2) : '---'}</div>
                                <div>Max Adv. Excursion (MAE):</div><div className="text-red-400">{t.MAE != null ? '$' + t.MAE.toFixed(2) : '---'}</div>
                                <div>Entry Fee:</div><div className="text-gray-400">{t.entryFeeUsdt != null ? '$' + t.entryFeeUsdt.toFixed(4) : '---'}</div>
                                <div>Exit Fee:</div><div className="text-gray-400">{t.exitFeeUsdt != null ? '$' + t.exitFeeUsdt.toFixed(4) : '---'}</div>
                              </div>
                            </div>

                            {/* Historical Forensics */}
                            <div>
                              <div className="text-gray-500 font-bold mb-2 uppercase tracking-wider text-[10px]">Historical Context</div>
                              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-gray-300">
                                <div>Continuation:</div><div className="text-white">{t.analytics?.historical?.continuationPct != null ? (t.analytics.historical.continuationPct * 100).toFixed(1) + '%' : '---'}</div>
                                <div>Reversal:</div><div className="text-white">{t.analytics?.historical?.reversalPct != null ? (t.analytics.historical.reversalPct * 100).toFixed(1) + '%' : '---'}</div>
                                <div>Sideways:</div><div className="text-white">{t.analytics?.historical?.sidewaysPct != null ? (t.analytics.historical.sidewaysPct * 100).toFixed(1) + '%' : '---'}</div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* 30-Second Price Tracker */}
      <div className="bg-[#181A20] rounded-xl border border-gray-800 p-6 shadow-xl flex-1 flex flex-col mt-6 max-h-96">
        <h2 className="text-lg font-bold mb-6">30s Price Tracker</h2>
        <div className="overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800 sticky top-0 bg-[#181A20]">
                <th className="pb-3 font-medium">Time</th>
                <th className="pb-3 font-medium">Ask Price</th>
                <th className="pb-3 font-medium">Bid Price</th>
                <th className="pb-3 font-medium">Spread</th>
              </tr>
            </thead>
            <tbody className="text-sm font-mono">
              {priceHistory.length > 0 ? (
                priceHistory.map((h, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-white/[0.02]">
                    <td className="py-2 text-gray-400">{h.time.toLocaleTimeString()}</td>
                    <td className="py-2 text-red-400">${h.ask.toFixed(2)}</td>
                    <td className="py-2 text-green-400">${h.bid.toFixed(2)}</td>
                    <td className="py-2 text-gray-500">${(h.ask - h.bid).toFixed(2)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="text-center py-6 text-gray-600 italic">Waiting for 30s interval...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

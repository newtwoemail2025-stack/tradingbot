'use client';

import React, { useEffect, useRef } from 'react';
import { BacktestMetrics } from '../../types/strategy';
import { createChart, IChartApi, ISeriesApi, Time, LineSeries } from 'lightweight-charts';

interface Props {
  metrics: BacktestMetrics | null;
}

export const BacktestResultsPanel: React.FC<Props> = ({ metrics }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || !metrics || metrics.equityCurve.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#030712' }, 
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: '#1F2937' },
        horzLines: { color: '#1F2937' },
      },
      height: 300,
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#818cf8',
      lineWidth: 2,
    });

    const formattedData = metrics.equityCurve.map(pt => ({
      time: pt.time as Time,
      value: pt.value
    }));

    // deduplicate times (lightweight charts throws error on duplicate times)
    const deduped: {time: Time, value: number}[] = [];
    const seen = new Set<Time>();
    for (const item of formattedData) {
      if (!seen.has(item.time)) {
        seen.add(item.time);
        deduped.push(item);
      }
    }

    lineSeries.setData(deduped);
    chart.timeScale().fitContent();

    chartRef.current = chart;

    return () => {
      chart.remove();
    };
  }, [metrics]);

  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Run a backtest to see results
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-6 h-full overflow-y-auto pr-2">
      {/* KPI Grid */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded p-4">
          <div className="text-xs text-gray-400">Net Profit</div>
          <div className={`text-xl font-bold ${metrics.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {metrics.netProfit >= 0 ? '+' : ''}₹{metrics.netProfit.toLocaleString('en-IN', {maximumFractionDigits: 2})}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded p-4">
          <div className="text-xs text-gray-400">Return</div>
          <div className={`text-xl font-bold ${metrics.netReturnPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {metrics.netReturnPercent >= 0 ? '+' : ''}{metrics.netReturnPercent.toFixed(2)}%
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded p-4">
          <div className="text-xs text-gray-400">Win Rate</div>
          <div className="text-xl font-bold text-white">
            {metrics.winRate.toFixed(1)}%
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded p-4">
          <div className="text-xs text-gray-400">Max Drawdown</div>
          <div className="text-xl font-bold text-red-500">
            {metrics.maxDrawdownPercent.toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded p-3">
          <div className="text-xs text-gray-400">Profit Factor</div>
          <div className="text-sm font-semibold text-white">{metrics.profitFactor.toFixed(2)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded p-3">
          <div className="text-xs text-gray-400">Total Trades</div>
          <div className="text-sm font-semibold text-white">{metrics.totalTrades}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded p-3">
          <div className="text-xs text-gray-400">Total Fees</div>
          <div className="text-sm font-semibold text-red-400">₹{metrics.totalFees.toFixed(2)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded p-3">
          <div className="text-xs text-gray-400">Total Slippage</div>
          <div className="text-sm font-semibold text-red-400">₹{metrics.totalSlippage.toFixed(2)}</div>
        </div>
      </div>

      {/* Equity Curve */}
      <div className="bg-gray-900 border border-gray-800 rounded p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">EQUITY CURVE</h3>
        <div ref={chartContainerRef} className="w-full h-[300px]" />
      </div>

      {/* Trade History */}
      <div className="bg-gray-900 border border-gray-800 rounded p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">TRADE HISTORY</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-400">
            <thead className="text-xs text-gray-500 uppercase bg-gray-800">
              <tr>
                <th className="px-4 py-2">Side</th>
                <th className="px-4 py-2">Entry</th>
                <th className="px-4 py-2">Exit</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Fees</th>
                <th className="px-4 py-2">Net PNL</th>
                <th className="px-4 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {metrics.trades.slice().reverse().map(trade => (
                <tr key={trade.id} className="border-b border-gray-800">
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${trade.side === 'LONG' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                      {trade.side}
                    </span>
                  </td>
                  <td className="px-4 py-2">₹{trade.entryPrice.toLocaleString('en-IN', {maximumFractionDigits: 0})}</td>
                  <td className="px-4 py-2">₹{trade.exitPrice.toLocaleString('en-IN', {maximumFractionDigits: 0})}</td>
                  <td className="px-4 py-2">{trade.quantity}</td>
                  <td className="px-4 py-2 text-red-400">₹{trade.fees.toFixed(2)}</td>
                  <td className={`px-4 py-2 font-semibold ${trade.netPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {trade.netPnl >= 0 ? '+' : ''}₹{trade.netPnl.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-xs">{trade.exitReason}</td>
                </tr>
              ))}
              {metrics.trades.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-4 text-center text-gray-500">No trades executed</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

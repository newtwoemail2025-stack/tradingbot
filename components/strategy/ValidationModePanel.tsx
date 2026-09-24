'use client';

import React, { useState } from 'react';
import { StrategyValidator, SplitResult } from '../../lib/backtesting/validator';
import { MomentumStrategyV1 } from '../../lib/strategy/momentumV1';
import { MomentumStrategyV2 } from '../../lib/strategy/momentumV2';
import { BacktestConfig, BacktestMetrics } from '../../types/strategy';
import { Candle } from '../../types';

interface Props {
  config: BacktestConfig;
}

export const ValidationModePanel: React.FC<Props> = ({ config }) => {
  const [result, setResult] = useState<SplitResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [dataSize, setDataSize] = useState<number | null>(null);

  const runValidation = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);
    
    try {
      const res = await fetch('/data/btc-inr-1m.json');
      if (!res.ok) {
        throw new Error('Historical dataset not found. Please ensure public/data/btc-inr-1m.json exists.');
      }
      
      const candles: Candle[] = await res.json();
      setDataSize(candles.length);
      
      const strategy = config.strategyConfig.strategyName === 'Momentum V1'
        ? new MomentumStrategyV1()
        : new MomentumStrategyV2();
      
      const validator = new StrategyValidator(strategy, config);
      
      setTimeout(() => {
        try {
          const splitResult = validator.runChronologicalSplit(candles, 0.6, 0.2);
          setResult(splitResult);
          setIsRunning(false);
        } catch (e: any) {
          setError(e.message);
          setIsRunning(false);
        }
      }, 100);
      
    } catch (e: any) {
      setError(e.message);
      setIsRunning(false);
    }
  };

  const renderMetrics = (title: string, metrics: BacktestMetrics) => (
    <div className="bg-gray-800 p-4 rounded mb-4">
      <h3 className="font-bold text-gray-300 mb-2">{title}</h3>
      <div className="grid grid-cols-4 gap-2 text-sm">
        <div>
          <div className="text-gray-500 text-xs">Net Profit</div>
          <div className={metrics.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}>₹{metrics.netProfit.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs">Trades</div>
          <div className="text-white">{metrics.totalTrades} ({metrics.winRate.toFixed(1)}% WR)</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs">Profit Factor</div>
          <div className="text-white">{metrics.profitFactor.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs">Max Drawdown</div>
          <div className="text-red-400">{metrics.maxDrawdownPercent.toFixed(2)}%</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs">Fees Paid</div>
          <div className="text-red-400">₹{metrics.totalFees.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs">Slippage</div>
          <div className="text-red-400">₹{metrics.totalSlippage.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg h-full overflow-y-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">ROBUST VALIDATION</h2>
          <p className="text-sm text-gray-400">Chronological Split: 60% Train / 20% Validate / 20% Out-Of-Sample</p>
        </div>
        <button
          onClick={runValidation}
          disabled={isRunning}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded transition-colors disabled:opacity-50"
        >
          {isRunning ? 'VALIDATING...' : 'RUN VALIDATION'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded p-4 mb-6">
          <p className="text-red-200">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="bg-gray-950 p-4 rounded border border-gray-800 flex justify-between items-center">
            <div>
              <div className="text-gray-400 text-sm">Dataset Size</div>
              <div className="text-xl font-bold">{dataSize} Candles</div>
            </div>
            <div className="text-right">
              <div className="text-gray-400 text-sm">Final Verdict</div>
              <div className={`text-xl font-bold uppercase ${
                result.verdict.includes('PASSED') ? 'text-green-500' :
                result.verdict.includes('PROMISING') ? 'text-yellow-500' :
                'text-red-500'
              }`}>
                {result.verdict}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-bold text-white mb-2">1. Development / Train (60%)</h3>
            {renderMetrics('Baseline Costs', result.train.baseline)}
            {renderMetrics('High Slippage Stress Test', result.train.highSlippage)}
          </div>

          <div>
            <h3 className="text-lg font-bold text-white mb-2">2. Validation (20%)</h3>
            {renderMetrics('Baseline Costs', result.validation.baseline)}
          </div>

          <div>
            <h3 className="text-lg font-bold text-white mb-2">3. Out-Of-Sample Test (20%)</h3>
            {renderMetrics('Baseline Costs', result.test.baseline)}
          </div>
        </div>
      )}
    </div>
  );
};

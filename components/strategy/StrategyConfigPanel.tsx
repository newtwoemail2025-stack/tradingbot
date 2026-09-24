'use client';

import React from 'react';
import { StrategyConfig, BacktestConfig } from '../../types/strategy';

interface Props {
  config: BacktestConfig;
  onChange: (config: BacktestConfig) => void;
  onRun: () => void;
  isRunning: boolean;
}

export const StrategyConfigPanel: React.FC<Props> = ({ config, onChange, onRun, isRunning }) => {
  const handleStrategyChange = (key: string, value: string) => {
    onChange({
      ...config,
      strategyConfig: {
        ...config.strategyConfig,
        [key]: value
      }
    });
  };

  const handleBacktestChange = (key: keyof BacktestConfig, value: string) => {
    onChange({
      ...config,
      [key]: Number(value)
    });
  };

  const handleCostChange = (key: 'feePerSidePct' | 'slippagePerSidePct', value: string) => {
    onChange({
      ...config,
      costConfig: {
        feePerSidePct: config.costConfig?.feePerSidePct ?? 0.20,
        slippagePerSidePct: config.costConfig?.slippagePerSidePct ?? 0.10,
        [key]: Number(value)
      }
    });
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h2 className="text-lg font-bold text-white mb-4">STRATEGY CONFIGURATION</h2>
      
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Strategy</label>
          <select 
            value={config.strategyConfig.strategyName as string || 'Momentum V2'}
            onChange={e => handleStrategyChange('strategyName', e.target.value)}
            className="w-full bg-gray-800 text-white rounded px-3 py-2 border border-gray-700 text-sm"
          >
            <option value="Momentum V1">Momentum V1</option>
            <option value="Momentum V2">Momentum V2</option>
          </select>
        </div>
        
        <div>
          <label className="block text-xs text-gray-400 mb-1">Symbol</label>
          <select disabled className="w-full bg-gray-800 text-white rounded px-3 py-2 border border-gray-700 text-sm">
            <option>BTC/INR</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Timeframe (Fixed for Historical)</label>
          <select disabled className="w-full bg-gray-800 text-white rounded px-3 py-2 border border-gray-700 text-sm">
            <option>1m</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Initial Capital</label>
            <input 
              type="number" 
              value={config.initialCapital} 
              onChange={e => handleBacktestChange('initialCapital', e.target.value)}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 border border-gray-700 text-sm" 
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Risk per Trade (%)</label>
            <input 
              type="number" 
              step="0.1"
              value={config.riskPerTradePercent} 
              onChange={e => handleBacktestChange('riskPerTradePercent', e.target.value)}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 border border-gray-700 text-sm" 
            />
          </div>
        </div>

        <div className="border-t border-gray-800 my-4 pt-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Momentum Parameters</h3>
          
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <label className="block text-xs text-gray-500 mb-1">EMA Fast</label>
              <input type="number" value={config.strategyConfig.emaFast as number} onChange={e => handleStrategyChange('emaFast', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">EMA Slow</label>
              <input type="number" value={config.strategyConfig.emaSlow as number} onChange={e => handleStrategyChange('emaSlow', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">RSI Period</label>
              <input type="number" value={config.strategyConfig.rsiPeriod as number} onChange={e => handleStrategyChange('rsiPeriod', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Risk/Reward</label>
              <input type="number" step="0.1" value={config.strategyConfig.riskReward as number} onChange={e => handleStrategyChange('riskReward', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 my-4 pt-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">V2 Filters</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Min ADX</label>
              <input type="number" value={config.strategyConfig.minimumADX as number} onChange={e => handleStrategyChange('minimumADX', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Vol Multiplier</label>
              <input type="number" step="0.1" value={config.strategyConfig.volumeMultiplier as number} onChange={e => handleStrategyChange('volumeMultiplier', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Min EMA Sep %</label>
              <input type="number" step="0.001" value={config.strategyConfig.minimumEMASeparation as number} onChange={e => handleStrategyChange('minimumEMASeparation', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Min ATR %</label>
              <input type="number" step="0.001" value={config.strategyConfig.minimumATRPercent as number} onChange={e => handleStrategyChange('minimumATRPercent', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Breakout Candles</label>
              <input type="number" value={config.strategyConfig.breakoutCandles as number} onChange={e => handleStrategyChange('breakoutCandles', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 my-4 pt-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Execution Costs</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Trading Fee (%)</label>
              <input type="number" step="0.01" value={(config.costConfig?.feePerSidePct ?? 0.20)} onChange={e => handleCostChange('feePerSidePct', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Slippage (%)</label>
              <input type="number" step="0.01" value={(config.costConfig?.slippagePerSidePct ?? 0.10)} onChange={e => handleCostChange('slippagePerSidePct', e.target.value)} className="w-full bg-gray-800 text-white rounded px-2 py-1 border border-gray-700" />
            </div>
          </div>
        </div>

        <button 
          onClick={onRun}
          disabled={isRunning}
          className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded transition-colors disabled:opacity-50"
        >
          {isRunning ? 'RUNNING BACKTEST...' : 'RUN BACKTEST'}
        </button>
      </div>
    </div>
  );
};

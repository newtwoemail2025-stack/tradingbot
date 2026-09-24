'use client';

import React, { useState } from 'react';
import { StrategyConfigPanel } from '../../components/strategy/StrategyConfigPanel';
import { BacktestResultsPanel } from '../../components/strategy/BacktestResultsPanel';
import { ValidationModePanel } from '../../components/strategy/ValidationModePanel';
import { BacktestConfig, BacktestMetrics } from '../../types/strategy';
import { MomentumStrategyV1 } from '../../lib/strategy/momentumV1';
import { MomentumStrategyV2 } from '../../lib/strategy/momentumV2';
import { BacktestEngine } from '../../lib/backtesting/engine';
import { Candle } from '../../types';

export default function StrategyLabPage() {
  const [activeTab, setActiveTab] = useState<'BACKTEST' | 'VALIDATION'>('BACKTEST');
  
  const [config, setConfig] = useState<BacktestConfig>({
    initialCapital: 10000,
    riskPerTradePercent: 1.0,
    costConfig: { feePerSidePct: 0.1, slippagePerSidePct: 0.05 },
    strategyConfig: {
      strategyName: 'Momentum V2',
      emaFast: 20,
      emaSlow: 50,
      rsiPeriod: 14,
      longRsi: 55,
      shortRsi: 45,
      atrPeriod: 14,
      atrMultiplier: 1.5,
      riskReward: 2.0,
      adxPeriod: 14,
      minimumADX: 20,
      volumeMultiplier: 1.2,
      minimumEMASeparation: 0.001,
      minimumATRPercent: 0.001,
      breakoutCandles: 5
    }
  });

  const [metrics, setMetrics] = useState<BacktestMetrics | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runBacktest = async () => {
    setIsRunning(true);
    setError(null);
    setMetrics(null);

    try {
      const res = await fetch('/api/coindcx/candles?pair=B-BTC_INR&interval=1m');
      if (!res.ok) {
        throw new Error('Failed to fetch historical data from CoinDCX');
      }
      
      const data = await res.json();
      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error('Historical data was empty or invalid format');
      }

      let candles: Candle[] = data.map((c: any) => ({
        time: Math.floor(c.time / 1000) * 1000, 
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume)
      }));
      
      if (candles.length > 1 && candles[0].time > candles[1].time) {
        candles = candles.reverse();
      }

      const strategy = config.strategyConfig.strategyName === 'Momentum V1' 
        ? new MomentumStrategyV1() 
        : new MomentumStrategyV2();
      
      const engine = new BacktestEngine(strategy, config);

      setTimeout(() => {
        try {
          const results = engine.run(candles);
          setMetrics(results);
          setIsRunning(false);
        } catch (err: any) {
          setError(err.message || 'Error executing backtest loop');
          setIsRunning(false);
        }
      }, 100);

    } catch (err: any) {
      setError(err.message || 'Unknown error occurred');
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white font-sans overflow-hidden">
      <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center px-4 justify-between">
        <h1 className="text-xl font-bold text-white tracking-wider">ALGO<span className="text-indigo-500">X</span> <span className="text-gray-500 text-sm ml-2 font-normal">Strategy Lab</span></h1>
        
        <div className="flex space-x-2 bg-gray-950 p-1 rounded-lg border border-gray-800">
          <button 
            onClick={() => setActiveTab('BACKTEST')} 
            className={`px-4 py-1.5 text-sm font-semibold rounded-md ${activeTab === 'BACKTEST' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Quick Backtest
          </button>
          <button 
            onClick={() => setActiveTab('VALIDATION')} 
            className={`px-4 py-1.5 text-sm font-semibold rounded-md ${activeTab === 'VALIDATION' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Robust Validation
          </button>
        </div>
      </div>
      
      <div className="flex-1 p-4 overflow-hidden">
        <div className="flex h-full space-x-4">
          
          <div className="w-80 flex flex-col shrink-0 overflow-y-auto">
            <StrategyConfigPanel 
              config={config} 
              onChange={setConfig} 
              onRun={runBacktest}
              isRunning={isRunning}
            />
            
            {error && activeTab === 'BACKTEST' && (
              <div className="mt-4 bg-red-900/50 border border-red-500 rounded p-3 text-sm text-red-200">
                <p className="font-bold">Backtest Failed</p>
                <p>{error}</p>
              </div>
            )}
          </div>

          <div className="flex-1 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {activeTab === 'BACKTEST' ? (
              <div className="h-full p-4">
                <BacktestResultsPanel metrics={metrics} />
              </div>
            ) : (
              <ValidationModePanel config={config} />
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}

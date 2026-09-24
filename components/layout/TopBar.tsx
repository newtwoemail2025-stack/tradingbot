'use client';

import React from 'react';
import { useTrading } from '../../lib/context/TradingContext';
import { Activity, Wifi, Database } from 'lucide-react';

export const TopBar = () => {
  const { tick, portfolio, connectionStatus, dataSource, setDataSource } = useTrading();

  return (
    <div className="h-14 border-b border-gray-800 bg-gray-950 flex items-center justify-between px-4 text-sm">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2 text-indigo-400 font-bold text-lg tracking-wider">
          <Activity size={20} />
          <span>ALGO<span className="text-white">X</span></span>
        </div>
        
        <div className="flex items-center space-x-4 border-l border-gray-800 pl-6">
          <div className="flex items-center space-x-2">
            <span className="text-gray-400">Market:</span>
            <span className="font-semibold text-white">BTC/INR</span>
          </div>
          
          <div className="flex flex-col">
            <span className="text-gray-400 text-xs">Price</span>
            <span className={`font-mono font-semibold ${tick && tick.change24h && tick.change24h > 0 ? 'text-green-500' : 'text-red-500'}`}>
              ₹{tick ? tick.price.toLocaleString('en-IN', {minimumFractionDigits: 2}) : '---'}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-gray-400 text-xs">24h Change</span>
            <span className={`font-mono font-semibold ${tick && tick.change24h && tick.change24h > 0 ? 'text-green-500' : 'text-red-500'}`}>
              {tick?.change24h ? `${tick.change24h > 0 ? '+' : ''}${tick.change24h}%` : '---'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-6">
        <div className="flex flex-col text-right">
          <span className="text-gray-400 text-xs">Equity</span>
          <span className="font-mono font-semibold text-white">₹{portfolio.equity.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
        </div>
        
        <div className="bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 px-3 py-1 rounded text-xs font-semibold uppercase tracking-wider flex items-center space-x-2">
          <span>Paper Trading</span>
        </div>
        
        <button 
          onClick={() => setDataSource(dataSource === 'MOCK' ? 'REAL' : 'MOCK')}
          className={`flex items-center space-x-1 px-3 py-1 rounded text-xs font-semibold uppercase tracking-wider transition-colors border ${dataSource === 'REAL' ? 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30 hover:bg-indigo-600/30' : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:bg-gray-800'}`}
        >
          <Database size={14} />
          <span>{dataSource === 'REAL' ? 'CoinDCX Live' : 'Mock Data'}</span>
        </button>

        <div className={`flex items-center space-x-1 ${connectionStatus === 'CONNECTED' ? 'text-green-500' : connectionStatus === 'CONNECTING' ? 'text-yellow-500' : 'text-red-500'}`}>
          <Wifi size={16} />
          <span className="text-xs font-semibold">{connectionStatus}</span>
        </div>
      </div>
    </div>
  );
};

'use client';

import React, { useState } from 'react';
import { useTrading } from '../../lib/context/TradingContext';

export const PortfolioDashboard = () => {
  const { positions, orders } = useTrading();
  const [activeTab, setActiveTab] = useState<'POSITIONS' | 'ORDERS' | 'HISTORY'>('POSITIONS');

  return (
    <div className="h-64 bg-gray-950 border-t border-gray-800 flex flex-col text-sm">
      <div className="flex border-b border-gray-800">
        <button 
          onClick={() => setActiveTab('POSITIONS')}
          className={`px-6 py-2 font-semibold transition-colors ${activeTab === 'POSITIONS' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Open Positions ({positions.filter(p => p.status === 'OPEN').length})
        </button>
        <button 
          onClick={() => setActiveTab('ORDERS')}
          className={`px-6 py-2 font-semibold transition-colors ${activeTab === 'ORDERS' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Orders
        </button>
        <button 
          onClick={() => setActiveTab('HISTORY')}
          className={`px-6 py-2 font-semibold transition-colors ${activeTab === 'HISTORY' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Trade History
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === 'POSITIONS' && (
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="text-xs text-gray-500 bg-gray-900/50 sticky top-0">
              <tr>
                <th className="p-3 font-medium">Symbol</th>
                <th className="p-3 font-medium">Side</th>
                <th className="p-3 font-medium">Qty</th>
                <th className="p-3 font-medium">Entry Price</th>
                <th className="p-3 font-medium">Mark Price</th>
                <th className="p-3 font-medium">Stop Loss</th>
                <th className="p-3 font-medium">Take Profit</th>
                <th className="p-3 font-medium text-right">Unrealized PNL</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {positions.filter(p => p.status === 'OPEN').map((pos, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors">
                  <td className="p-3 font-semibold text-white">{pos.symbol}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${pos.side === 'LONG' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                      {pos.side}
                    </span>
                  </td>
                  <td className="p-3 font-mono">{pos.quantity}</td>
                  <td className="p-3 font-mono">₹{pos.entryPrice.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                  <td className="p-3 font-mono">₹{pos.currentPrice.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                  <td className="p-3 font-mono text-gray-500">{pos.stopLoss ? `₹${pos.stopLoss.toLocaleString('en-IN')}` : '-'}</td>
                  <td className="p-3 font-mono text-gray-500">{pos.takeProfit ? `₹${pos.takeProfit.toLocaleString('en-IN')}` : '-'}</td>
                  <td className={`p-3 font-mono text-right font-semibold ${pos.unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {pos.unrealizedPnl >= 0 ? '+' : ''}{pos.unrealizedPnl.toLocaleString('en-IN', {minimumFractionDigits: 2})}
                  </td>
                </tr>
              ))}
              {positions.filter(p => p.status === 'OPEN').length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-500">No open positions</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {activeTab === 'ORDERS' && (
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="text-xs text-gray-500 bg-gray-900/50 sticky top-0">
              <tr>
                <th className="p-3 font-medium">Time</th>
                <th className="p-3 font-medium">Symbol</th>
                <th className="p-3 font-medium">Action</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Price</th>
                <th className="p-3 font-medium">Qty</th>
                <th className="p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {orders.slice().reverse().map((order, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors">
                  <td className="p-3 text-xs text-gray-500">{new Date(order.timestamp).toLocaleTimeString()}</td>
                  <td className="p-3 font-semibold text-white">{order.symbol}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${order.positionSide === 'LONG' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                      {order.action} {order.positionSide}
                    </span>
                  </td>
                  <td className="p-3 text-xs">{order.type}</td>
                  <td className="p-3 font-mono">{order.price ? `₹${order.price.toLocaleString('en-IN')}` : 'Market'}</td>
                  <td className="p-3 font-mono">{order.quantity}</td>
                  <td className="p-3 text-xs">
                    <span className={`px-2 py-1 rounded bg-gray-800 ${order.status === 'FILLED' ? 'text-green-500' : order.status === 'OPEN' ? 'text-yellow-500' : order.status === 'REJECTED' ? 'text-red-500' : 'text-gray-400'}`}>
                      {order.status}
                    </span>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">No orders history</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        
        {activeTab === 'HISTORY' && (
           <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="text-xs text-gray-500 bg-gray-900/50 sticky top-0">
              <tr>
                <th className="p-3 font-medium">Closed At</th>
                <th className="p-3 font-medium">Symbol</th>
                <th className="p-3 font-medium">Side</th>
                <th className="p-3 font-medium">Qty</th>
                <th className="p-3 font-medium">Entry Price</th>
                <th className="p-3 font-medium">Exit Price</th>
                <th className="p-3 font-medium text-right">Realized PNL</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {positions.filter(p => p.status === 'CLOSED').slice().reverse().map((pos, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors">
                  <td className="p-3 text-xs text-gray-500">{new Date(pos.openedAt).toLocaleTimeString()}</td>
                  <td className="p-3 font-semibold text-white">{pos.symbol}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${pos.side === 'LONG' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                      {pos.side}
                    </span>
                  </td>
                  <td className="p-3 font-mono">{pos.quantity}</td>
                  <td className="p-3 font-mono">₹{pos.entryPrice.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                  <td className="p-3 font-mono">₹{pos.currentPrice.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                  <td className={`p-3 font-mono text-right font-semibold ${pos.realizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {pos.realizedPnl >= 0 ? '+' : ''}{pos.realizedPnl.toLocaleString('en-IN', {minimumFractionDigits: 2})}
                  </td>
                </tr>
              ))}
              {positions.filter(p => p.status === 'CLOSED').length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">No trade history yet</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

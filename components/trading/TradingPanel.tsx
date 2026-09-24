'use client';

import React, { useState } from 'react';
import { useTrading } from '../../lib/context/TradingContext';

export const TradingPanel = () => {
  const { tick, placeOrder, portfolio } = useTrading();
  const [positionSide, setPositionSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [quantity, setQuantity] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');

  const currentPrice = orderType === 'LIMIT' && price ? Number(price) : (tick?.price || 0);
  const qtyNum = Number(quantity) || 0;
  const slNum = Number(stopLoss) || 0;
  const tpNum = Number(takeProfit) || 0;

  const estimatedValue = qtyNum * currentPrice;
  
  let maxLoss = 0;
  let potentialProfit = 0;
  
  if (slNum > 0) {
    maxLoss = positionSide === 'LONG' ? (currentPrice - slNum) * qtyNum : (slNum - currentPrice) * qtyNum;
    maxLoss = Math.max(0, maxLoss); // Prevent negative loss display if invalid SL
  }
  
  if (tpNum > 0) {
    potentialProfit = positionSide === 'LONG' ? (tpNum - currentPrice) * qtyNum : (currentPrice - tpNum) * qtyNum;
    potentialProfit = Math.max(0, potentialProfit);
  }

  const riskPct = portfolio.balance > 0 ? (maxLoss / portfolio.balance) * 100 : 0;
  const riskReward = maxLoss > 0 && potentialProfit > 0 ? `1:${(potentialProfit / maxLoss).toFixed(2)}` : '---';

  const handlePlaceOrder = () => {
    if (!qtyNum) return;
    
    // Determine the actual order side based on the position we want to open
    const orderSide = positionSide === 'LONG' ? 'BUY' : 'SELL';
    
    placeOrder(
      'BTC/INR',
      orderSide,
      positionSide,
      'OPEN',
      orderType,
      qtyNum,
      orderType === 'LIMIT' ? currentPrice : undefined,
      slNum > 0 ? slNum : undefined,
      tpNum > 0 ? tpNum : undefined
    );

    // Reset some fields
    setQuantity('');
    if (orderType === 'LIMIT') setPrice('');
  };

  // Validations for UI
  const isInvalidSL = positionSide === 'LONG' ? (slNum > 0 && slNum >= currentPrice) : (slNum > 0 && slNum <= currentPrice);
  const isInvalidTP = positionSide === 'LONG' ? (tpNum > 0 && tpNum <= currentPrice) : (tpNum > 0 && tpNum >= currentPrice);
  const isOverExposure = estimatedValue > portfolio.balance;
  
  const canSubmit = qtyNum > 0 && currentPrice > 0 && !isInvalidSL && !isInvalidTP && !isOverExposure;

  return (
    <div className="w-80 bg-gray-950 border-l border-gray-800 flex flex-col h-full text-sm">
      <div className="flex border-b border-gray-800">
        <button 
          onClick={() => setPositionSide('LONG')}
          className={`flex-1 py-3 font-semibold transition-colors ${positionSide === 'LONG' ? 'text-green-500 border-b-2 border-green-500' : 'text-gray-500 hover:text-gray-300'}`}
        >
          LONG
        </button>
        <button 
          onClick={() => setPositionSide('SHORT')}
          className={`flex-1 py-3 font-semibold transition-colors ${positionSide === 'SHORT' ? 'text-red-500 border-b-2 border-red-500' : 'text-gray-500 hover:text-gray-300'}`}
        >
          SHORT
        </button>
      </div>

      <div className="p-4 flex-1 overflow-y-auto space-y-4">
        <div className="flex bg-gray-900 rounded p-1">
          <button 
            onClick={() => setOrderType('MARKET')}
            className={`flex-1 py-1 text-xs rounded transition-colors ${orderType === 'MARKET' ? 'bg-gray-800 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Market
          </button>
          <button 
            onClick={() => setOrderType('LIMIT')}
            className={`flex-1 py-1 text-xs rounded transition-colors ${orderType === 'LIMIT' ? 'bg-gray-800 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Limit
          </button>
        </div>

        {orderType === 'LIMIT' && (
          <div className="space-y-1">
            <label className="text-xs text-gray-400">Entry Price (INR)</label>
            <input 
              type="number" 
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              placeholder="0.00"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs text-gray-400">Quantity (BTC)</label>
          <input 
            type="number" 
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
            placeholder="0.00"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-gray-400">Stop Loss (INR)</label>
          <input 
            type="number" 
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            className={`w-full bg-gray-900 border rounded px-3 py-2 text-white focus:outline-none ${isInvalidSL ? 'border-red-500 focus:border-red-500' : 'border-gray-800 focus:border-indigo-500'}`}
            placeholder="Optional"
          />
          {isInvalidSL && <p className="text-xs text-red-500">Invalid SL price</p>}
        </div>

        <div className="space-y-1">
          <label className="text-xs text-gray-400">Take Profit (INR)</label>
          <input 
            type="number" 
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            className={`w-full bg-gray-900 border rounded px-3 py-2 text-white focus:outline-none ${isInvalidTP ? 'border-red-500 focus:border-red-500' : 'border-gray-800 focus:border-indigo-500'}`}
            placeholder="Optional"
          />
          {isInvalidTP && <p className="text-xs text-red-500">Invalid TP price</p>}
        </div>
        
        <div className="border-t border-gray-800 pt-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Est. Position Value</span>
            <span className={`font-mono ${isOverExposure ? 'text-red-500 font-bold' : 'text-white'}`}>₹{estimatedValue.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Max Loss (Risk)</span>
            <span className="text-white font-mono">₹{maxLoss.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Account Risk</span>
            <span className="text-white font-mono">{riskPct.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Potential Profit</span>
            <span className="text-white font-mono">₹{potentialProfit.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Risk/Reward</span>
            <span className="text-white font-mono">{riskReward}</span>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-gray-800">
        <button 
          onClick={handlePlaceOrder}
          disabled={!canSubmit}
          className={`w-full py-3 rounded font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${positionSide === 'LONG' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
        >
          OPEN {positionSide}
        </button>
      </div>
    </div>
  );
};

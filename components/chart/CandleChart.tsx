'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { useTrading } from '../../lib/context/TradingContext';
import { Candle } from '../../types';

export const CandleChart = () => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const { marketData, tick } = useTrading();
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  
  const [timeframe, setTimeframe] = useState('1m');

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Initialize chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#030712' }, // bg-gray-950
        textColor: '#9CA3AF', // text-gray-400
      },
      grid: {
        vertLines: { color: '#1F2937' }, // border-gray-800
        horzLines: { color: '#1F2937' },
      },
      crosshair: {
        mode: 0,
      },
      timeScale: {
        borderColor: '#1F2937',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#1F2937',
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#3b82f6',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;

    // Load initial historical data
    if (marketData) {
      marketData.getHistoricalCandles('BTC/INR', timeframe, 100).then(candles => {
        const formattedCandles = candles.map(c => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close
        }));
        
        const formattedVolume = candles.map(c => ({
          time: c.time as Time,
          value: c.volume || 0,
          color: c.close >= c.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'
        }));

        candlestickSeries.setData(formattedCandles);
        volumeSeries.setData(formattedVolume);
      });

      // Subscribe to real-time candles
      marketData.subscribeToCandles('BTC/INR', timeframe, (candle: Candle) => {
        candlestickSeries.update({
          time: candle.time as Time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close
        });
        
        volumeSeries.update({
          time: candle.time as Time,
          value: candle.volume || 0,
          color: candle.close >= candle.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'
        });
      });
    }

    const handleResize = () => {
      chart.applyOptions({
        width: chartContainerRef.current?.clientWidth,
        height: chartContainerRef.current?.clientHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    // Initial resize to fit container
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [marketData, timeframe]);

  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1D'];

  return (
    <div className="flex flex-col h-full bg-gray-950 border-b border-gray-800">
      <div className="flex items-center px-4 py-2 border-b border-gray-800 space-x-2">
        {timeframes.map(tf => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${timeframe === tf ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
          >
            {tf}
          </button>
        ))}
        <div className="flex-1"></div>
        {tick && (
          <div className="text-sm font-mono text-gray-400">
            O: <span className="text-white">---</span> H: <span className="text-white">---</span> L: <span className="text-white">---</span> C: <span className="text-white font-semibold">₹{tick.price.toLocaleString('en-IN')}</span>
          </div>
        )}
      </div>
      <div ref={chartContainerRef} className="flex-1 w-full" />
    </div>
  );
};

'use client';

import React, { useState } from 'react';
import { Search, Star, FileText, X, RefreshCw } from 'lucide-react';

const WATCHLIST = [
  { symbol: 'BTC/INR', price: '₹5,500,000.00', change: '+2.5%' },
  { symbol: 'ETH/INR', price: '₹280,000.00', change: '+1.2%' }
];

const REPORTS = [
  { name: 'Live State JSON', file: 'live-state.json', type: 'file' },
  { name: 'Spawn Debug Log', file: 'spawn-debug.log', type: 'file' },
  { name: 'All Trades Forensic Analysis', file: 'analyze', type: 'api' }
];

export const Sidebar = () => {
  const [selectedReport, setSelectedReport] = useState<{name: string, file: string, type: string} | null>(null);
  const [reportContent, setReportContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const openReport = async (report: {name: string, file: string, type: string}) => {
    if (abortController) {
      abortController.abort();
    }
    
    const ctrl = new AbortController();
    setAbortController(ctrl);
    
    setSelectedReport(report);
    setLoading(true);
    setReportContent('');
    try {
      const url = report.type === 'api' 
        ? `/api/reports/${report.file}` 
        : `/api/reports?file=${report.file}`;
        
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok) {
        const data = await res.json();
        setReportContent(data.content);
      } else {
        setReportContent(`Error: File not found or couldn't be loaded.`);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setReportContent(`Error fetching report: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const refreshReport = () => {
    if (selectedReport) {
      openReport(selectedReport);
    }
  };

  return (
    <>
      <div className="w-64 border-r border-gray-800 bg-gray-950 flex flex-col h-full z-10">
        <div className="p-4 border-b border-gray-800">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" />
            <input 
              type="text" 
              placeholder="Search symbol" 
              className="w-full bg-gray-900 text-sm text-white placeholder-gray-500 border border-gray-800 rounded pl-9 pr-3 py-1.5 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider mt-2">
            Watchlist
          </div>
          
          <div className="flex flex-col mb-4">
            {WATCHLIST.map((item) => (
              <div key={item.symbol} className="flex items-center justify-between px-4 py-3 hover:bg-gray-900 cursor-pointer transition-colors border-l-2 border-transparent hover:border-indigo-500">
                <div className="flex items-center space-x-3">
                  <Star size={14} className="text-yellow-500" />
                  <span className="font-semibold text-white text-sm">{item.symbol}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-white text-sm font-mono">{item.price}</span>
                  <span className="text-green-500 text-xs font-mono">{item.change}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider mt-4">
            System Reports
          </div>
          <div className="flex flex-col">
            {REPORTS.map((report) => (
              <div 
                key={report.file} 
                onClick={() => openReport(report)}
                className="flex items-center px-4 py-3 hover:bg-gray-900 cursor-pointer transition-colors border-l-2 border-transparent hover:border-blue-500"
              >
                <FileText size={14} className="text-blue-400 mr-3" />
                <span className="font-semibold text-gray-300 text-sm hover:text-white transition-colors">{report.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Report Modal */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#181A20] w-[80vw] h-[85vh] rounded-xl border border-gray-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-[#0B0E11] rounded-t-xl">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <FileText className="text-blue-500" />
                {selectedReport.name}
              </h3>
              <div className="flex gap-4">
                <button onClick={refreshReport} className="text-gray-400 hover:text-blue-400 transition-colors p-1" title="Refresh">
                  <RefreshCw size={20} className={loading ? "animate-spin text-blue-500" : ""} />
                </button>
                <button onClick={() => { if (abortController) { abortController.abort(); } setSelectedReport(null); }} className="text-gray-400 hover:text-red-500 transition-colors p-1" title="Close">
                  <X size={24} />
                </button>
              </div>
            </div>
            <div className="flex-1 p-6 overflow-auto bg-[#0B0E11] rounded-b-xl">
              {loading ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <RefreshCw size={32} className="animate-spin text-blue-500 mb-4" />
                </div>
              ) : (
                <pre className="text-gray-300 font-mono text-xs whitespace-pre-wrap leading-relaxed">
                  {reportContent || 'No content found.'}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

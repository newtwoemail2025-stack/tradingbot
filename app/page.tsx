import React from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Sidebar } from '@/components/layout/Sidebar';
import { BotDashboard } from '@/components/bot/BotDashboard';
import { TradingProvider } from '@/lib/context/TradingContext';

export default function Home() {
  return (
    <TradingProvider>
      <div className="flex flex-col h-screen bg-black text-white font-sans overflow-hidden">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <BotDashboard />
          </div>
        </div>
      </div>
    </TradingProvider>
  );
}

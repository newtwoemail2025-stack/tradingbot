import { PaperTradingEngine } from '../paper';
import { MarketTick } from '../../../types';

describe('PaperTradingEngine - Crypto Perpetual', () => {
  let engine: PaperTradingEngine;

  beforeEach(() => {
    engine = new PaperTradingEngine();
  });

  const getTick = (price: number): MarketTick => ({ symbol: 'BTC/INR', price, timestamp: Date.now() });

  it('1. LONG P&L calculation', () => {
    engine.placeOrder('BTC/INR', 'BUY', 'LONG', 'OPEN', 'MARKET', 1);
    engine.processMarketTick(getTick(100)); // Executed at 100
    engine.processMarketTick(getTick(105)); // Moves up

    const pos = engine.getPositions()[0];
    expect(pos.entryPrice).toBe(100);
    expect(pos.unrealizedPnl).toBe(5);

    engine.processMarketTick(getTick(95)); // Moves down
    expect(engine.getPositions()[0].unrealizedPnl).toBe(-5);
  });

  it('2. SHORT P&L calculation', () => {
    engine.placeOrder('BTC/INR', 'SELL', 'SHORT', 'OPEN', 'MARKET', 1);
    engine.processMarketTick(getTick(100)); // Executed at 100
    engine.processMarketTick(getTick(95)); // Moves down (profit)

    const pos = engine.getPositions()[0];
    expect(pos.entryPrice).toBe(100);
    expect(pos.unrealizedPnl).toBe(5);

    engine.processMarketTick(getTick(105)); // Moves up (loss)
    expect(engine.getPositions()[0].unrealizedPnl).toBe(-5);
  });

  it('3. LONG stop loss', () => {
    engine.placeOrder('BTC/INR', 'BUY', 'LONG', 'OPEN', 'MARKET', 1, undefined, 90, undefined);
    engine.processMarketTick(getTick(100)); // Executed at 100
    
    expect(engine.getPositions()[0].status).toBe('OPEN');
    engine.processMarketTick(getTick(89)); // Hits SL
    
    const pos = engine.getPositions().find(p => p.entryPrice === 100);
    expect(pos?.status).toBe('CLOSED');
    expect(pos?.realizedPnl).toBe(-11); // (89 - 100) * 1
  });

  it('4. SHORT stop loss', () => {
    engine.placeOrder('BTC/INR', 'SELL', 'SHORT', 'OPEN', 'MARKET', 1, undefined, 110, undefined);
    engine.processMarketTick(getTick(100)); // Executed at 100
    
    expect(engine.getPositions()[0].status).toBe('OPEN');
    engine.processMarketTick(getTick(111)); // Hits SL
    
    const pos = engine.getPositions().find(p => p.entryPrice === 100);
    expect(pos?.status).toBe('CLOSED');
    expect(pos?.realizedPnl).toBe(-11); // (100 - 111) * 1
  });

  it('5. LONG take profit', () => {
    engine.placeOrder('BTC/INR', 'BUY', 'LONG', 'OPEN', 'MARKET', 1, undefined, undefined, 120);
    engine.processMarketTick(getTick(100));
    
    engine.processMarketTick(getTick(121)); // Hits TP
    
    const pos = engine.getPositions()[0];
    expect(pos.status).toBe('CLOSED');
    expect(pos.realizedPnl).toBe(21);
  });

  it('6. SHORT take profit', () => {
    engine.placeOrder('BTC/INR', 'SELL', 'SHORT', 'OPEN', 'MARKET', 1, undefined, undefined, 80);
    engine.processMarketTick(getTick(100));
    
    engine.processMarketTick(getTick(79)); // Hits TP
    
    const pos = engine.getPositions()[0];
    expect(pos.status).toBe('CLOSED');
    expect(pos.realizedPnl).toBe(21); // (100 - 79) * 1
  });

  it('7. Invalid LONG SL/TP', () => {
    expect(() => {
      engine.placeOrder('BTC/INR', 'BUY', 'LONG', 'OPEN', 'LIMIT', 1, 100, 105, 95);
    }).toThrow('LONG Stop Loss must be below entry price');
  });

  it('8. Invalid SHORT SL/TP', () => {
    expect(() => {
      engine.placeOrder('BTC/INR', 'SELL', 'SHORT', 'OPEN', 'LIMIT', 1, 100, 95, 105);
    }).toThrow('SHORT Stop Loss must be above entry price');
  });

  it('9. Position-size limits (1x exposure)', () => {
    // Balance is 10000. Trying to buy 1 BTC at 15000 should fail
    engine.placeOrder('BTC/INR', 'BUY', 'LONG', 'OPEN', 'MARKET', 1);
    engine.processMarketTick(getTick(15000));
    
    const order = engine.getOrders()[0];
    expect(order.status).toBe('REJECTED');
    expect(engine.getPositions().length).toBe(0);
  });
  
  it('12. Realized P&L updates balance', () => {
    const initialPortfolio = engine.getPortfolio();
    expect(initialPortfolio.balance).toBe(10000);
    
    engine.placeOrder('BTC/INR', 'BUY', 'LONG', 'OPEN', 'MARKET', 1, undefined, undefined, 110);
    engine.processMarketTick(getTick(100)); // Cost = 100
    engine.processMarketTick(getTick(110)); // Profit = 10
    
    const updatedPortfolio = engine.getPortfolio();
    expect(updatedPortfolio.balance).toBe(10010);
  });
});

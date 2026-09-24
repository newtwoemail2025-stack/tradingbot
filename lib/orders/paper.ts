import { Order, OrderSide, PositionSide, OrderAction, OrderType, Position, Portfolio, MarketTick } from '../../types';

export class PaperTradingEngine {
  private balance: number = 10000;
  private positions: Position[] = [];
  private orders: Order[] = [];
  
  constructor() {}

  public getPortfolio(): Portfolio {
    let unrealizedPnl = 0;
    this.positions.forEach(p => {
      if (p.status === 'OPEN') {
        unrealizedPnl += p.unrealizedPnl;
      }
    });
    
    // In our simplified model, balance already contains realized PnL
    // Equity is simply balance + unrealized PnL
    return {
      balance: this.balance,
      equity: this.balance + unrealizedPnl,
      unrealizedPnl,
      realizedPnl: 0 
    };
  }

  public getPositions(): Position[] {
    return this.positions;
  }
  
  public getOrders(): Order[] {
    return this.orders;
  }

  public placeOrder(
    symbol: string, 
    side: OrderSide, 
    positionSide: PositionSide,
    action: OrderAction,
    type: OrderType, 
    quantity: number, 
    price?: number,
    stopLoss?: number,
    takeProfit?: number
  ): Order {
    
    // Validation: 1x exposure check for OPEN orders
    if (action === 'OPEN') {
      const estimatedPrice = type === 'LIMIT' && price ? price : (price || 1); // We should use market price ideally, but we'll validate strictly in executeOrder
      // Roughly validate here if price is passed
      if (price && quantity * price > this.balance) {
        throw new Error('Insufficient paper balance for 1x exposure.');
      }
      
      // Validation: SL/TP
      if (positionSide === 'LONG') {
        if (stopLoss && price && stopLoss >= price) throw new Error('LONG Stop Loss must be below entry price');
        if (takeProfit && price && takeProfit <= price) throw new Error('LONG Take Profit must be above entry price');
      } else if (positionSide === 'SHORT') {
        if (stopLoss && price && stopLoss <= price) throw new Error('SHORT Stop Loss must be above entry price');
        if (takeProfit && price && takeProfit >= price) throw new Error('SHORT Take Profit must be below entry price');
      }
    }

    const order: Order = {
      id: Math.random().toString(36).substring(7),
      symbol,
      side,
      positionSide,
      action,
      type,
      quantity,
      price,
      stopPrice: stopLoss,
      takeProfit: takeProfit,
      status: 'OPEN',
      timestamp: Date.now()
    };
    
    this.orders.push(order);
    return order;
  }

  public processMarketTick(tick: MarketTick) {
    // Process open orders
    this.orders.forEach(order => {
      if (order.status === 'OPEN') {
        if (order.type === 'MARKET') {
          this.executeOrder(order, tick.price);
        } else if (order.type === 'LIMIT') {
          if (order.side === 'BUY' && tick.price <= (order.price || 0)) {
            this.executeOrder(order, tick.price);
          } else if (order.side === 'SELL' && tick.price >= (order.price || 0)) {
            this.executeOrder(order, tick.price);
          }
        }
      }
    });

    // Update positions PnL and check SL/TP
    this.positions = this.positions.map(position => {
      if (position.status === 'OPEN' && position.symbol === tick.symbol) {
        position.currentPrice = tick.price;
        
        // Calculate PnL
        if (position.side === 'LONG') {
          position.unrealizedPnl = (tick.price - position.entryPrice) * position.quantity;
        } else if (position.side === 'SHORT') {
          position.unrealizedPnl = (position.entryPrice - tick.price) * position.quantity;
        }

        // Check SL / TP
        let triggerClose = false;

        if (position.side === 'LONG') {
          if (position.stopLoss && tick.price <= position.stopLoss) triggerClose = true;
          if (position.takeProfit && tick.price >= position.takeProfit) triggerClose = true;
        } else if (position.side === 'SHORT') {
          if (position.stopLoss && tick.price >= position.stopLoss) triggerClose = true;
          if (position.takeProfit && tick.price <= position.takeProfit) triggerClose = true;
        }

        if (triggerClose) {
          // Create simulated close order
          const closeSide: OrderSide = position.side === 'LONG' ? 'SELL' : 'BUY';
          const closeOrder = this.placeOrder(
            position.symbol, 
            closeSide, 
            position.side, 
            'CLOSE', 
            'MARKET', 
            position.quantity
          );
          // Execute it immediately at current market price (simulating slippage/trigger price)
          this.executeOrder(closeOrder, tick.price);
        }
      }
      return position;
    });
  }

  private executeOrder(order: Order, executionPrice: number) {
    if (order.status !== 'OPEN') return; // Prevent double execution
    
    if (order.action === 'OPEN') {
      // Final 1x exposure check
      if (order.quantity * executionPrice > this.balance) {
        order.status = 'REJECTED';
        return; // Insufficient funds
      }
      
      order.status = 'FILLED';
      order.filledAt = Date.now();
      
      const position: Position = {
        id: Math.random().toString(36).substring(7),
        symbol: order.symbol,
        side: order.positionSide,
        quantity: order.quantity,
        entryPrice: executionPrice,
        currentPrice: executionPrice,
        stopLoss: order.stopPrice,
        takeProfit: order.takeProfit,
        unrealizedPnl: 0,
        realizedPnl: 0,
        status: 'OPEN',
        openedAt: Date.now()
      };
      
      this.positions.push(position);
    } else if (order.action === 'CLOSE') {
      order.status = 'FILLED';
      order.filledAt = Date.now();
      
      // Find the open position to close
      const position = this.positions.find(p => p.status === 'OPEN' && p.symbol === order.symbol && p.side === order.positionSide);
      if (position) {
        position.status = 'CLOSED';
        position.currentPrice = executionPrice; // Lock in final price
        
        // Final PnL calculation
        if (position.side === 'LONG') {
          position.realizedPnl = (executionPrice - position.entryPrice) * position.quantity;
        } else if (position.side === 'SHORT') {
          position.realizedPnl = (position.entryPrice - executionPrice) * position.quantity;
        }
        
        position.unrealizedPnl = 0;
        this.balance += position.realizedPnl;
      }
    }
  }
}

import { PositionSide } from '../../types';

export const calculatePositionSize = (
  capital: number,
  riskPercent: number, // e.g., 1.0 for 1%
  entryPrice: number,
  stopLoss: number,
  side: PositionSide
): number => {
  if (capital <= 0 || riskPercent <= 0 || entryPrice <= 0 || stopLoss <= 0) return 0;
  
  // Validate logical SL
  if (side === 'LONG' && stopLoss >= entryPrice) return 0;
  if (side === 'SHORT' && stopLoss <= entryPrice) return 0;

  const riskAmount = capital * (riskPercent / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  
  if (riskPerUnit === 0) return 0;
  
  let quantity = riskAmount / riskPerUnit;
  
  // 1x Exposure check: quantity * entryPrice cannot exceed total capital
  const positionValue = quantity * entryPrice;
  if (positionValue > capital) {
    quantity = capital / entryPrice; // Cap at 1x leverage
  }
  
  // Return truncated to 4 decimal places to avoid floating point absurdities
  return Math.floor(quantity * 10000) / 10000;
};

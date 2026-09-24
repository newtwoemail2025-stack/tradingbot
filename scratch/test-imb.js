const state = {
  direction: "LONG",
  analytics: {
    aggregateImbalance: 8.74,
    imbalanceDirection: "LONG",
    strategyThresholds: { aggImbRatio: 2.5 }
  }
};
const { direction, analytics } = state;
const th = analytics.strategyThresholds;

const imbPass = direction === 'LONG' ? 
  (analytics.imbalanceDirection === 'LONG' && analytics.aggregateImbalance >= (th.aggImbRatio || 2.5)) :
  (analytics.imbalanceDirection === 'SHORT' && analytics.aggregateImbalance >= (th.aggImbRatio || 2.5));

console.log(imbPass);

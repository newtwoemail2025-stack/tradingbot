const STRATEGY_V2_CONFIG = {
    imbalanceRatio: 3.0,
    maxSpread: 0.02,
    priceConfirmationMs: 1000 // Lookback for price momentum
};

function getLongSignal(obState, secHistory, spread) {
    if (spread > STRATEGY_V2_CONFIG.maxSpread) return false;
    
    // Condition 1: Imbalance
    const imbalance = obState.bidQty > obState.askQty * STRATEGY_V2_CONFIG.imbalanceRatio;
    
    // Condition 2: Price confirmation (mid price is higher than 1 second ago)
    let priceConfirmed = false;
    if (secHistory && secHistory.length >= 2) {
        const currentMid = (obState.bestBid + obState.bestAsk) / 2;
        const oldMid = (secHistory[secHistory.length - 2].bestBid + secHistory[secHistory.length - 2].bestAsk) / 2;
        if (currentMid > oldMid) {
            priceConfirmed = true;
        }
    }
    
    return imbalance && priceConfirmed;
}

function getShortSignal(obState, secHistory, spread) {
    if (spread > STRATEGY_V2_CONFIG.maxSpread) return false;
    
    // Condition 1: Imbalance
    const imbalance = obState.askQty > obState.bidQty * STRATEGY_V2_CONFIG.imbalanceRatio;
    
    // Condition 2: Price confirmation (mid price is lower than 1 second ago)
    let priceConfirmed = false;
    if (secHistory && secHistory.length >= 2) {
        const currentMid = (obState.bestBid + obState.bestAsk) / 2;
        const oldMid = (secHistory[secHistory.length - 2].bestBid + secHistory[secHistory.length - 2].bestAsk) / 2;
        if (currentMid < oldMid) {
            priceConfirmed = true;
        }
    }
    
    return imbalance && priceConfirmed;
}

module.exports = {
    STRATEGY_V2_CONFIG,
    getLongSignal,
    getShortSignal
};

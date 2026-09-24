import { Candle } from '../../types';

// A helper for O(1) caching using Float64Array views
class IndicatorCache {
  private arrays = new Map<string, Float64Array>();
  private lengths = new Map<string, number>();

  public getArray(key: string, minCapacity: number): Float64Array {
    let arr = this.arrays.get(key);
    if (!arr || arr.length < minCapacity) {
      const newCapacity = Math.max(200000, minCapacity * 2);
      const newArr = new Float64Array(newCapacity);
      if (arr) {
        newArr.set(arr);
      } else {
        newArr.fill(NaN);
      }
      this.arrays.set(key, newArr);
      arr = newArr;
      if (!this.lengths.has(key)) this.lengths.set(key, 0);
    }
    return arr;
  }

  public getLength(key: string): number {
    return this.lengths.get(key) || 0;
  }

  public setLength(key: string, len: number) {
    this.lengths.set(key, len);
  }
  
  public clear() {
    this.arrays.clear();
    this.lengths.clear();
  }
}

const cache = new IndicatorCache();

export const calculateSMA = (candles: Candle[], period: number): number[] => {
  if (candles.length === 0) return [] as any;
  const key = `sma_${period}_${candles[0].time}`;
  const arr = cache.getArray(key, candles.length);
  let computed = cache.getLength(key);

  if (computed === 0) {
    if (candles.length >= period) {
      let sum = 0;
      for (let i = 0; i < period; i++) sum += candles[i].close;
      arr[period - 1] = sum / period;
      computed = period;
    }
  }

  for (let i = computed; i < candles.length; i++) {
    if (i >= period) {
      const prevSum = arr[i - 1] * period;
      arr[i] = (prevSum + candles[i].close - candles[i - period].close) / period;
    }
  }
  
  if (computed > 0) cache.setLength(key, candles.length);
  return arr.subarray(0, candles.length) as unknown as number[];
};

export const calculateEMA = (candles: Candle[], period: number): number[] => {
  if (candles.length === 0) return [] as any;
  const key = `ema_${period}_${candles[0].time}`;
  const arr = cache.getArray(key, candles.length);
  let computed = cache.getLength(key);

  const k = 2 / (period + 1);

  if (computed === 0) {
    if (candles.length >= period) {
      let sum = 0;
      for (let i = 0; i < period; i++) sum += candles[i].close;
      arr[period - 1] = sum / period;
      computed = period;
    }
  }

  for (let i = computed; i < candles.length; i++) {
    if (i >= period) {
      const prevEma = arr[i - 1];
      arr[i] = (candles[i].close - prevEma) * k + prevEma;
    }
  }
  
  if (computed > 0) cache.setLength(key, candles.length);
  return arr.subarray(0, candles.length) as unknown as number[];
};

export const calculateRSI = (candles: Candle[], period: number): number[] => {
  if (candles.length === 0) return [] as any;
  const key = `rsi_${period}_${candles[0].time}`;
  const keyGain = `rsigain_${period}_${candles[0].time}`;
  const keyLoss = `rsiloss_${period}_${candles[0].time}`;
  
  const arr = cache.getArray(key, candles.length);
  const gainArr = cache.getArray(keyGain, candles.length);
  const lossArr = cache.getArray(keyLoss, candles.length);
  let computed = cache.getLength(key);

  if (computed === 0) {
    if (candles.length > period) {
      let sumGain = 0;
      let sumLoss = 0;
      for (let i = 1; i <= period; i++) {
        const diff = candles[i].close - candles[i - 1].close;
        if (diff > 0) sumGain += diff;
        else sumLoss -= diff;
      }
      gainArr[period] = sumGain / period;
      lossArr[period] = sumLoss / period;
      
      let rs = gainArr[period] / (lossArr[period] || 1e-10);
      arr[period] = 100 - (100 / (1 + rs));
      computed = period + 1;
    }
  }

  for (let i = computed; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    let gain = 0;
    let loss = 0;
    if (diff > 0) gain = diff;
    else loss = -diff;
    
    gainArr[i] = (gainArr[i - 1] * (period - 1) + gain) / period;
    lossArr[i] = (lossArr[i - 1] * (period - 1) + loss) / period;
    
    let rs = gainArr[i] / (lossArr[i] || 1e-10);
    arr[i] = 100 - (100 / (1 + rs));
  }
  
  if (computed > 0) cache.setLength(key, candles.length);
  return arr.subarray(0, candles.length) as unknown as number[];
};

export const calculateTrueRange = (candles: Candle[]): number[] => {
  if (candles.length === 0) return [] as any;
  const key = `tr_${candles[0].time}`;
  const arr = cache.getArray(key, candles.length);
  let computed = cache.getLength(key);

  if (computed === 0) {
    arr[0] = candles[0].high - candles[0].low;
    computed = 1;
  }

  for (let i = computed; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    arr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }
  
  cache.setLength(key, candles.length);
  return arr.subarray(0, candles.length) as unknown as number[];
};

export const calculateATR = (candles: Candle[], period: number): number[] => {
  if (candles.length === 0) return [] as any;
  const key = `atr_${period}_${candles[0].time}`;
  const arr = cache.getArray(key, candles.length);
  let computed = cache.getLength(key);

  const tr = calculateTrueRange(candles);

  if (computed === 0 && candles.length >= period) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    arr[period - 1] = sum / period;
    computed = period;
  }

  for (let i = computed; i < candles.length; i++) {
    if (i >= period) {
      arr[i] = (arr[i - 1] * (period - 1) + tr[i]) / period;
    }
  }

  if (computed > 0) cache.setLength(key, candles.length);
  return arr.subarray(0, candles.length) as unknown as number[];
};

export const calculateVWAP = (candles: Candle[]): number[] => {
  return new Array(candles.length).fill(NaN);
};

export const calculateMACD = (candles: Candle[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9) => {
  return { macdLine: [], signalLine: [], histogram: [] };
};

export const calculateAverageVolume = (candles: Candle[], period: number): number[] => {
  if (candles.length === 0) return [] as any;
  const key = `avgvol_${period}_${candles[0].time}`;
  const arr = cache.getArray(key, candles.length);
  let computed = cache.getLength(key);

  if (computed === 0 && candles.length >= period) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += candles[i].volume || 0;
    arr[period - 1] = sum / period;
    computed = period;
  }

  for (let i = computed; i < candles.length; i++) {
    if (i >= period) {
      const prevSum = arr[i - 1] * period;
      arr[i] = (prevSum + (candles[i].volume || 0) - (candles[i - period].volume || 0)) / period;
    }
  }

  if (computed > 0) cache.setLength(key, candles.length);
  return arr.subarray(0, candles.length) as unknown as number[];
};

export const calculateADX = (candles: Candle[], period: number) => {
  if (candles.length === 0) return { adx: [], plusDI: [], minusDI: [] };
  
  const keyAdx = `adx_${period}_${candles[0].time}`;
  const keyPlusDI = `plusdi_${period}_${candles[0].time}`;
  const keyMinusDI = `minusdi_${period}_${candles[0].time}`;
  const keyPlusDM = `plusdm_${period}_${candles[0].time}`;
  const keyMinusDM = `minusdm_${period}_${candles[0].time}`;
  const keySmTR = `smtr_${period}_${candles[0].time}`;
  const keySmPlusDM = `smplusdm_${period}_${candles[0].time}`;
  const keySmMinusDM = `smminusdm_${period}_${candles[0].time}`;
  
  const arrAdx = cache.getArray(keyAdx, candles.length);
  const arrPlusDI = cache.getArray(keyPlusDI, candles.length);
  const arrMinusDI = cache.getArray(keyMinusDI, candles.length);
  const arrPlusDM = cache.getArray(keyPlusDM, candles.length);
  const arrMinusDM = cache.getArray(keyMinusDM, candles.length);
  const arrSmTR = cache.getArray(keySmTR, candles.length);
  const arrSmPlusDM = cache.getArray(keySmPlusDM, candles.length);
  const arrSmMinusDM = cache.getArray(keySmMinusDM, candles.length);

  let computed = cache.getLength(keyAdx);
  const tr = calculateTrueRange(candles);

  if (computed === 0) {
    computed = 1;
  }

  // Calculate DM
  for (let i = computed; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    
    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    
    arrPlusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
    arrMinusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
  }

  // Calculate Smoothed TR and DM
  if (computed <= period && candles.length >= period) {
    let sumTR = 0, sumPlusDM = 0, sumMinusDM = 0;
    for (let i = 1; i <= period; i++) {
      sumTR += tr[i] || 0;
      sumPlusDM += arrPlusDM[i] || 0;
      sumMinusDM += arrMinusDM[i] || 0;
    }
    arrSmTR[period] = sumTR;
    arrSmPlusDM[period] = sumPlusDM;
    arrSmMinusDM[period] = sumMinusDM;
    
    if (sumTR === 0) {
      arrPlusDI[period] = 0; arrMinusDI[period] = 0;
    } else {
      arrPlusDI[period] = 100 * (sumPlusDM / sumTR);
      arrMinusDI[period] = 100 * (sumMinusDM / sumTR);
    }
    computed = period + 1;
  }

  for (let i = Math.max(computed, period + 1); i < candles.length; i++) {
    arrSmTR[i] = arrSmTR[i - 1] - (arrSmTR[i - 1] / period) + tr[i];
    arrSmPlusDM[i] = arrSmPlusDM[i - 1] - (arrSmPlusDM[i - 1] / period) + arrPlusDM[i];
    arrSmMinusDM[i] = arrSmMinusDM[i - 1] - (arrSmMinusDM[i - 1] / period) + arrMinusDM[i];
    
    if (arrSmTR[i] === 0) {
      arrPlusDI[i] = 0; arrMinusDI[i] = 0;
    } else {
      arrPlusDI[i] = 100 * (arrSmPlusDM[i] / arrSmTR[i]);
      arrMinusDI[i] = 100 * (arrSmMinusDM[i] / arrSmTR[i]);
    }
  }

  // Calculate ADX
  if (computed <= period * 2 && candles.length >= period * 2) {
    let dxSum = 0;
    for (let i = period; i < period * 2; i++) {
      const pDI = arrPlusDI[i];
      const mDI = arrMinusDI[i];
      const dx = 100 * Math.abs(pDI - mDI) / (pDI + mDI || 1);
      dxSum += dx;
    }
    arrAdx[period * 2 - 1] = dxSum / period;
    computed = period * 2;
  }

  for (let i = Math.max(computed, period * 2); i < candles.length; i++) {
    const pDI = arrPlusDI[i];
    const mDI = arrMinusDI[i];
    const dx = 100 * Math.abs(pDI - mDI) / (pDI + mDI || 1);
    arrAdx[i] = (arrAdx[i - 1] * (period - 1) + dx) / period;
  }

  if (candles.length >= period * 2) cache.setLength(keyAdx, candles.length);
  else cache.setLength(keyAdx, computed);

  return {
    adx: arrAdx.subarray(0, candles.length) as unknown as number[],
    plusDI: arrPlusDI.subarray(0, candles.length) as unknown as number[],
    minusDI: arrMinusDI.subarray(0, candles.length) as unknown as number[]
  };
};

export const calculateBollingerBands = (candles: Candle[], period: number, stdDev: number) => {
  if (candles.length === 0) return { upper: [], middle: [], lower: [] };
  
  const keyUpper = `bb_upper_${period}_${stdDev}_${candles[0].time}`;
  const keyMiddle = `bb_middle_${period}_${stdDev}_${candles[0].time}`;
  const keyLower = `bb_lower_${period}_${stdDev}_${candles[0].time}`;

  const arrUpper = cache.getArray(keyUpper, candles.length);
  const arrMiddle = cache.getArray(keyMiddle, candles.length);
  const arrLower = cache.getArray(keyLower, candles.length);

  let computed = cache.getLength(keyMiddle);

  if (computed === 0 && candles.length >= period) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += candles[i].close;
    const mean = sum / period;
    
    let sumSq = 0;
    for (let i = 0; i < period; i++) sumSq += Math.pow(candles[i].close - mean, 2);
    const sd = Math.sqrt(sumSq / period);
    
    arrMiddle[period - 1] = mean;
    arrUpper[period - 1] = mean + (stdDev * sd);
    arrLower[period - 1] = mean - (stdDev * sd);
    computed = period;
  }

  for (let i = computed; i < candles.length; i++) {
    if (i >= period) {
      let sum = 0;
      // We could optimize SMA, but since BB uses stdDev which needs O(N) over window anyway, 
      // simple trailing window is fine for 1 minute calculations over small period (e.g. 20)
      for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
      const mean = sum / period;
      
      let sumSq = 0;
      for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(candles[j].close - mean, 2);
      const sd = Math.sqrt(sumSq / period);

      arrMiddle[i] = mean;
      arrUpper[i] = mean + (stdDev * sd);
      arrLower[i] = mean - (stdDev * sd);
    }
  }

  if (computed > 0) cache.setLength(keyMiddle, candles.length);
  
  return {
    upper: arrUpper.subarray(0, candles.length) as unknown as number[],
    middle: arrMiddle.subarray(0, candles.length) as unknown as number[],
    lower: arrLower.subarray(0, candles.length) as unknown as number[]
  };
};

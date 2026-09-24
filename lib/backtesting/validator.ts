import { BacktestEngine } from './engine';
import { BacktestConfig, BacktestMetrics, Strategy } from '../../types/strategy';
import { Candle } from '../../types';

export type ValidationPeriod = {
  name: string;
  candles: Candle[];
};

export type ValidationReport = {
  baseline: BacktestMetrics;
  highFee: BacktestMetrics;
  highSlippage: BacktestMetrics;
};

export type SplitResult = {
  train: ValidationReport;
  validation: ValidationReport;
  test: ValidationReport;
  verdict: 'INSUFFICIENT DATA' | 'INSUFFICIENT TRADES' | 'FAILED OUT-OF-SAMPLE' | 'PROMISING — REQUIRES PAPER TRADING' | 'PASSED VALIDATION — READY FOR NEXT PAPER-TRADING PHASE';
};

export type WalkForwardResult = {
  windows: {
    train: ValidationReport;
    test: ValidationReport;
  }[];
  verdict: string;
};

export class StrategyValidator {
  private strategy: Strategy;
  private baseConfig: BacktestConfig;

  constructor(strategy: Strategy, baseConfig: BacktestConfig) {
    this.strategy = strategy;
    this.baseConfig = baseConfig;
  }

  private runCostSensitivity(candles: Candle[]): ValidationReport {
    // 1. Baseline
    const baselineEngine = new BacktestEngine(this.strategy, this.baseConfig);
    const baseline = baselineEngine.run(candles);

    // 2. High Fee (2x fees)
    const highFeeConfig = { ...this.baseConfig, costConfig: { feePerSidePct: (this.baseConfig.costConfig?.feePerSidePct ?? 0.20) * 2, slippagePerSidePct: (this.baseConfig.costConfig?.slippagePerSidePct ?? 0.10) } };
    const highFeeEngine = new BacktestEngine(this.strategy, highFeeConfig);
    const highFee = highFeeEngine.run(candles);

    // 3. High Slippage (3x slippage)
    const highSlippageConfig = { ...this.baseConfig, costConfig: { feePerSidePct: (this.baseConfig.costConfig?.feePerSidePct ?? 0.20), slippagePerSidePct: (this.baseConfig.costConfig?.slippagePerSidePct ?? 0.10) * 3 } };
    const highSlippageEngine = new BacktestEngine(this.strategy, highSlippageConfig);
    const highSlippage = highSlippageEngine.run(candles);

    return { baseline, highFee, highSlippage };
  }

  public runChronologicalSplit(candles: Candle[], trainPct = 0.6, valPct = 0.2): SplitResult {
    if (candles.length < 100) {
      return this.emptyResult('INSUFFICIENT DATA');
    }

    const trainEnd = Math.floor(candles.length * trainPct);
    const valEnd = Math.floor(candles.length * (trainPct + valPct));

    const trainCandles = candles.slice(0, trainEnd);
    const valCandles = candles.slice(trainEnd, valEnd);
    const testCandles = candles.slice(valEnd);

    const trainResult = this.runCostSensitivity(trainCandles);
    const valResult = this.runCostSensitivity(valCandles);
    const testResult = this.runCostSensitivity(testCandles);

    let verdict = this.evaluateVerdict(trainResult.baseline, valResult.baseline, testResult.baseline);

    return {
      train: trainResult,
      validation: valResult,
      test: testResult,
      verdict
    };
  }

  public runWalkForward(candles: Candle[], windowSize: number, stepSize: number): WalkForwardResult {
    const windows = [];
    
    for (let i = 0; i <= candles.length - windowSize - stepSize; i += stepSize) {
      const trainCandles = candles.slice(i, i + windowSize);
      const testCandles = candles.slice(i + windowSize, i + windowSize + stepSize);
      
      windows.push({
        train: this.runCostSensitivity(trainCandles),
        test: this.runCostSensitivity(testCandles)
      });
    }

    let verdict = 'INSUFFICIENT DATA';
    if (windows.length > 0) {
      verdict = 'COMPLETED';
    }

    return { windows, verdict };
  }

  private emptyResult(verdict: any): SplitResult {
    const emptyMetrics = new BacktestEngine(this.strategy, this.baseConfig).run([{time:0, open:0, high:0, low:0, close:0}]);
    const emptyReport = { baseline: emptyMetrics, highFee: emptyMetrics, highSlippage: emptyMetrics };
    return {
      train: emptyReport,
      validation: emptyReport,
      test: emptyReport,
      verdict
    };
  }

  private evaluateVerdict(train: BacktestMetrics, val: BacktestMetrics, test: BacktestMetrics): SplitResult['verdict'] {
    const totalTrades = train.totalTrades + val.totalTrades + test.totalTrades;
    
    if (totalTrades < 30) {
      return 'INSUFFICIENT TRADES';
    }

    if (test.profitFactor < 1.0 || test.netProfit < 0) {
      return 'FAILED OUT-OF-SAMPLE';
    }

    if (test.profitFactor > 1.2 && val.profitFactor > 1.1) {
      return 'PASSED VALIDATION — READY FOR NEXT PAPER-TRADING PHASE';
    }

    return 'PROMISING — REQUIRES PAPER TRADING';
  }
}

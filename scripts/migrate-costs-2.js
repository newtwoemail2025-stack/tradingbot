const fs = require('fs');
const filesToFix = [
  'components/strategy/StrategyConfigPanel.tsx',
  'lib/backtesting/__tests__/audit.test.ts',
  'lib/backtesting/validator.ts',
  'scripts/run-mega-validation.ts',
  'scripts/run-phase6.ts',
  'scripts/test-math.ts'
];

for (const file of filesToFix) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');

  // StrategyConfigPanel
  if (file.includes('StrategyConfigPanel.tsx')) {
    content = content.replace(/onChange=\{\(val\) => onChange\(\{ \.\.\.config, costConfig: \{ \.\.\.config\.costConfig, feePerSidePct: val, slippagePerSidePct: config\.costConfig\?\.slippagePerSidePct \?\? 0\.10 \} \}\)\}/g, 'onChange={(val) => onChange({ ...config, costConfig: { ...config.costConfig, feePerSidePct: val, slippagePerSidePct: config.costConfig?.slippagePerSidePct ?? 0.10 } })}'); // Actually the script already did this. But let me fix the compile error. The compile error in tsc was line 138: Argument of type '"tradingFeePercent"' is not assignable to parameter of type 'keyof BacktestConfig'.
    // Look at line 138: probably `field="tradingFeePercent"` on a custom component?
    content = content.replace(/field="tradingFeePercent"/g, 'field="costConfig.feePerSidePct"');
    content = content.replace(/field="slippagePercent"/g, 'field="costConfig.slippagePerSidePct"');
  }

  // audit.test.ts
  if (file.includes('audit.test.ts')) {
    content = content.replace(/tradingFeePercent: 0\.1/g, 'costConfig: { feePerSidePct: 0.1, slippagePerSidePct: 0.05 }');
    content = content.replace(/tradingFeePercent: 0\.2/g, 'costConfig: { feePerSidePct: 0.2, slippagePerSidePct: 0.1 }');
    content = content.replace(/tradingFeePercent: 0/g, 'costConfig: { feePerSidePct: 0, slippagePerSidePct: 0 }');
    content = content.replace(/slippagePercent:\s*[\d\.]+,?/g, ''); // Clean up left overs
  }

  // validator.ts
  if (file.includes('validator.ts')) {
    content = content.replace(/typeof config\.tradingFeePercent !== 'number'/g, 'typeof config.costConfig?.feePerSidePct !== "number"');
    content = content.replace(/typeof config\.slippagePercent !== 'number'/g, 'typeof config.costConfig?.slippagePerSidePct !== "number"');
  }

  // run-mega-validation.ts and run-phase6.ts
  if (file.includes('run-mega-validation.ts') || file.includes('run-phase6.ts')) {
    content = content.replace(/tradingFeePercent: 0\.1,/g, 'costConfig: { feePerSidePct: 0.1, slippagePerSidePct: 0.05 },');
    content = content.replace(/slippagePercent: 0\.05,/g, '');
  }
  
  // test-math.ts
  if (file.includes('test-math.ts')) {
    content = content.replace(/tradingFeePercent: 0,/g, 'costConfig: { feePerSidePct: 0, slippagePerSidePct: 0 },');
    content = content.replace(/slippagePercent: 0,/g, '');
  }

  fs.writeFileSync(file, content, 'utf8');
}
console.log("Migration 2 complete.");

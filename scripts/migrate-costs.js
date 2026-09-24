const fs = require('fs');
const glob = require('glob'); // Note: we can use a simpler approach

const filesToFix = [
  'app/strategy-lab/page.tsx',
  'components/strategy/StrategyConfigPanel.tsx',
  'lib/backtesting/__tests__/audit.test.ts',
  'lib/backtesting/__tests__/engine.test.ts',
  'lib/backtesting/__tests__/validator.test.ts',
  'lib/backtesting/validator.ts',
  'scripts/run-mega-validation.ts',
  'scripts/run-phase4.ts',
  'scripts/run-phase6.ts',
  'scripts/run-phase8.ts',
  'scripts/run-phase9-v4.ts',
  'scripts/run-validation.ts',
  'scripts/test-math.ts',
  'scripts/format-audit.ts'
];

for (const file of filesToFix) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace generic object literals
  content = content.replace(/tradingFeePercent:\s*([\d\.]+),?\s*slippagePercent:\s*([\d\.]+),?/g, 'costConfig: { feePerSidePct: $1, slippagePerSidePct: $2 },');
  // Some might be on multiple lines
  content = content.replace(/tradingFeePercent:\s*([\d\.]+),[\s\n]*slippagePercent:\s*([\d\.]+),?/g, 'costConfig: {\n      feePerSidePct: $1,\n      slippagePerSidePct: $2\n    },');

  // Specific fixes for UI components or validator
  content = content.replace(/config\.tradingFeePercent/g, '(config.costConfig?.feePerSidePct ?? 0.20)');
  content = content.replace(/config\.slippagePercent/g, '(config.costConfig?.slippagePerSidePct ?? 0.10)');

  // Formatter specifically
  if (file.includes('StrategyConfigPanel.tsx')) {
    content = content.replace(/onChange=\{\(val\) => onChange\(\{ \.\.\.config, tradingFeePercent: val \}\)\}/g, 'onChange={(val) => onChange({ ...config, costConfig: { ...config.costConfig, feePerSidePct: val, slippagePerSidePct: config.costConfig?.slippagePerSidePct ?? 0.10 } })}');
    content = content.replace(/onChange=\{\(val\) => onChange\(\{ \.\.\.config, slippagePercent: val \}\)\}/g, 'onChange={(val) => onChange({ ...config, costConfig: { ...config.costConfig, slippagePerSidePct: val, feePerSidePct: config.costConfig?.feePerSidePct ?? 0.20 } })}');
    // For values
    content = content.replace(/value=\{config\.tradingFeePercent\}/g, 'value={config.costConfig?.feePerSidePct ?? 0.20}');
    content = content.replace(/value=\{config\.slippagePercent\}/g, 'value={config.costConfig?.slippagePerSidePct ?? 0.10}');
  }
  
  fs.writeFileSync(file, content, 'utf8');
}
console.log("Migration complete.");

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

describe("Phase 12 Market Data Validation", () => {
  it("should have saved real orderbook data", () => {
    const obPath = path.join(__dirname, "../research/phase12/phase12-orderbook.csv");
    expect(fs.existsSync(obPath)).to.be.true;
    
    const content = fs.readFileSync(obPath, "utf-8");
    const lines = content.split("\\n").filter(l => l.trim().length > 0);
    expect(lines.length).to.be.greaterThan(1); // header + at least 1 row
    
    const lastLine = lines[lines.length - 1].split(",");
    
    // Check Bid/Ask parsing
    const bid = parseFloat(lastLine[1]);
    const ask = parseFloat(lastLine[2]);
    expect(bid).to.be.greaterThan(0);
    expect(ask).to.be.greaterThan(bid);
    
    // Check spread calculation
    const spread = parseFloat(lastLine[3]);
    expect(spread).to.be.closeTo(ask - bid, 0.0001);
    
    // Check imbalance
    const imb = parseFloat(lastLine[7]);
    expect(imb).to.be.greaterThanOrEqual(0);
    expect(imb).to.be.lessThanOrEqual(1);
  });

  it("should have parsed the instrument correctly", () => {
    const reportPath = path.join(__dirname, "../research/phase12/phase12-report.md");
    expect(fs.existsSync(reportPath)).to.be.true;
    const content = fs.readFileSync(reportPath, "utf-8");
    
    expect(content).to.include("B-BTC_USDT");
    expect(content).to.include("Maker fee");
    expect(content).to.include("Minimum notional: 60");
    expect(content).to.include("Quantity step: 0.001");
    expect(content).to.include("Is 3x allowed?: YES");
  });

  it("should have saved real trade data", () => {
    const trPath = path.join(__dirname, "../research/phase12/phase12-trades.csv");
    expect(fs.existsSync(trPath)).to.be.true;
    
    const content = fs.readFileSync(trPath, "utf-8");
    const lines = content.split("\\n").filter(l => l.trim().length > 0);
    
    // We can't guarantee a trade happened in 60s, but we can check the file exists and has headers
    expect(lines[0]).to.include("timestamp,price,quantity,is_maker");
  });
  
  it("should not be using simulated market data", () => {
     // A simple heuristic: ensure none of the values are exactly our old hardcoded constants
     const reportPath = path.join(__dirname, "../research/phase12/phase12-report.md");
     const content = fs.readFileSync(reportPath, "utf-8");
     expect(content).to.not.include("0.20% fee");
     expect(content).to.not.include("0.10% slippage");
  });
});

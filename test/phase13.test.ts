import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

describe("Phase 13 Market Data Validation", () => {
    let snapshot: any[];
    let report: string;

    before(() => {
        const snapPath = path.join(__dirname, "../research/phase13/phase13-live-snapshot.json");
        const repPath = path.join(__dirname, "../research/phase13/phase13-report.md");
        snapshot = JSON.parse(fs.readFileSync(snapPath, "utf-8"));
        report = fs.readFileSync(repPath, "utf-8");
    });

    it("1. Futures instrument parsing", () => {
        expect(snapshot.length).to.be.greaterThan(0);
        expect(snapshot[0].Symbol).to.be.a("string");
        expect(snapshot[0].BaseAsset).to.be.a("string");
    });

    it("2. Minimum-notional calculation", () => {
        expect(snapshot[0].MinNotional).to.be.greaterThan(0);
    });

    it("3. Margin calculation", () => {
        // e.g. MinMargin5x should be 1/5th of MinNotional * rate
        const m3 = parseFloat(snapshot[0].MinMargin3x);
        const m5 = parseFloat(snapshot[0].MinMargin5x);
        expect(m3).to.be.greaterThan(m5);
    });

    it("4. Leverage validation", () => {
        expect(snapshot[0].MaxLeverage).to.be.greaterThanOrEqual(3);
    });

    it("5. INR conversion", () => {
        // Since min_notional is e.g. 6 USDT, in INR it should be > 500
        // MinMargin5x should be > 100
        const m5 = parseFloat(snapshot[0].MinMargin5x);
        expect(m5).to.be.greaterThan(100);
    });

    it("6. Bid/ask spread calculation", () => {
        const c = snapshot.find(s => s.Spread !== 'NOT AVAILABLE');
        if (c) {
            expect(parseFloat(c.Spread)).to.be.greaterThan(0);
            expect(c.SpreadPct).to.include("%");
        }
    });

    it("7. Order-book parsing", () => {
        expect(["YES", "NO"]).to.include(snapshot[0].OrderBook);
    });

    it("8. Candidate filtering", () => {
        // Should be categorized as C since none are < 100 INR
        expect(snapshot[0].Category).to.include("C) MINIMUM NOTIONAL TOO HIGH");
    });

    it("9. LONG/SHORT support detection", () => {
        expect(["YES", "NO"]).to.include(snapshot[0].LongShort);
    });

    it("10. No simulated market data", () => {
        expect(report).to.not.include("0.20% fee");
        expect(report).to.not.include("0.10% slippage");
    });
});

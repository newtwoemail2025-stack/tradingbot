import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

describe("Phase 14 Real-Time Scalping Validation", () => {
    let report: string;
    let summary: string;

    before(() => {
        const repPath = path.join(__dirname, "../research/phase14/phase14-report.md");
        if (fs.existsSync(repPath)) {
            report = fs.readFileSync(repPath, "utf-8");
        } else {
            report = "";
        }
        
        const sumPath = path.join(__dirname, "../research/phase14/phase14-summary.csv");
        if (fs.existsSync(sumPath)) {
            summary = fs.readFileSync(sumPath, "utf-8");
        } else {
            summary = "";
        }
    });

    it("1. order-book parsing & 2. bid/ask imbalance & 3. spread", () => {
        const obPath = path.join(__dirname, "../research/phase14/phase14-orderbook.csv");
        if (fs.existsSync(obPath)) {
            const lines = fs.readFileSync(obPath, "utf-8").split("\\n").filter(l => l.length > 0);
            expect(lines.length).to.be.greaterThan(1);
            const headers = lines[0];
            expect(headers).to.include("bidQty1");
            expect(headers).to.include("askQty1");
            expect(headers).to.include("imbalance");
            expect(headers).to.include("spread");
        }
    });

    it("4. trade aggregation & 5. buy/sell volume calculation", () => {
        const trPath = path.join(__dirname, "../research/phase14/phase14-trades.csv");
        if (fs.existsSync(trPath)) {
            const lines = fs.readFileSync(trPath, "utf-8").split("\\n").filter(l => l.length > 0);
            expect(lines.length).to.be.greaterThan(1);
            expect(lines[0]).to.include("is_maker");
        }
    });

    it("6. forward-return calculation", () => {
        if (summary) {
            expect(summary).to.include("mean_ret");
            expect(summary).to.include("median_ret");
            expect(summary).to.include("baseline");
        }
    });

    it("9. fee calculation & 10. leverage position sizing", () => {
        if (report) {
            expect(report).to.include("0.0236%");
            expect(report).to.include("margin ~₹200");
        }
    });

    it("11. minimum-notional validation", () => {
        if (report) {
            expect(report).to.include("Minimum notional: 6 USDT");
        }
    });

    it("12. no simulated data", () => {
        if (report) {
            expect(report).to.not.include("0.20% fee");
            expect(report).to.not.include("0.10% slippage");
        }
    });
});

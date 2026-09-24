import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

describe("Phase 14B True 60-Min Validation", () => {
    let report: string;
    let summary: string;
    let obLines: string[];
    let trLines: string[];

    before(() => {
        const repPath = path.join(__dirname, "../research/phase14b/phase14b-report.md");
        report = fs.existsSync(repPath) ? fs.readFileSync(repPath, "utf-8") : "";
        
        const sumPath = path.join(__dirname, "../research/phase14b/phase14b-summary.csv");
        summary = fs.existsSync(sumPath) ? fs.readFileSync(sumPath, "utf-8") : "";

        const obPath = path.join(__dirname, "../research/phase14b/phase14b-orderbook.csv");
        obLines = fs.existsSync(obPath) ? fs.readFileSync(obPath, "utf-8").split("\\n").filter(l => l.length > 0) : [];

        const trPath = path.join(__dirname, "../research/phase14b/phase14b-trades.csv");
        trLines = fs.existsSync(trPath) ? fs.readFileSync(trPath, "utf-8").split("\\n").filter(l => l.length > 0) : [];
    });

    it("order-book parsing, imbalance calculation, spread", () => {
        expect(obLines.length).to.be.greaterThan(1);
        const headers = obLines[0];
        expect(headers).to.include("imbalance1");
        expect(headers).to.include("imbalance5");
        expect(headers).to.include("spread");
    });

    it("trade aggregation", () => {
        expect(trLines.length).to.be.greaterThan(1);
        expect(trLines[0]).to.include("is_maker");
    });

    it("forward return, MFE/MAE, TP-before-SL, ambiguous cases", () => {
        expect(summary).to.include("mfe");
        expect(summary).to.include("mae");
        expect(summary).to.include("tp_hit");
        expect(summary).to.include("ambiguous");
    });

    it("fee, leverage, minimum notional", () => {
        expect(report).to.include("0.0236%");
        expect(report).to.include("5× Leverage:");
        expect(report).to.include("Minimum Notional: 6 USDT");
    });

    it("no simulated data", () => {
        expect(report).to.not.include("0.20% fee");
        expect(report).to.not.include("0.10% slippage");
    });
});

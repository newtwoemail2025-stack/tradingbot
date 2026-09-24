const fs = require('fs');
const readline = require('readline');

async function analyze() {
    const fileStream = fs.createReadStream('data/phase33f_retry/raw_depth_updates.jsonl');
    const rl = readline.createInterface({ input: fileStream });

    let localBids = new Map();
    let localAsks = new Map();
    let count = 0;

    for await (const line of rl) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        const payload = msg.payload;
        if (payload.bids) {
            for (const [p, q] of Object.entries(payload.bids)) {
                if (Number(q) === 0) localBids.delete(p);
                else localBids.set(p, Number(q));
            }
        }
        if (payload.asks) {
            for (const [p, q] of Object.entries(payload.asks)) {
                if (Number(q) === 0) localAsks.delete(p);
                else localAsks.set(p, Number(q));
            }
        }

        if (localBids.size === 0 || localAsks.size === 0) continue;

        let maxBid = -1;
        for (const p of localBids.keys()) {
            if (Number(p) > maxBid) maxBid = Number(p);
        }
        let minAsk = Infinity;
        for (const p of localAsks.keys()) {
            if (Number(p) < minAsk) minAsk = Number(p);
        }

        const isValid = Number.isFinite(maxBid) && Number.isFinite(minAsk) && maxBid > 0 && minAsk > 0 && maxBid < minAsk;
        
        if (!isValid) {
            count++;
            if (count <= 5) {
                console.log(`Crossed! Bid: ${maxBid}, Ask: ${minAsk}`);
                console.log(`Bids top 3:`, Array.from(localBids.keys()).map(Number).sort((a,b)=>b-a).slice(0,3));
                console.log(`Asks top 3:`, Array.from(localAsks.keys()).map(Number).sort((a,b)=>a-b).slice(0,3));
            }
        }
    }
}
analyze();

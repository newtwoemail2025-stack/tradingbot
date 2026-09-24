import * as fs from 'fs';
import * as path from 'path';

describe('Historical Data Integrity', () => {
  const dataPath = path.join(__dirname, '../../../public/data/btc-inr-14d-1m.json');
  let data: any[];

  beforeAll(() => {
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    data = JSON.parse(rawData);
  });

  it('should have exactly 20160 candles (14 days of 1-minute data)', () => {
    expect(data.length).toBe(20160);
  });

  it('should be strictly chronologically ordered', () => {
    for (let i = 1; i < data.length; i++) {
      expect(data[i].time).toBeGreaterThan(data[i - 1].time);
    }
  });

  it('should have exactly 1-minute gaps between all candles', () => {
    let missingGaps = 0;
    for (let i = 1; i < data.length; i++) {
      const gap = data[i].time - data[i - 1].time;
      if (gap !== 60000) {
        missingGaps++;
      }
    }
    expect(missingGaps).toBe(0);
  });

  it('should not contain any duplicate timestamps', () => {
    const timestamps = new Set(data.map(c => c.time));
    expect(timestamps.size).toBe(data.length);
  });
});

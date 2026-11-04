import { describe, it, expect } from 'vitest';
import { macrsRate, MACRS_TABLES, RECOVERY_CLASSES } from './macrs';

// #337: the Pub 946 Appendix A percentages, as printed. A formula alone is off by a cent here and
// there (7-year HY prints 8.93, 8.92, 8.93; 7-year MQ Q2 year 1 prints 17.85), so the tables are literal.
describe('MACRS rates (Pub 946 Appendix A)', () => {
  it('7-year, 200DB, half-year (Table A-1)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(y => macrsRate(7, '200DB', 'HY', null, y)))
      .toEqual([14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46]);
  });

  it('7-year, 200DB, mid-quarter, placed in the fourth quarter (Table A-5)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(y => macrsRate(7, '200DB', 'MQ', 4, y)))
      .toEqual([3.57, 27.55, 19.68, 14.06, 10.04, 8.73, 8.73, 7.64]);
  });

  it('7-year, mid-quarter, first year by quarter, as printed (Q2 is 17.85)', () => {
    expect([1, 2, 3, 4].map(q => macrsRate(7, '200DB', 'MQ', q as 1 | 2 | 3 | 4, 1))).toEqual([25.0, 17.85, 10.71, 3.57]);
  });

  it('is 0 before the first year and after the last', () => {
    expect(macrsRate(7, '200DB', 'HY', null, 0)).toBe(0);
    expect(macrsRate(7, '200DB', 'HY', null, 9)).toBe(0);
  });

  // Every table: each recovery period adds up to 100%, and each year is within a cent of the
  // declining-balance-to-straight-line formula, which catches a mistyped digit.
  const formula = (life: number, factor: number, firstFrac: number): number[] => {
    const out: number[] = [];
    let left = 1, used = 0;
    for (let y = 0; left > 1e-9; y++) {
      const frac = y === 0 ? firstFrac : 1;
      const remaining = life - used;
      const db = factor ? left * (factor / life) * frac : 0;
      const sl = remaining > 0 ? left * Math.min(frac, remaining) / remaining : left;
      const d = Math.min(Math.max(db, sl), left);
      out.push(d * 100); left -= d; used += frac;
    }
    return out;
  };
  const firstFraction = (convention: 'HY' | 'MQ', quarter: number | null) =>
    convention === 'HY' ? 0.5 : (12 - 3 * quarter! + 1.5) / 12;
  for (const [key, table] of Object.entries(MACRS_TABLES)) {
    for (const years of RECOVERY_CLASSES) {
      const rates = table.rates[years];
      if (!rates) continue;
      it(`${key} (${table.title}), ${years}-year: sums to 100 and matches the formula`, () => {
        expect(rates.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
        const factor = table.method === '200DB' ? 2 : table.method === '150DB' ? 1.5 : 0;
        const expected = formula(years, factor, firstFraction(table.convention, table.quarter));
        expect(rates).toHaveLength(expected.length);
        rates.forEach((r, i) => expect(Math.abs(r - expected[i])).toBeLessThanOrEqual(0.015));
      });
    }
  }
});

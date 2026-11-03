import { describe, it, expect } from 'vitest';
import {
  vintagesFrom, line17For, estimateOpenYear, filedYearView,
  type PlacedItem, type DisposedItem,
} from './depreciationEstimate';
import type { TaxYearDepreciation } from '../services/taxYearDepreciation.service';

// #337, the plan's section 8 shapes (invented amounts).
const blank = {
  line_12: null, line_14: null, line_17: null, line_21: null, line_22: null,
  planned_179: null, planned_bonus: null, other_expected: null, estimate_convention: 'HY' as const,
  updated_at: null, updated_by_name: null,
};
// Year 1: Section 179 $4,000; 7-year MQ, $6,000, all in Q4 → $214; line 22 $4,214.
const y2024: TaxYearDepreciation = { ...blank, year: 2024, line_12: 4000, line_22: 4214,
  rows: [{ recovery_years: 7, basis: 6000, convention: 'MQ', method: '200DB', deduction: 214 }] };
// Year 2: line 17 = $6,000 × 27.55% = $1,653; 7-year HY $3,000 → $429; line 22 $2,082.
const y2025: TaxYearDepreciation = { ...blank, year: 2025, line_17: 1653, line_22: 2082,
  rows: [{ recovery_years: 7, basis: 3000, convention: 'HY', method: '200DB', deduction: 429 }] };
const filed = [y2025, y2024];
const bought2026: PlacedItem[] = [{ date: '2026-03-10', cost: 2000, recoveryYears: 7 }];

describe('vintages', () => {
  it('a mid-quarter row with no purchases recorded takes its quarters from its deduction: $214 on $6,000 is all Q4', () => {
    const [v] = vintagesFrom([y2024], []);
    expect(v).toMatchObject({ year: 2024, basis: 6000, convention: 'MQ', quarters: [0, 0, 0, 6000], quartersApproximated: true });
  });

  it('a deduction between two quarters\' rates splits the basis so year 1 comes out exactly', () => {
    // 14.28% lies between Q2 (17.85%) and Q3 (10.71%): $5,000 in each gives $892.50 + $535.50 = $1,428.
    const y = { ...y2024, rows: [{ recovery_years: 7 as const, basis: 10000, convention: 'MQ' as const, method: '200DB' as const, deduction: 1428 }] };
    expect(vintagesFrom([y], [])[0].quarters).toEqual([0, 5000, 5000, 0]);
  });

  it('with no deduction either, all of a mid-quarter row goes in Q4', () => {
    const y = { ...y2024, rows: [{ ...y2024.rows[0], deduction: null }] };
    expect(vintagesFrom([y], [])[0]).toMatchObject({ quarters: [0, 0, 0, 6000], quartersApproximated: true });
  });

  it('uses the purchase dates for the quarters when the app has that year\'s purchases of the class', () => {
    const bought: PlacedItem[] = [{ date: '2024-02-10', cost: 4000, recoveryYears: 7 }, { date: '2024-11-20', cost: 6000, recoveryYears: 7 }];
    const y = { ...y2024, rows: [{ ...y2024.rows[0], basis: 5000 }] };
    expect(vintagesFrom([y], bought)[0]).toMatchObject({ quarters: [2000, 0, 0, 3000], quartersApproximated: false });
  });
});

describe('line 17', () => {
  it('the later year\'s line 17 is the earlier basis × its year-2 rate (the cross-check)', () => {
    expect(line17For(2025, vintagesFrom(filed, [])).total).toBe(1653);
  });
});

describe('the open year\'s estimate', () => {
  it('projects line 17 from every year entered, and adds this year\'s purchases; every row in whole dollars, the total their sum', () => {
    const e = estimateOpenYear({ year: 2026, figures: null, filed, purchases: bought2026, disposals: [] });
    expect(e.rows.map(r => [r.label, r.amount])).toEqual([
      ['Line 17: 2024 equipment, 7-year MQ (Q4 $6,000 × 19.68%)', 1181],
      ['Line 17: 2025 equipment, 7-year HY ($3,000 × 24.49%)', 735],
      ['Line 19: 2026 purchases, 7-year HY ($2,000 × 14.29%)', 286],
    ]);
    expect(e.total).toBe(2202);
    expect(e.gap).toBeNull();
  });

  it('a disposal this year is its own row: the half year not taken (HY)', () => {
    const gone: DisposedItem[] = [{ bought: '2025-05-01', disposed: '2026-06-01', cost: 500, recoveryYears: 7 }];
    const bought2025: PlacedItem[] = [{ date: '2025-05-01', cost: 3000, recoveryYears: 7 }];
    const e = estimateOpenYear({ year: 2026, figures: null, filed, purchases: [...bought2025, ...bought2026], disposals: gone });
    expect(e.rows).toContainEqual({ label: '2025 equipment disposed of in 2026 (half year)', amount: -61 });
    expect(e.total).toBe(1181 + 735 - 61 + 286);
  });

  it('equipment disposed of in an earlier year no longer counts', () => {
    const gone: DisposedItem[] = [{ bought: '2025-05-01', disposed: '2025-12-01', cost: 3000, recoveryYears: 7 }];
    const bought2025: PlacedItem[] = [{ date: '2025-05-01', cost: 3000, recoveryYears: 7 }];
    const e = estimateOpenYear({ year: 2026, figures: null, filed, purchases: [...bought2025, ...bought2026], disposals: gone });
    expect(e.rows.find(r => r.label.startsWith('Line 17: 2025'))).toBeUndefined();
  });

  it('planned Section 179 comes off this year\'s basis; planned and other amounts are added as entered', () => {
    const figures = { ...blank, year: 2026, planned_179: 500, other_expected: 300, rows: [] };
    const e = estimateOpenYear({ year: 2026, figures, filed, purchases: bought2026, disposals: [] });
    expect(e.rows).toContainEqual({ label: 'Line 19: 2026 purchases, 7-year HY ($1,500 × 14.29%)', amount: 214 });
    expect(e.rows).toContainEqual({ label: 'Line 12: Section 179 (planned)', amount: 500 });
    expect(e.rows).toContainEqual({ label: 'Other depreciation you expect', amount: 300 });
  });

  it('picking mid-quarter uses this year\'s purchase dates', () => {
    const figures = { ...blank, year: 2026, estimate_convention: 'MQ' as const, rows: [] };
    const e = estimateOpenYear({ year: 2026, figures, filed, purchases: [{ date: '2026-11-15', cost: 2000, recoveryYears: 7 }], disposals: [] });
    expect(e.rows).toContainEqual({ label: 'Line 19: 2026 purchases, 7-year MQ (Q4 $2,000 × 3.57%)', amount: 71 });
  });

  it('shows the part of the last filed year\'s line 17 the entered years don\'t explain, and doesn\'t carry it forward', () => {
    const later = { ...y2025, line_17: 2065 };
    const e = estimateOpenYear({ year: 2026, figures: null, filed: [later, y2024], purchases: [], disposals: [] });
    expect(e.gap).toEqual({ year: 2025, amount: 412 });
    expect(e.total).toBe(1181 + 735);
  });
});

describe('a filed year', () => {
  it('shows line 22, its parts, and that line 17 matches the years entered', () => {
    const v = filedYearView(y2025, vintagesFrom(filed, []));
    expect(v.total).toBe(2082);
    expect(v.rows.map(r => [r.label, r.amount])).toEqual([
      ['Line 17: equipment from earlier years', 1653],
      ['Line 19(g): 2025 equipment, 7-year HY', 429],
    ]);
    expect(v.line17Check).toEqual({ entered: 1653, fromYearsEntered: 1653 });
    expect(v.unexplained).toBe(0);
  });

  it('says how much of line 22 comes from lines not entered here; line 22 wins', () => {
    const v = filedYearView({ ...y2025, line_22: 2100 }, vintagesFrom(filed, []));
    expect(v.total).toBe(2100);
    expect(v.unexplained).toBe(18);
  });

  it('with no figures, it is not entered', () => {
    expect(filedYearView(null, []).status).toBe('not-entered');
  });
});

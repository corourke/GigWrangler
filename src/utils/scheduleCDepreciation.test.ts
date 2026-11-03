import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { buildIncomeReport, buildExpenseReport, type ReportPurchaseLine, type ReportGigRow } from './taxReports';
import { buildScheduleCSummary, scheduleCCsv } from './taxSummaryReports';
import { buildLine13 } from './scheduleCDepreciation';
import type { TaxYearDepreciation } from '../services/taxYearDepreciation.service';

// #337 PR 3: Schedule C line 13, depreciation and section 179. Every amount is invented.
const blank = {
  line_12: null, line_14: null, line_17: null, line_21: null, line_22: null,
  planned_179: null, planned_bonus: null, other_expected: null, estimate_convention: 'HY' as const,
  updated_at: null, updated_by_name: null,
};
const y2024: TaxYearDepreciation = { ...blank, year: 2024, line_12: 4000, line_22: 4214,
  rows: [{ recovery_years: 7, basis: 6000, convention: 'MQ', method: '200DB', deduction: 214 }] };
const y2025: TaxYearDepreciation = { ...blank, year: 2025, line_17: 1653, line_22: 2082,
  rows: [{ recovery_years: 7, basis: 3000, convention: 'HY', method: '200DB', deduction: 429 }] };
const figures = [y2025, y2024];
const locked = new Set([2024, 2025]);

describe('line 13 on the Schedule C report', () => {
  it('a year with line 22 entered uses it: "Form 4562 line 22", its breakdown and the line 17 check', () => {
    const l = buildLine13({ year: 2025, net: 10000, figures, locked, purchases: [], disposals: [] });
    expect(l).toMatchObject({ source: 'Form 4562 line 22', amount: 2082, netAfter: 7918, line17Check: { entered: 1653, fromYearsEntered: 1653 }, unexplained: 0 });
    expect(l.rows.map(r => r.label)).toEqual(['Line 17: equipment from earlier years', 'Line 19(g): 2025 equipment, 7-year HY']);
  });

  it('a locked year with nothing entered is "Not entered", with no amount and no net after depreciation', () => {
    const l = buildLine13({ year: 2023, net: 5000, figures, locked: new Set([2023]), purchases: [], disposals: [] });
    expect(l).toMatchObject({ source: 'Not entered', amount: null, netAfter: null, rows: [] });
  });

  it('an open year is "Estimated" from the years entered and its purchases', () => {
    const l = buildLine13({ year: 2026, net: 10000, figures, locked, purchases: [{ date: '2026-03-10', cost: 2000, recoveryYears: 7 }], disposals: [] });
    expect(l).toMatchObject({ source: 'Estimated', amount: 2202, netAfter: 7798, gap: null });
    expect(l.rows).toHaveLength(3);
  });

  it('an unlocked year with line 22 entered still uses line 22', () => {
    const l = buildLine13({ year: 2025, net: 0, figures, locked: new Set(), purchases: [], disposals: [] });
    expect(l.source).toBe('Form 4562 line 22');
  });
});

const line = (o: Partial<ReportPurchaseLine>): ReportPurchaseLine => ({
  id: 'l', purchase_date: '2026-03-01', vendor: 'Sweetwater', description: 'item', category: 'Supplies',
  quantity: 1, item_cost: 10, line_cost: 10, tax_treatment: 'expense', asset_id: null, parent_id: 'h1',
  parent: { purchase_date: '2026-03-01', vendor: 'Sweetwater' }, asset: null, ...o,
});
const gigRow = (o: Partial<ReportGigRow>): ReportGigRow => ({
  id: 'g', gig_id: 'gig1', direction: 'out', stage: 'paid', amount_settled: 100, paid_at: '2026-04-02',
  description: null, category: null, mileage: null, purchase_id: null, staff_assignment_id: null,
  external_entity_name: null, reference_number: null, counterparty: null,
  gig: { title: 'Spring Gala', start: '2026-04-01' }, ...o,
});
const scheduleC = [{ code: '13', label: 'Depreciation and section 179' }, { code: '22', label: 'Supplies' }];
const cats = [{ name: 'Supplies', schedule_c_line: '22' }];

describe('expenses categorized as Depreciation (Q5)', () => {
  const gig = [
    gigRow({ id: 'in', direction: 'in', amount_settled: 5000 }),
    gigRow({ id: 'd1', category: 'Depreciation', amount_settled: 300 }),
    gigRow({ id: 'd2', category: 'Depreciation', amount_settled: 150.5 }),
  ];
  const r = buildScheduleCSummary(buildIncomeReport(gig, 2026), buildExpenseReport([line({ line_cost: 40 })], gig, cats, scheduleC, 2026), gig, scheduleC);

  it('are listed apart, out of the lines, the total expenses and the net before depreciation', () => {
    expect(r.depreciationCategorized).toEqual({ count: 2, total: 450.5, gigOnly: true });
    expect(r.lines.map(l => l.line)).toEqual(['22']);
    expect(r.totalExpenses).toBe(40);
    expect(r.net).toBe(4960);
  });

  it('none: a zero count', () => {
    const s = buildScheduleCSummary(buildIncomeReport([], 2026), buildExpenseReport([line({})], [], cats, scheduleC, 2026), [], scheduleC);
    expect(s.depreciationCategorized).toEqual({ count: 0, total: 0, gigOnly: true });
  });
});

describe('the Schedule C CSV with line 13', () => {
  const gig = [gigRow({ id: 'in', direction: 'in', amount_settled: 10000 })];
  const r = buildScheduleCSummary(buildIncomeReport(gig, 2025), buildExpenseReport([], gig, cats, scheduleC, 2025), gig, scheduleC);

  it('adds a Source column, the line 13 row and its breakdown, and the net after depreciation', () => {
    const l = buildLine13({ year: 2025, net: r.net, figures, locked, purchases: [], disposals: [] });
    const rows = Papa.parse<string[]>(scheduleCCsv(r, l)).data;
    expect(rows[0]).toEqual(['Line', 'Description', 'Amount', 'Miles', 'Source']);
    expect(rows.slice(-4)).toEqual([
      ['13', 'Depreciation and section 179', '2082.00', '', 'Form 4562 line 22'],
      ['', '  Line 17: equipment from earlier years', '1653.00', '', 'Form 4562 line 22'],
      ['', '  Line 19(g): 2025 equipment, 7-year HY', '429.00', '', 'Form 4562 line 22'],
      ['', 'Net after depreciation', '7918.00', '', ''],
    ]);
  });

  it('a year not entered: the row with no amount, and no net after depreciation', () => {
    const l = buildLine13({ year: 2025, net: r.net, figures: [], locked, purchases: [], disposals: [] });
    const rows = Papa.parse<string[]>(scheduleCCsv(r, l)).data;
    expect(rows.at(-1)).toEqual(['13', 'Depreciation and section 179', '', '', 'Not entered']);
  });
});

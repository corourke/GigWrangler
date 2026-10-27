import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { buildIncomeReport, buildExpenseReport, type ReportPurchaseLine, type ReportGigRow } from './taxReports';
import {
  buildScheduleCSummary, buildNeedsAttentionReport, scheduleCCsv, needsAttentionCsv,
  type ReportAsset, type ReportInvoice,
} from './taxSummaryReports';

const line = (o: Partial<ReportPurchaseLine>): ReportPurchaseLine => ({
  id: 'l', purchase_date: '2026-03-01', vendor: 'Sweetwater', description: 'item', category: 'Supplies',
  quantity: 1, item_cost: 10, line_cost: 10, tax_treatment: 'expense', asset_id: null, parent_id: 'h1',
  parent: { purchase_date: '2026-03-01', vendor: 'Sweetwater' }, asset: null, ...o,
});
const gigRow = (o: Partial<ReportGigRow>): ReportGigRow => ({
  id: 'g', gig_id: 'gig1', direction: 'in', stage: 'paid', amount_settled: 100, paid_at: '2026-04-02',
  description: null, category: null, mileage: null, purchase_id: null, staff_assignment_id: null,
  external_entity_name: null, reference_number: null, counterparty: null,
  gig: { title: 'Spring Gala', start: '2026-04-01' }, ...o,
});
const trip = (o: Partial<ReportGigRow>) => gigRow({ direction: 'out', category: 'Car and truck expenses', ...o });
const scheduleC = [
  { code: '9', label: 'Car and truck expenses' }, { code: '11', label: 'Contract labor' },
  { code: '22', label: 'Supplies' }, { code: '27b', label: 'Other expenses (Part V)' },
];
const cats = [
  { name: 'Supplies', schedule_c_line: '22' },
  { name: 'Small audio parts', schedule_c_line: '27b' },
  { name: 'Reimbursable (not deducted)', schedule_c_line: null },
];

describe('Schedule C summary with cost of goods sold (#321)', () => {
  const sc = [{ code: '4', label: 'Cost of goods sold (Part III)' }, ...scheduleC];
  const withResale = [...cats, { name: 'Cost of goods sold (resale)', schedule_c_line: '4' }];
  const lines = [
    line({ id: 'p1', category: 'Supplies', line_cost: 40.5 }),
    line({ id: 'r1', category: 'Cost of goods sold (resale)', line_cost: 600 }),
  ];
  const gig = [gigRow({ id: 'i1', amount_settled: 1500, paid_at: '2026-04-02' })];
  const r = buildScheduleCSummary(buildIncomeReport(gig, 2026), buildExpenseReport(lines, gig, withResale, sc, 2026), gig, sc);

  it('takes cost of goods sold off gross receipts first, as Part I does', () => {
    expect(r.costOfGoodsSold).toBe(600);
    expect(r.grossProfit).toBe(900);
  });

  it('keeps line 4 out of the Part II lines and total expenses', () => {
    expect(r.lines.map(l => l.line)).toEqual(['22']);
    expect(r.totalExpenses).toBe(40.5);
    expect(r.net).toBe(859.5);
  });

  it('exports line 4 and gross profit after gross receipts', () => {
    const rows = Papa.parse<string[]>(scheduleCCsv(r)).data;
    expect(rows.slice(1, 4)).toEqual([
      ['', 'Gross receipts', '1500.00', ''],
      ['4', 'Cost of goods sold (Part III)', '600.00', ''],
      ['', 'Gross profit', '900.00', ''],
    ]);
    expect(rows.find(x => x[1] === 'Total expenses')).toEqual(['', 'Total expenses', '40.50', '']);
    expect(rows.find(x => x[1] === 'Net (before depreciation)')).toEqual(['', 'Net (before depreciation)', '859.50', '']);
  });
});

describe('Schedule C summary (#125)', () => {
  const lines = [
    line({ id: 'p1', category: 'Supplies', line_cost: 40.5 }),
    line({ id: 'p2', category: 'Small audio parts', line_cost: 15 }),
    line({ id: 'p3', category: 'Audio', line_cost: 20 }),                              // not on the list: no line
    line({ id: 'p4', category: 'Reimbursable (not deducted)', line_cost: 30 }),        // on the list, no line: not deducted
    line({ id: 'p5', tax_treatment: 'depreciate', line_cost: 900 }),                   // an asset, never an expense
  ];
  const gig = [
    gigRow({ id: 'i1', amount_settled: 1500, paid_at: '2026-04-02' }),
    gigRow({ id: 'i2', amount_settled: 250, paid_at: '2026-01-15' }),
    gigRow({ id: 'i3', amount_settled: 999, paid_at: '2025-12-31' }),                 // last year
    // Mileage either side of the 2026-07-01 rate change, priced by the trip's date (not the paid date).
    trip({ id: 'm1', mileage: 100, date: '2026-06-30', amount_settled: 72.5, paid_at: '2026-07-02' }),
    trip({ id: 'm2', mileage: 100, date: '2026-07-01', amount_settled: 76, paid_at: '2026-07-02' }),
    // A trip filed under another category stays on that line.
    trip({ id: 'm3', category: 'Other expenses', mileage: 10, date: '2026-08-01', amount_settled: 7.6, paid_at: '2026-08-02' }),
    // Linked to a purchase: the line already counts.
    trip({ id: 'x', mileage: 50, date: '2026-05-01', amount_settled: 36.25, purchase_id: 'p1' }),
    gigRow({ id: 's', direction: 'out', category: 'Contract labor', amount_settled: 300, paid_at: '2026-05-02' }),
  ];
  const income = buildIncomeReport(gig, 2026);
  const expenses = buildExpenseReport(lines, gig, cats, scheduleC, 2026);
  const r = buildScheduleCSummary(income, expenses, gig, scheduleC);

  it('takes gross receipts from the Income report', () => {
    expect(r.receipts).toBe(1750);
    expect(r.receipts).toBe(income.total);
  });

  it('rolls expenses up by Schedule C line, equal to the Expenses report', () => {
    expect(r.lines.map(l => [l.line, l.label, l.total])).toEqual([
      ['9', 'Car and truck expenses', 148.5],
      ['11', 'Contract labor', 300],
      ['22', 'Supplies', 40.5],
      ['27b', 'Other expenses (Part V)', 22.6],
    ]);
    for (const l of r.lines) expect(l.total).toBe(expenses.byLine.find(g => g.line === l.line)!.total);
    expect(r.noCategory).toBe(20);
    expect(r.notDeducted).toBe(30);
  });

  it('prices line 9 mileage at the rate on each trip\'s date, across the 2026-07-01 change', () => {
    // 100 mi × $0.725 + 100 mi × $0.76
    expect(r.mileage.line9).toEqual({ trips: 2, miles: 200, recorded: 148.5, atIrsRate: 148.5 });
    expect(r.lines.find(l => l.line === '9')!.miles).toBe(200);
    expect(r.lines.find(l => l.line === '22')!.miles).toBeNull();
  });

  it('counts mileage once: on its category\'s line, never added to line 9 again', () => {
    expect(r.lines.find(l => l.line === '9')!.total).toBe(148.5);                    // not 148.50 + 148.50
    expect(r.mileage.elsewhere).toEqual({ trips: 1, miles: 10, recorded: 7.6, lines: ['27b'] });
    const counted = r.lines.reduce((s, l) => s + l.total, 0) + r.noCategory + r.notDeducted;
    expect(Math.round(counted * 100) / 100).toBe(expenses.total);                    // every expense once
  });

  it('flags line 9 mileage recorded at an old rate, without changing the line total', () => {
    const stale = [trip({ id: 'm9', mileage: 100, date: '2026-07-01', amount_settled: 67.5, paid_at: '2026-07-02' })];
    const s = buildScheduleCSummary(buildIncomeReport(stale, 2026), buildExpenseReport([], stale, cats, scheduleC, 2026), stale, scheduleC);
    expect(s.mileage.line9).toEqual({ trips: 1, miles: 100, recorded: 67.5, atIrsRate: 76 });
    expect(s.lines).toEqual([{ line: '9', label: 'Car and truck expenses', total: 67.5, miles: 100 }]);
  });

  it('totals expenses (not counting the not-deducted ones) and the net before depreciation', () => {
    expect(r.totalExpenses).toBe(531.6);
    expect(r.net).toBe(1218.4);
  });

  it('exports line, description, amount and miles, with the receipts, total and net rows', () => {
    const rows = Papa.parse<string[]>(scheduleCCsv(r)).data;
    expect(rows).toEqual([
      ['Line', 'Description', 'Amount', 'Miles'],
      ['', 'Gross receipts', '1750.00', ''],
      ['4', 'Cost of goods sold (Part III)', '0.00', ''],
      ['', 'Gross profit', '1750.00', ''],
      ['9', 'Car and truck expenses', '148.50', '200'],
      ['11', 'Contract labor', '300.00', ''],
      ['22', 'Supplies', '40.50', ''],
      ['27b', 'Other expenses (Part V)', '22.60', ''],
      ['', 'No category (no Schedule C line)', '20.00', ''],
      ['', 'Total expenses', '531.60', ''],
      ['', 'Net (before depreciation)', '1218.40', ''],
      ['', 'Not deducted (category has no Schedule C line; not in total)', '30.00', ''],
    ]);
  });

  it('leaves out the no-category and not-deducted rows when they are zero (line 4 and gross profit always show)', () => {
    const s = buildScheduleCSummary(buildIncomeReport([], 2026), buildExpenseReport([line({ id: 'a' })], [], cats, scheduleC, 2026), [], scheduleC);
    const rows = Papa.parse<string[]>(scheduleCCsv(s)).data.map(x => x[1]);
    expect(rows).toEqual(['Description', 'Gross receipts', 'Cost of goods sold (Part III)', 'Gross profit', 'Supplies', 'Total expenses', 'Net (before depreciation)']);
    expect(s.net).toBe(-10);
  });
});

describe('Needs attention (#125)', () => {
  const asset = (o: Partial<ReportAsset>): ReportAsset => ({
    id: 'a', manufacturer_model: 'Thing', description: null, category: 'Audio', acquisition_date: '2026-03-01',
    item_cost: 100, status: 'Active', retired_on: null, recovery_period: 7, purchase_line_id: null, ...o,
  });
  const lines = [
    line({ id: 'n1', description: 'Strings', category: 'Audio', line_cost: 20 }),             // not on the list
    line({ id: 'n2', description: 'Gaff tape', category: '', line_cost: 10 }),               // blank
    line({ id: 'n3', description: 'Batteries', category: 'Supplies', line_cost: 20 }),
    line({ id: 'n4', parent_id: 'hx', description: 'Old cable', category: null, purchase_date: '2025-02-01', line_cost: 5 }),  // last year
    line({ id: 'd1', parent_id: 'hd', tax_treatment: 'depreciate', description: 'Console', line_cost: 3200, item_cost: 3200, asset_id: 'a1' }),
    line({ id: 'd2', parent_id: 'hd', tax_treatment: 'depreciate', description: 'Wedges', quantity: 2, item_cost: 800, line_cost: 1600, asset_id: 'a2' }),
    line({ id: 'd3', parent_id: 'hd', tax_treatment: 'depreciate', description: 'Hazer', line_cost: 450, item_cost: 450 }),  // not tracked
    line({ id: 'd4', parent_id: 'hd', tax_treatment: 'depreciate', purchase_date: '2025-06-01', asset_id: 'a4' }),           // last year
    line({ id: 'e1', parent_id: 'hd', description: 'DI box', asset_id: 'a12' }),                                             // expensed, tracked
    line({ id: 'k1', parent_id: 'h2', line_cost: 60 }), line({ id: 'k2', parent_id: 'h2', line_cost: 39.98 }),
    line({ id: 'k3', parent_id: 'h3', line_cost: 99.99 }),
  ];
  const assets = [
    asset({ id: 'a1', manufacturer_model: 'Midas M32', recovery_period: null, item_cost: 3200 }),
    asset({ id: 'a2', manufacturer_model: 'QSC K12 #1', recovery_period: null, item_cost: 800, purchase_line_id: 'd2' }),
    asset({ id: 'a3', manufacturer_model: 'QSC K12 #2', recovery_period: 7, item_cost: 800, purchase_line_id: 'd2' }),
    asset({ id: 'a4', recovery_period: null, acquisition_date: '2025-06-01' }),
    asset({ id: 'a12', manufacturer_model: 'Radial DI', recovery_period: null }),            // expensed: no period needed
    asset({ id: 'a5', manufacturer_model: 'Cable trunk', item_cost: 0, acquisition_date: '2026-05-01' }),
    asset({ id: 'a6', manufacturer_model: 'Gift mic', item_cost: null, acquisition_date: '2026-06-01' }),
    asset({ id: 'a7', item_cost: 0, acquisition_date: '2025-05-01' }),                      // last year
    asset({ id: 'a8', manufacturer_model: 'Sennheiser XSW IEM', status: 'Disposed', acquisition_date: '2023-04-01', item_cost: 600 }),
    asset({ id: 'a9', manufacturer_model: '8U rack', status: 'Returned', acquisition_date: '2025-01-28', item_cost: 228.81 }),
    asset({ id: 'a10', status: 'Disposed', retired_on: '2026-05-20' }),
    asset({ id: 'a11', status: 'Inactive' }),
  ];
  const invoices: ReportInvoice[] = [
    { id: 'h1', purchase_date: '2026-03-01', vendor: 'Sweetwater', description: null, total_inv_amount: 50 },     // 20 + 10 + 20
    { id: 'h2', purchase_date: '2026-04-01', vendor: 'Amazon', description: 'Cables', total_inv_amount: 100 },    // 99.98
    { id: 'h3', purchase_date: '2026-04-02', vendor: 'B&H', description: null, total_inv_amount: 100 },           // 99.99: within a cent
    { id: 'h4', purchase_date: '2025-04-02', vendor: 'B&H', description: null, total_inv_amount: 100 },           // last year
  ];
  const expenses = buildExpenseReport(lines, [], cats, scheduleC, 2026);
  const r = buildNeedsAttentionReport({ lines, assets, invoices, expenses }, 2026);
  const group = (key: string) => r.groups.find(g => g.key === key)!;

  it('lists expensed purchase lines in the year with no expense category, linked to their purchase', () => {
    expect(group('no-category').rows).toEqual([
      expect.objectContaining({ id: 'n1', item: 'Strings (Sweetwater)', date: '2026-03-01', amount: 20, purchaseId: 'h1', problem: '“Audio” isn’t on your expense list' }),
      expect.objectContaining({ id: 'n2', item: 'Gaff tape (Sweetwater)', amount: 10, purchaseId: 'h1', problem: 'No category' }),
    ]);
  });

  it('lists depreciated equipment bought in the year with no recovery period, unit by unit', () => {
    expect(group('no-recovery-period').rows.map(x => [x.id, x.assetId ?? null, x.purchaseId ?? null])).toEqual([
      ['a1', 'a1', null], ['a2', 'a2', null], ['d3', null, 'hd'],
    ]);
    expect(group('no-recovery-period').rows[2].problem).toMatch(/not tracked as equipment/);
  });

  it('lists equipment bought in the year with no cost', () => {
    expect(group('no-cost').rows.map(x => [x.id, x.amount, x.assetId])).toEqual([['a5', 0, 'a5'], ['a6', null, 'a6']]);
  });

  it('lists disposed or returned equipment with no date disposed, from any year', () => {
    expect(group('no-disposal-date').rows.map(x => [x.id, x.problem])).toEqual([
      ['a8', 'Disposed, with no date disposed'], ['a9', 'Returned, with no date disposed'],
    ]);
  });

  it('lists invoices in the year whose lines don\'t add up to the total, to the cent', () => {
    expect(group('invoice-mismatch').rows).toEqual([
      expect.objectContaining({ id: 'h2', item: 'Amazon: Cables', date: '2026-04-01', amount: 100, purchaseId: 'h2',
        problem: 'Lines total $99.98; the invoice total is $100.00 (off by $0.02)' }),
    ]);
  });

  it('counts every group', () => {
    expect(r.groups.map(g => [g.key, g.rows.length])).toEqual([
      ['no-category', 2], ['no-recovery-period', 3], ['no-cost', 2], ['no-disposal-date', 2], ['invoice-mismatch', 1],
    ]);
    expect(r.total).toBe(10);
  });

  it('is empty when nothing needs attention', () => {
    const clean = [line({ id: 'ok', parent_id: 'h9', line_cost: 10 })];
    const e = buildNeedsAttentionReport({
      lines: clean, assets: [asset({ id: 'a' })],
      invoices: [{ id: 'h9', purchase_date: '2026-03-01', vendor: 'X', description: null, total_inv_amount: 10 }],
      expenses: buildExpenseReport(clean, [], cats, scheduleC, 2026),
    }, 2026);
    expect(e.total).toBe(0);
    expect(e.groups.every(g => g.rows.length === 0)).toBe(true);
  });

  it('exports group, item, date, amount and problem', () => {
    const rows = Papa.parse<string[]>(needsAttentionCsv(r)).data;
    expect(rows[0]).toEqual(['Group', 'Item', 'Date', 'Amount', 'Problem']);
    expect(rows).toHaveLength(11);
    expect(rows).toContainEqual(['Equipment with no cost', 'Gift mic', '2026-06-01', '', 'No cost']);
    expect(rows).toContainEqual(['Invoices that don’t add up', 'Amazon: Cables', '2026-04-01', '100.00', 'Lines total $99.98; the invoice total is $100.00 (off by $0.02)']);
  });
});

// #185: a lot's split-off Missing piece shares its lot's purchase line and values, so it isn't
// flagged a second time for the lot's problem.
describe('Needs attention: written-off pieces (#185)', () => {
  const rec = (o: Partial<ReportAsset>): ReportAsset => ({
    id: 'r', manufacturer_model: 'Speaker Stand', description: null, category: 'Audio', acquisition_date: '2026-03-01',
    item_cost: 50, status: 'Active', retired_on: null, recovery_period: null, purchase_line_id: 'stands',
    quantity: 1, serial_number: null, tag_number: null, equipment_item_id: 'item-stand', ...o,
  });
  const lines = [line({ id: 'stands', parent_id: 'h', tax_treatment: 'depreciate', description: 'Speaker stands', quantity: 6, item_cost: 50, line_cost: 300, asset_id: 'lot' })];
  const assets = [
    rec({ id: 'lot', quantity: 5 }),
    rec({ id: 'm1', quantity: 1, status: 'Missing', retired_on: '2026-10-09', written_off_from: 'lot' }),
    // Looks like a split-off piece, but the record doesn't say it came from a lot: it's flagged.
    rec({ id: 'm2', quantity: 1, status: 'Missing', retired_on: '2026-10-09' }),
    rec({ id: 'free-lot', purchase_line_id: null, equipment_item_id: 'item-box', item_cost: 0, quantity: 4, manufacturer_model: 'Cable box' }),
    rec({ id: 'free-m', purchase_line_id: null, equipment_item_id: 'item-box', item_cost: 0, quantity: 1, manufacturer_model: 'Cable box', status: 'Missing', retired_on: '2026-10-09', written_off_from: 'free-lot' }),
    rec({ id: 'gone-unit', tag_number: 'T-1', purchase_line_id: null, equipment_item_id: 'item-mic', item_cost: 0, status: 'Missing', retired_on: '2026-10-09' }),
  ];
  const r = buildNeedsAttentionReport({ lines, assets, invoices: [], expenses: { rows: [] } as any }, 2026);
  const ids = (k: string) => r.groups.find(g => g.key === k)?.rows.map(x => x.id) ?? [];

  it('flags the lot, not its split-off piece too', () => {
    expect(ids('no-recovery-period')).toEqual(['lot', 'm2']);
    expect(ids('no-cost')).toEqual(['free-lot', 'gone-unit']);
  });
});


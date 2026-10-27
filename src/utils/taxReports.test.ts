import type { ReportAsset } from './taxSummaryReports';
import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import {
  buildIncomeReport, buildExpenseReport, buildAssetReport, buildGreyZoneReport,
  incomeCsv, expensesCsv, assetsCsv, disposalsCsv, greyZoneCsv, reportFilename,
  type ReportPurchaseLine, type ReportGigRow,
} from './taxReports';

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
const scheduleC = [
  { code: '9', label: 'Car and truck expenses' }, { code: '11', label: 'Contract labor' },
  { code: '22', label: 'Supplies' }, { code: '27b', label: 'Other expenses (Part V)' },
];
const cats = [
  { name: 'Supplies', schedule_c_line: '22' },
  { name: 'Small audio parts', schedule_c_line: '27b' },
  { name: 'Reimbursable (not deducted)', schedule_c_line: null },
];

describe('Income report (#125)', () => {
  it('counts what was received in the year, by paid date, at the settled amount', () => {
    const r = buildIncomeReport([
      gigRow({ id: 'a', amount_settled: 1500, paid_at: '2026-04-02', counterparty: { name: 'Hotel Del' }, reference_number: 'INV-7' }),
      gigRow({ id: 'b', amount_settled: 250, paid_at: '2026-01-15' }),
      gigRow({ id: 'c', paid_at: '2025-12-31' }),              // last year
      gigRow({ id: 'd', stage: 'invoiced', paid_at: null }),    // not received
      gigRow({ id: 'e', direction: 'out' }),                    // money out
    ], 2026);
    expect(r.rows.map(x => x.id)).toEqual(['b', 'a']);
    expect(r.rows[1]).toMatchObject({ date: '2026-04-02', gig: 'Spring Gala', gigDate: '2026-04-01', from: 'Hotel Del', reference: 'INV-7', amount: 1500 });
    expect(r.total).toBe(1750);
  });
});

describe('Expenses report (#125)', () => {
  const lines = [
    line({ id: 'p1', category: 'Supplies', line_cost: 40.5 }),
    line({ id: 'p2', category: 'Small audio parts', purchase_date: null, parent: { purchase_date: '2026-06-01', vendor: 'Amazon' }, vendor: null, line_cost: null, item_cost: 5, quantity: 3 }),
    line({ id: 'p3', category: 'Audio', line_cost: 20 }),                                   // old value, not on the list
    line({ id: 'p4', category: 'Reimbursable (not deducted)', line_cost: 30 }),
    line({ id: 'p5', tax_treatment: 'depreciate', line_cost: 900 }),                        // an asset, not an expense
    line({ id: 'p6', purchase_date: '2025-12-30', line_cost: 99 }),                         // last year
  ];
  const gig = [
    gigRow({ id: 'm', direction: 'out', category: 'Car and truck expenses', mileage: 42, amount_settled: 30.45, paid_at: '2026-05-01' }),
    gigRow({ id: 's', direction: 'out', category: 'Contract labor', staff_assignment_id: 'sa', amount_settled: 300, paid_at: '2026-05-02', external_entity_name: 'Pat' }),
    gigRow({ id: 'x', direction: 'out', category: 'Other expenses', purchase_id: 'p1', amount_settled: 40.5 }),  // the line counts
    gigRow({ id: 'o', direction: 'out', stage: 'invoiced', category: 'Supplies', paid_at: null }),              // not paid
  ];
  const r = buildExpenseReport(lines, gig, cats, scheduleC, 2026);

  it('takes expensed lines by line date (else the invoice\'s) and paid gig costs not tied to a purchase', () => {
    expect(r.rows.map(x => x.id).sort()).toEqual(['m', 'p1', 'p2', 'p3', 'p4', 's']);
    expect(r.rows.find(x => x.id === 'p2')).toMatchObject({ date: '2026-06-01', payee: 'Amazon', amount: 15, line: '27b', source: 'Purchase' });
    expect(r.rows.find(x => x.id === 'm')).toMatchObject({ source: 'Gig', line: '9', miles: 42, gig: 'Spring Gala', amount: 30.45 });
    expect(r.rows.find(x => x.id === 's')).toMatchObject({ payee: 'Pat', line: '11' });
    expect(r.total).toBe(435.95);
  });

  it('groups by Schedule C line in line order, with unfiled categories last', () => {
    expect(r.byLine.map(g => g.line)).toEqual(['9', '11', '22', '27b', null]);
    expect(r.byLine[2]).toMatchObject({ label: 'Line 22: Supplies', total: 40.5 });
    const none = r.byLine[4];
    expect(none.label).toBe('No Schedule C line');
    expect(none.categories.map(c => c.category)).toEqual(['Audio', 'Reimbursable (not deducted)']);
  });

  it('flags a category that isn\'t on the list', () => {
    expect(r.needsCategory).toBe(1);
    expect(r.rows.find(x => x.id === 'p3')!.unlisted).toBe(true);
    expect(r.rows.find(x => x.id === 'p4')!.unlisted).toBe(false);
  });

  it('exports every row with its Schedule C line', () => {
    const rows = Papa.parse<string[]>(expensesCsv(r, scheduleC)).data;
    expect(rows[0]).toEqual(['Date paid', 'Source', 'Payee', 'Description', 'Category', 'Schedule C line', 'Line name', 'Gig', 'Miles', 'Amount']);
    expect(rows).toHaveLength(7);
    expect(rows.find(x => x[4] === 'Supplies')).toEqual(['2026-03-01', 'Purchase', 'Sweetwater', 'item', 'Supplies', '22', 'Supplies', '', '', '40.50']);
  });
});

describe('Cost of goods sold, Schedule C line 4 (#321)', () => {
  const sc = [{ code: '4', label: 'Cost of goods sold (Part III)' }, ...scheduleC];
  const withResale = [...cats, { name: 'Cost of goods sold (resale)', schedule_c_line: '4' }];
  const lines = [
    line({ id: 'p1', category: 'Supplies', line_cost: 40.5 }),
    line({ id: 'r1', category: 'Cost of goods sold (resale)', line_cost: 2000 }),
    line({ id: 'r2', category: ' Cost of goods sold (resale) ', line_cost: 500 }),
    line({ id: 'r3', category: 'Cost of goods sold (resale)', tax_treatment: 'depreciate', line_cost: 900 }),  // an asset, not sold stock
  ];
  const r = buildExpenseReport(lines, [], withResale, sc, 2026);

  it('keeps line 4 out of the Part II lines and their total', () => {
    expect(r.byLine.map(g => g.line)).toEqual(['22']);
    expect(r.total).toBe(40.5);
  });

  it('totals it as cost of goods sold, by category', () => {
    expect(r.costOfGoodsSold).toEqual({
      total: 2500,
      categories: [{ category: 'Cost of goods sold (resale)', total: 2500, count: 2 }],
    });
  });

  it('still lists its rows, on line 4, and exports them', () => {
    expect(r.rows.filter(x => x.line === '4').map(x => x.id).sort()).toEqual(['r1', 'r2']);
    const rows = Papa.parse<string[]>(expensesCsv(r, sc)).data;
    expect(rows.filter(x => x[5] === '4').map(x => x[6])).toEqual(['Cost of goods sold (Part III)', 'Cost of goods sold (Part III)']);
  });

  it('is empty when nothing is on line 4', () => {
    const none = buildExpenseReport([line({ id: 'p1', line_cost: 10 })], [], withResale, sc, 2026);
    expect(none.costOfGoodsSold).toEqual({ total: 0, categories: [] });
    expect(none.total).toBe(10);
  });
});

describe('Assets report (#125)', () => {
  const asset = (o: Partial<NonNullable<ReportPurchaseLine['asset']>>) => ({
    id: 'a', manufacturer_model: 'Chauvet Intimidator Trio', category: 'Lighting', recovery_period: 7,
    retired_on: null, liquidation_amt: null, status: 'Active', ...o,
  });
  const lines = [
    line({ id: 'd1', tax_treatment: 'depreciate', item_cost: 3200, line_cost: 3200, asset_id: 'a1', asset: asset({ id: 'a1', manufacturer_model: 'Midas M32' , category: 'Audio' }) }),
    line({ id: 'd2', tax_treatment: 'depreciate', item_cost: 420, line_cost: 840, quantity: 2, asset_id: 'a2', asset: asset({ id: 'a2', recovery_period: null }) }),
    line({ id: 'd3', tax_treatment: 'depreciate', purchase_date: '2025-02-01', line_cost: 600, item_cost: 600, asset_id: 'a3',
      asset: asset({ id: 'a3', manufacturer_model: 'Sennheiser XSW IEM', retired_on: '2026-05-20', liquidation_amt: 350, status: 'Disposed' }) }),
    line({ id: 'e1', tax_treatment: 'expense', asset_id: 'a4', asset: asset({ id: 'a4' }) }),
  ];
  const r = buildAssetReport(lines, 2026);

  it('lists what was depreciated in the year, with cost, recovery period and the de minimis flag', () => {
    expect(r.rows.map(x => x.id)).toEqual(['d2', 'd1']);
    expect(r.rows.find(x => x.id === 'd1')).toMatchObject({ description: 'Midas M32', category: 'Audio', cost: 3200, recoveryPeriod: 7, deMinimis: false });
    expect(r.rows.find(x => x.id === 'd2')).toMatchObject({ quantity: 2, itemCost: 420, cost: 840, recoveryPeriod: null, deMinimis: true });
    expect(r.total).toBe(4040);
  });

  it('totals by recovery period, with the unchosen ones last, and counts what needs attention', () => {
    expect(r.byPeriod).toEqual([{ period: 7, count: 1, total: 3200 }, { period: null, count: 1, total: 840 }]);
    expect(r.missingPeriod).toBe(1);
    expect(r.deMinimis).toBe(1);
  });

  it('lists depreciated equipment disposed of in the year, whenever it was bought', () => {
    expect(r.disposals).toEqual([{ id: 'd3', assetId: 'a3', description: 'Sennheiser XSW IEM', bought: '2025-02-01', cost: 600, disposed: '2026-05-20', proceeds: 350, status: 'Disposed' }]);
    expect(buildAssetReport(lines, 2025).disposals).toEqual([]);
  });

  it('exports assets and disposals', () => {
    const a = Papa.parse<string[]>(assetsCsv(r)).data;
    expect(a[0]).toContain('Recovery period (years)');
    expect(a[2]).toEqual(['2026-03-01', 'Midas M32', 'Sweetwater', 'Audio', '1', '3200.00', '3200.00', '7', 'No']);
    const d = Papa.parse<string[]>(disposalsCsv(r)).data;
    expect(d[1]).toEqual(['Sennheiser XSW IEM', '2025-02-01', '600.00', '2026-05-20', '350.00', 'Disposed']);
  });
});

describe('Grey zone report (#125)', () => {
  const tracked = { id: 'a5', manufacturer_model: 'Shure ULXD4', category: 'Audio', recovery_period: null, retired_on: null, liquidation_amt: null, status: 'Active' };
  const equipment = ['Audio', 'Lighting', 'Cases/Bags'];
  const lines = [
    line({ id: 'low', category: 'Audio', item_cost: 199.99, line_cost: 199.99 }),                        // under $200: expensed outright
    line({ id: 'at200', category: 'Audio', item_cost: 200, line_cost: 200, description: 'DI box' }),      // $200 counts
    line({ id: 'at2500', category: 'Lighting', item_cost: 2500, line_cost: 5000, quantity: 2, tax_treatment: 'depreciate', description: 'Mover' }),
    line({ id: 'high', category: 'Lighting', item_cost: 2500.01, line_cost: 2500.01, tax_treatment: 'depreciate' }), // over $2,500
    line({ id: 'notequip', category: 'Software subscriptions', item_cost: 600, line_cost: 600 }),        // an expense category
    line({ id: 'tracked', category: 'Small audio parts', item_cost: 900, line_cost: 900, asset_id: 'a5', asset: tracked, description: 'Receiver' }),
    line({ id: 'oldcat', category: 'Cases', item_cost: 350, line_cost: 350, description: 'Rack case' }), // old name of Cases/Bags
    line({ id: 'lastyear', category: 'Audio', item_cost: 800, line_cost: 800, purchase_date: '2025-11-01' }),
  ];
  const r = buildGreyZoneReport(lines, equipment, 2026);

  it('lists the year\'s equipment lines costing $200 to $2,500 each, both ends included', () => {
    expect(r.rows.map(x => x.id).sort()).toEqual(['at200', 'at2500', 'oldcat', 'tracked']);
    expect(buildGreyZoneReport(lines, equipment, 2025).rows.map(x => x.id)).toEqual(['lastyear']);
  });

  it('counts a line as equipment by its category, or because it is tracked as equipment', () => {
    expect(r.rows.find(x => x.id === 'tracked')).toMatchObject({ description: 'Shure ULXD4', category: 'Audio', tracked: true });
    expect(r.rows.find(x => x.id === 'oldcat')).toMatchObject({ category: 'Cases', tracked: false });
  });

  it('shows the treatment chosen, the cost each, and the purchase to edit', () => {
    expect(r.rows.find(x => x.id === 'at200')).toMatchObject({ treatment: 'expense', itemCost: 200, cost: 200, purchaseId: 'h1' });
    expect(r.rows.find(x => x.id === 'at2500')).toMatchObject({ treatment: 'depreciate', quantity: 2, itemCost: 2500, cost: 5000 });
    expect(r).toMatchObject({ expensed: 3, depreciated: 1, total: 6450 });
  });

  it('exports every row with its treatment', () => {
    const rows = Papa.parse<string[]>(greyZoneCsv(r)).data;
    expect(rows[0]).toEqual(['Date bought', 'Description', 'Vendor', 'Category', 'Quantity', 'Cost per item', 'Cost', 'Treatment', 'Tracked as equipment']);
    expect(rows).toHaveLength(5);
    expect(rows.find(x => x[1] === 'Mover')).toEqual(['2026-03-01', 'Mover', 'Sweetwater', 'Lighting', '2', '2500.00', '5000.00', 'Depreciate', 'No']);
  });
});

describe('CSV helpers', () => {
  it('income CSV has one row per payment', () => {
    const csv = incomeCsv(buildIncomeReport([gigRow({ amount_settled: 1500 })], 2026));
    expect(Papa.parse<string[]>(csv).data[1]).toEqual(['2026-04-02', 'Spring Gala', '2026-04-01', '', '', '', '1500.00']);
  });
  it('names the file after the organization, report and year', () => {
    expect(reportFilename('Act4 Audio, LLC', 'expenses', 2026)).toBe('act4-audio-llc-expenses-2026.csv');
  });
});

// #185: a write-off is a disposal with no proceeds, piece by piece (Cameron, 10-09). Disposals come
// from each record on a depreciated line, at the line's cost per piece × the record's quantity.
describe('Disposals by record (#185)', () => {
  const lineAsset = (id: string) => ({ id, manufacturer_model: 'x', category: 'Audio', recovery_period: 7, retired_on: null, liquidation_amt: null, status: 'Active' });
  const lines = [
    line({ id: 'cables', tax_treatment: 'depreciate', description: 'XLR Cable, 50 ft', quantity: 10, item_cost: 20, line_cost: 200, asset_id: 'lot', asset: lineAsset('lot') }),
    line({ id: 'k12s', tax_treatment: 'depreciate', description: 'QSC K12.2', quantity: 3, item_cost: 900, line_cost: 2700, asset_id: 'u1', asset: lineAsset('u1') }),
  ];
  const rec = (o: Partial<ReportAsset>): ReportAsset => ({
    id: 'r', manufacturer_model: 'x', description: null, category: 'Audio', acquisition_date: '2026-03-01', item_cost: 20,
    status: 'Active', retired_on: null, recovery_period: 7, purchase_line_id: null, quantity: 1, liquidation_amt: null, ...o,
  });
  const assets = [
    rec({ id: 'lot', manufacturer_model: 'XLR Cable, 50 ft', quantity: 9, purchase_line_id: 'cables' }),
    rec({ id: 'm1', manufacturer_model: 'XLR Cable, 50 ft', quantity: 1, purchase_line_id: 'cables', status: 'Missing', retired_on: '2026-10-09' }),
    rec({ id: 'u1', manufacturer_model: 'QSC K12.2', item_cost: 900, purchase_line_id: 'k12s' }),
    rec({ id: 'u2', manufacturer_model: 'QSC K12.2', item_cost: 900, purchase_line_id: 'k12s' }),
    rec({ id: 'u3', manufacturer_model: 'QSC K12.2', item_cost: 900, purchase_line_id: 'k12s', status: 'Missing', retired_on: '2026-10-09' }),
  ];

  it('lists each written-off record at its own cost, not the whole line', () => {
    expect(buildAssetReport(lines, 2026, assets).disposals).toEqual([
      { id: 'u3', assetId: 'u3', description: 'QSC K12.2', bought: '2026-03-01', cost: 900, disposed: '2026-10-09', proceeds: null, status: 'Missing' },
      { id: 'm1', assetId: 'm1', description: 'XLR Cable, 50 ft', bought: '2026-03-01', cost: 20, disposed: '2026-10-09', proceeds: null, status: 'Missing' },
    ]);
  });

  it('the split-off piece doesn\'t change what was depreciated', () => {
    const r = buildAssetReport(lines, 2026, assets);
    expect(r.rows.map(x => [x.id, x.quantity, x.cost])).toEqual([['cables', 10, 200], ['k12s', 3, 2700]]);
    expect(r.total).toBe(2900);
  });

  it('pieces of a line add up to the line\'s cost, however it divides', () => {
    const tri = [line({ id: 'tri', tax_treatment: 'depreciate', description: 'DI Box', quantity: 3, item_cost: 33.33, line_cost: 100, asset_id: 't1', asset: lineAsset('t1') })];
    const gone = ['t1', 't2', 't3'].map((id) => rec({ id, manufacturer_model: 'DI Box', item_cost: 33.33, purchase_line_id: 'tri', status: 'Missing', retired_on: '2026-10-09' }));
    const costs = buildAssetReport(tri, 2026, gone).disposals.map(d => d.cost);
    expect(costs.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
  });

  it('a line with no records falls back to its linked equipment', () => {
    const old = [line({ id: 'd3', tax_treatment: 'depreciate', purchase_date: '2025-02-01', line_cost: 600, item_cost: 600, asset_id: 'a3',
      asset: { ...lineAsset('a3'), manufacturer_model: 'Sennheiser XSW IEM', retired_on: '2026-05-20', liquidation_amt: 350, status: 'Disposed' } })];
    expect(buildAssetReport(old, 2026, []).disposals).toEqual([
      { id: 'd3', assetId: 'a3', description: 'Sennheiser XSW IEM', bought: '2025-02-01', cost: 600, disposed: '2026-05-20', proceeds: 350, status: 'Disposed' },
    ]);
  });
});


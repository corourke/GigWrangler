/**
 * Tax-year reports under Financials → Reporting (#125): Income, Expenses,
 * Assets and Grey zone, cash basis (the Schedule C summary and Needs attention
 * are built from these, in utils/taxSummaryReports). GigWrangler supplies the data a tax program asks for; it
 * doesn't calculate tax. The counting rules are in docs/technical/financials.md §5:
 *
 *   INCOME      = amount_settled of paid money-in gig rows, by paid date
 *   EXPENSES    = purchase lines with tax_treatment = expense, by line date
 *               + paid money-out gig rows with no purchase_id, by paid date
 *   ASSETS      = purchase lines with tax_treatment = depreciate, by line date
 *   DISPOSALS   = depreciated equipment retired in the year, record by record (#185)
 *   GREY ZONE   = equipment lines costing $200 to $2,500 each, by line date,
 *                 whichever treatment was chosen
 *
 * A gig row with a purchase_id is skipped: its purchase line already counts.
 */
import Papa from 'papaparse';
import { TAX_DEPRECIATE_ABOVE, lineTaxTreatment, suggestedTaxTreatment, taxTreatmentLabel, type TaxTreatment } from './taxTreatment';
import { tidyAssetCategory } from './purchaseCategories';
import { asRecoveryPeriod, type RecoveryPeriod } from './recoveryPeriod';
import type { ReportAsset } from './taxSummaryReports';

// ---- Inputs, as loaded by services/taxReport.service ---------------------------

export interface ReportPurchaseLine {
  id: string;
  purchase_date: string | null;
  vendor: string | null;
  description: string | null;
  category: string | null;
  quantity: number | null;
  item_cost: number | null;
  line_cost: number | null;
  tax_treatment: string | null;
  asset_id: string | null;
  /** The invoice the line belongs to: where its treatment is edited. */
  parent_id: string | null;
  parent: { purchase_date: string | null; vendor: string | null } | null;
  asset: {
    id: string;
    manufacturer_model: string | null;
    category: string | null;
    recovery_period: number | null;
    retired_on: string | null;
    liquidation_amt: number | null;
    status: string | null;
  } | null;
}

export interface ReportGigRow {
  id: string;
  gig_id: string;
  direction: 'in' | 'out';
  stage: string;
  amount_settled: number | null;
  paid_at: string | null;
  /** The row's own date: for mileage, the trip's date, which sets its IRS rate. */
  date?: string | null;
  description: string | null;
  category: string | null;
  mileage: number | null;
  purchase_id: string | null;
  staff_assignment_id: string | null;
  external_entity_name: string | null;
  reference_number: string | null;
  counterparty: { name: string | null } | null;
  gig: { title: string | null; start: string | null } | null;
}

export interface ReportExpenseCategory {
  name: string;
  schedule_c_line: string | null;
}

export interface ScheduleCLineLabel {
  code: string;
  label: string;
}

// ---- Shared ------------------------------------------------------------------

export const money = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100 || 0;

/** YYYY-MM-DD of a date or timestamp, in the viewer's time zone for timestamps. */
export function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const inYear = (day: string | null, year: number) => !!day && day.startsWith(`${year}-`);

/** A line's own date, else its invoice's. */
const lineDay = (l: ReportPurchaseLine) => dayOf(l.purchase_date ?? l.parent?.purchase_date ?? null);
/** A line's cost with its share of tax and shipping. */
const lineCost = (l: ReportPurchaseLine) =>
  money(l.line_cost != null ? Number(l.line_cost) : Number(l.item_cost ?? 0) * Number(l.quantity ?? 1));

/** Schedule C line 4: cost of goods sold, worked out in Part III and kept apart from the Part II expenses (#321). */
export const COGS_LINE = '4';

/** Gig money-out categories (the IRS list, `fin_category`) → Schedule C line. */
export const FIN_CATEGORY_LINE: Record<string, string> = {
  'Advertising': '8',
  'Car and truck expenses': '9',
  'Commissions and fees': '10',
  'Contract labor': '11',
  'Depreciation': '13',
  'Insurance': '15',
  'Legal and professional services': '17',
  'Office expense': '18',
  'Rent or lease': '20a',
  'Repairs and maintenance': '21',
  'Supplies': '22',
  'Taxes and licenses': '23',
  'Travel': '24a',
  'Meals': '24b',
  'Utilities': '25',
  'Wages': '26',
  'Other expenses': '27b',
  'Production': '27b',
};

// ---- Income --------------------------------------------------------------------

export interface IncomeRow {
  id: string;
  date: string;
  gig: string;
  gigDate: string;
  from: string;
  description: string;
  reference: string;
  amount: number;
}

export interface IncomeReport {
  rows: IncomeRow[];
  total: number;
}

export function buildIncomeReport(gigRows: ReportGigRow[], year: number): IncomeReport {
  const rows = gigRows
    .filter(r => r.direction === 'in' && r.stage === 'paid' && inYear(dayOf(r.paid_at), year))
    .map(r => ({
      id: r.id,
      date: dayOf(r.paid_at)!,
      gig: r.gig?.title ?? '',
      gigDate: dayOf(r.gig?.start) ?? '',
      from: r.counterparty?.name ?? r.external_entity_name ?? '',
      description: r.description ?? '',
      reference: r.reference_number ?? '',
      amount: money(Number(r.amount_settled ?? 0)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.gig.localeCompare(b.gig));
  return { rows, total: money(rows.reduce((s, r) => s + r.amount, 0)) };
}

// ---- Expenses ------------------------------------------------------------------

export type ExpenseSource = 'Purchase' | 'Gig';

export interface ExpenseRow {
  id: string;
  date: string;
  source: ExpenseSource;
  payee: string;
  description: string;
  category: string;
  /** Schedule C line code; null when the category has none or isn't on the list. */
  line: string | null;
  /** The category isn't on the organization's expense list (an old value): it needs a category. */
  unlisted: boolean;
  miles: number | null;
  gig: string;
  amount: number;
}

export interface ExpenseLineGroup {
  line: string | null;
  label: string;
  total: number;
  categories: { category: string; total: number; count: number }[];
}

export interface ExpenseReport {
  rows: ExpenseRow[];
  /** By Part II Schedule C line, in line order; rows with no line come last. Line 4 is apart. */
  byLine: ExpenseLineGroup[];
  /** The Part II expenses: every row except those on line 4. */
  total: number;
  /** Rows on line 4 (cost of goods sold, Part III), not in byLine or total. */
  costOfGoodsSold: { total: number; categories: { category: string; total: number; count: number }[] };
  /** Rows whose category is blank or not on the list. */
  needsCategory: number;
}

export function buildExpenseReport(
  lines: ReportPurchaseLine[],
  gigRows: ReportGigRow[],
  categories: ReportExpenseCategory[],
  scheduleC: ScheduleCLineLabel[],
  year: number,
): ExpenseReport {
  const catLine = new Map(categories.map(c => [c.name.trim().toLowerCase(), c.schedule_c_line] as const));
  const rows: ExpenseRow[] = [];

  for (const l of lines) {
    if (l.tax_treatment === 'depreciate') continue;
    const day = lineDay(l);
    if (!inYear(day, year)) continue;
    const category = (l.category ?? '').trim();
    const known = catLine.has(category.toLowerCase());
    rows.push({
      id: l.id,
      date: day!,
      source: 'Purchase',
      payee: l.vendor ?? l.parent?.vendor ?? '',
      description: l.description ?? '',
      category,
      line: known ? catLine.get(category.toLowerCase()) ?? null : null,
      unlisted: !known,
      miles: null,
      gig: '',
      amount: lineCost(l),
    });
  }

  for (const r of gigRows) {
    if (r.direction !== 'out' || r.stage !== 'paid' || r.purchase_id) continue;
    const day = dayOf(r.paid_at);
    if (!inYear(day, year)) continue;
    const category = r.category ?? '';
    rows.push({
      id: r.id,
      date: day!,
      source: 'Gig',
      payee: r.counterparty?.name ?? r.external_entity_name ?? '',
      description: r.description ?? '',
      category,
      line: FIN_CATEGORY_LINE[category] ?? null,
      unlisted: !category,
      miles: r.mileage != null ? Number(r.mileage) : null,
      gig: r.gig?.title ?? '',
      amount: money(Number(r.amount_settled ?? 0)),
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.payee.localeCompare(b.payee));

  const order = new Map(scheduleC.map((s, i) => [s.code, i] as const));
  const labels = new Map(scheduleC.map(s => [s.code, s.label] as const));
  const groups = new Map<string, ExpenseLineGroup>();
  const cogs: ExpenseReport['costOfGoodsSold'] = { total: 0, categories: [] };
  for (const r of rows) {
    if (r.line === COGS_LINE) {
      cogs.total = money(cogs.total + r.amount);
      const c = cogs.categories.find(x => x.category === r.category);
      if (c) { c.total = money(c.total + r.amount); c.count += 1; }
      else cogs.categories.push({ category: r.category, total: r.amount, count: 1 });
      continue;
    }
    const key = r.line ?? '';
    let g = groups.get(key);
    if (!g) {
      g = {
        line: r.line,
        label: r.line ? `Line ${r.line}: ${labels.get(r.line) ?? ''}`.replace(/: $/, '') : 'No Schedule C line',
        total: 0,
        categories: [],
      };
      groups.set(key, g);
    }
    g.total = money(g.total + r.amount);
    const name = r.category || '(no category)';
    const c = g.categories.find(x => x.category === name);
    if (c) { c.total = money(c.total + r.amount); c.count += 1; }
    else g.categories.push({ category: name, total: r.amount, count: 1 });
  }
  const byLine = [...groups.values()]
    .map(g => ({ ...g, categories: g.categories.sort((a, b) => a.category.localeCompare(b.category)) }))
    .sort((a, b) => (a.line === null ? 1 : 0) - (b.line === null ? 1 : 0)
      || (order.get(a.line ?? '') ?? 999) - (order.get(b.line ?? '') ?? 999));

  return {
    rows,
    byLine,
    total: money(rows.filter(r => r.line !== COGS_LINE).reduce((s, r) => s + r.amount, 0)),
    costOfGoodsSold: { ...cogs, categories: cogs.categories.sort((a, b) => a.category.localeCompare(b.category)) },
    needsCategory: rows.filter(r => r.unlisted).length,
  };
}

// ---- Assets ----------------------------------------------------------------------

export interface AssetRow {
  id: string;
  assetId: string | null;
  date: string;
  description: string;
  vendor: string;
  category: string;
  quantity: number;
  itemCost: number;
  cost: number;
  recoveryPeriod: RecoveryPeriod | null;
  /** Per-item cost of $2,500 or less: the de minimis safe harbor could expense it. */
  deMinimis: boolean;
}

export interface DisposalRow {
  id: string;
  assetId: string;
  description: string;
  bought: string;
  cost: number;
  disposed: string;
  proceeds: number | null;
  status: string;
}

export interface AssetReport {
  rows: AssetRow[];
  total: number;
  /** Totals by recovery period; `null` = not yet chosen. */
  byPeriod: { period: RecoveryPeriod | null; count: number; total: number }[];
  missingPeriod: number;
  deMinimis: number;
  disposals: DisposalRow[];
}

/**
 * `assets`: the records, so a disposal is each record retired in the year at the line's cost
 * per piece × its quantity (#185: part of a lot, or one unit of a line, can be written off).
 * A line with no records falls back to its linked equipment.
 */
export function buildAssetReport(lines: ReportPurchaseLine[], year: number, assets: readonly ReportAsset[] = []): AssetReport {
  const depreciated = lines.filter(l => l.tax_treatment === 'depreciate');
  const rows: AssetRow[] = depreciated
    .filter(l => inYear(lineDay(l), year))
    .map(l => {
      const quantity = Number(l.quantity ?? 1) || 1;
      const cost = lineCost(l);
      const itemCost = money(l.item_cost != null ? Number(l.item_cost) : cost / quantity);
      return {
        id: l.id,
        assetId: l.asset?.id ?? l.asset_id,
        date: lineDay(l)!,
        description: l.asset?.manufacturer_model || l.description || '',
        vendor: l.vendor ?? l.parent?.vendor ?? '',
        category: l.asset?.category ?? l.category ?? '',
        quantity,
        itemCost,
        cost,
        recoveryPeriod: asRecoveryPeriod(l.asset?.recovery_period),
        deMinimis: itemCost <= TAX_DEPRECIATE_ABOVE,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));

  const periods = new Map<string, { period: RecoveryPeriod | null; count: number; total: number }>();
  for (const r of rows) {
    const k = String(r.recoveryPeriod ?? '');
    const p = periods.get(k) ?? { period: r.recoveryPeriod, count: 0, total: 0 };
    p.count += 1;
    p.total = money(p.total + r.cost);
    periods.set(k, p);
  }
  const byPeriod = [...periods.values()].sort((a, b) => (a.period ?? 99) - (b.period ?? 99));

  const recordsOf = (l: ReportPurchaseLine) => assets.filter(a => a.purchase_line_id === l.id || a.id === l.asset_id);
  // Each record's share of the line's cost, by its pieces. Shares are cut from the running total
  // (records in id order), so the pieces of a line always add up to the line: 3 of $100 are
  // 33.33, 33.33 and 33.34, not 99.99.
  const byRecord: DisposalRow[] = depreciated.flatMap(l => {
    const quantity = Number(l.quantity ?? 1) || 1;
    const total = lineCost(l);
    let before = 0;
    const shares = [...recordsOf(l)].sort((a, b) => a.id.localeCompare(b.id)).map(a => {
      const after = before + (Number(a.quantity ?? 1) || 1);
      const cost = money(money(total * after / quantity) - money(total * before / quantity));
      before = after;
      return { a, cost };
    });
    return shares
      .filter(({ a }) => inYear(dayOf(a.retired_on), year))
      .map(({ a, cost }) => ({
        id: a.id,
        assetId: a.id,
        description: a.manufacturer_model || l.description || '',
        bought: lineDay(l) ?? '',
        cost,
        disposed: dayOf(a.retired_on)!,
        proceeds: a.liquidation_amt != null ? money(Number(a.liquidation_amt)) : null,
        status: a.status ?? '',
      }));
  });
  const disposals: DisposalRow[] = depreciated
    .filter(l => recordsOf(l).length === 0 && l.asset && inYear(dayOf(l.asset.retired_on), year))
    .map(l => ({
      id: l.id,
      assetId: l.asset!.id,
      description: l.asset!.manufacturer_model || l.description || '',
      bought: lineDay(l) ?? '',
      cost: lineCost(l),
      disposed: dayOf(l.asset!.retired_on)!,
      proceeds: l.asset!.liquidation_amt != null ? money(Number(l.asset!.liquidation_amt)) : null,
      status: l.asset!.status ?? '',
    }))
    .concat(byRecord)
    .sort((a, b) => a.disposed.localeCompare(b.disposed) || a.description.localeCompare(b.description));

  return {
    rows,
    total: money(rows.reduce((s, r) => s + r.cost, 0)),
    byPeriod,
    missingPeriod: rows.filter(r => !r.recoveryPeriod).length,
    deMinimis: rows.filter(r => r.deMinimis).length,
    disposals,
  };
}

// ---- Grey zone -------------------------------------------------------------------

export interface GreyZoneRow {
  id: string;
  /** The invoice to open to change the treatment; null for a line without one. */
  purchaseId: string | null;
  date: string;
  description: string;
  vendor: string;
  category: string;
  quantity: number;
  itemCost: number;
  cost: number;
  treatment: TaxTreatment;
  /** Tracked as equipment (has an equipment record). */
  tracked: boolean;
}

export interface GreyZoneReport {
  rows: GreyZoneRow[];
  total: number;
  expensed: number;
  depreciated: number;
}

/**
 * Equipment lines in the year whose per-item cost (after tax and shipping) is
 * from $200 to $2,500, both included: the range where the treatment is the
 * user's call (`suggestedTaxTreatment` pre-sets nothing). Equipment means
 * depreciated, tracked as equipment, or filed under an equipment category.
 */
export function buildGreyZoneReport(lines: ReportPurchaseLine[], equipmentCategories: string[], year: number): GreyZoneReport {
  const equipment = new Set(equipmentCategories.map(c => tidyAssetCategory(c.trim()).toLowerCase()));
  const rows: GreyZoneRow[] = [];
  for (const l of lines) {
    const day = lineDay(l);
    if (!inYear(day, year)) continue;
    const treatment = lineTaxTreatment(l)!;
    const tracked = !!(l.asset_id ?? l.asset);
    const isEquipment = treatment === 'depreciate' || tracked
      || equipment.has(tidyAssetCategory((l.category ?? '').trim()).toLowerCase());
    if (!isEquipment) continue;
    const quantity = Number(l.quantity ?? 1) || 1;
    const cost = lineCost(l);
    const itemCost = money(l.item_cost != null ? Number(l.item_cost) : cost / quantity);
    if (suggestedTaxTreatment(itemCost) !== null) continue;
    rows.push({
      id: l.id,
      purchaseId: l.parent_id ?? null,
      date: day!,
      description: l.asset?.manufacturer_model || l.description || '',
      vendor: l.vendor ?? l.parent?.vendor ?? '',
      category: l.asset?.category ?? l.category ?? '',
      quantity,
      itemCost,
      cost,
      treatment,
      tracked,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));
  return {
    rows,
    total: money(rows.reduce((s, r) => s + r.cost, 0)),
    expensed: rows.filter(r => r.treatment === 'expense').length,
    depreciated: rows.filter(r => r.treatment === 'depreciate').length,
  };
}

// ---- CSV -------------------------------------------------------------------------

export function incomeCsv(r: IncomeReport): string {
  return Papa.unparse({
    fields: ['Date received', 'Gig', 'Gig date', 'From', 'Description', 'Reference', 'Amount'],
    data: r.rows.map(x => [x.date, x.gig, x.gigDate, x.from, x.description, x.reference, x.amount.toFixed(2)]),
  });
}

export function expensesCsv(r: ExpenseReport, scheduleC: ScheduleCLineLabel[]): string {
  const labels = new Map(scheduleC.map(s => [s.code, s.label] as const));
  return Papa.unparse({
    fields: ['Date paid', 'Source', 'Payee', 'Description', 'Category', 'Schedule C line', 'Line name', 'Gig', 'Miles', 'Amount'],
    data: r.rows.map(x => [
      x.date, x.source, x.payee, x.description, x.category, x.line ?? '', x.line ? labels.get(x.line) ?? '' : '',
      x.gig, x.miles ?? '', x.amount.toFixed(2),
    ]),
  });
}

export function assetsCsv(r: AssetReport): string {
  return Papa.unparse({
    fields: ['Date placed in service', 'Description', 'Vendor', 'Category', 'Quantity', 'Cost per item', 'Cost (basis)', 'Recovery period (years)', 'De minimis candidate'],
    data: r.rows.map(x => [
      x.date, x.description, x.vendor, x.category, x.quantity, x.itemCost.toFixed(2), x.cost.toFixed(2),
      x.recoveryPeriod ?? '', x.deMinimis ? 'Yes' : 'No',
    ]),
  });
}

export function disposalsCsv(r: AssetReport): string {
  return Papa.unparse({
    fields: ['Description', 'Date placed in service', 'Cost (basis)', 'Date disposed', 'Sale proceeds', 'Status'],
    data: r.disposals.map(x => [x.description, x.bought, x.cost.toFixed(2), x.disposed, x.proceeds?.toFixed(2) ?? '', x.status]),
  });
}

export function greyZoneCsv(r: GreyZoneReport): string {
  return Papa.unparse({
    fields: ['Date bought', 'Description', 'Vendor', 'Category', 'Quantity', 'Cost per item', 'Cost', 'Treatment', 'Tracked as equipment'],
    data: r.rows.map(x => [
      x.date, x.description, x.vendor, x.category, x.quantity, x.itemCost.toFixed(2), x.cost.toFixed(2),
      taxTreatmentLabel(x.treatment), x.tracked ? 'Yes' : 'No',
    ]),
  });
}

/** `act4audio-expenses-2026.csv` */
export function reportFilename(orgName: string, report: string, year: number): string {
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization';
  return `${slug}-${report}-${year}.csv`;
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * The Schedule C summary and Needs attention reports under Financials → Reporting
 * (#125). Both are built from the other reports in utils/taxReports, so they count
 * exactly what those count:
 *
 *   GROSS RECEIPTS  = the Income report's total (money in received in the year)
 *   COST OF GOODS   = line 4: the Expenses report's cost of goods sold (#321)
 *   GROSS PROFIT    = gross receipts − cost of goods sold
 *   EXPENSES        = the Expenses report's roll-up by Part II Schedule C line
 *   LINE 9 MILEAGE  = the year's mileage rows on line 9: miles, and miles × the IRS
 *                     rate on each trip's date. A mileage row is already an expense
 *                     on its category's line, so it is shown there, never added again.
 *   NET             = gross profit − total expenses, before depreciation
 *
 * Needs attention lists what would leave the year's reports wrong or incomplete.
 */
import Papa from 'papaparse';
import { calculateMileageAmount } from './financials.utils';
import { getDiscrepancy } from '../components/financials/purchases/reconciliation';
import {
  dayOf, money,
  COGS_LINE, type IncomeReport, type ExpenseReport, type ReportGigRow, type ReportPurchaseLine, type ScheduleCLineLabel,
} from './taxReports';

export const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

const inYear = (day: string | null, year: number) => !!day && day.startsWith(`${year}-`);
const lineDay = (l: ReportPurchaseLine) => dayOf(l.purchase_date ?? l.parent?.purchase_date ?? null);
const lineCost = (l: ReportPurchaseLine) =>
  money(l.line_cost != null ? Number(l.line_cost) : Number(l.item_cost ?? 0) * Number(l.quantity ?? 1));

// ---- Schedule C summary ------------------------------------------------------------

export const CAR_AND_TRUCK_LINE = '9';
export const NO_CATEGORY_LABEL = 'No category (no Schedule C line)';
export const NOT_DEDUCTED_LABEL = 'Not deducted (category has no Schedule C line; not in total)';
export const DEPRECIATION_NOTE = 'Depreciation and Section 179 are worked out by your tax program from the Assets report.';

export interface ScheduleCLine {
  line: string;
  label: string;
  total: number;
  /** Line 9 only: the miles behind it; null on every other line. */
  miles: number | null;
}

export interface ScheduleCSummary {
  receipts: number;
  /** Line 4: cost of goods sold (Part III), off gross receipts before the Part II expenses. */
  costOfGoodsSold: number;
  /** Line 4's label. */
  costOfGoodsSoldLabel: string;
  grossProfit: number;
  /** Lines with expenses, in line order. Equal to the Expenses report's roll-up. */
  lines: ScheduleCLine[];
  /** Expenses with no category, or one that isn't on the list. */
  noCategory: number;
  /** Expenses in a category with no Schedule C line (e.g. Reimbursable): not deducted, not in the total. */
  notDeducted: number;
  mileage: {
    /** Mileage counted on line 9: what the rows record, and what the IRS rate on each trip's date makes it. */
    line9: { trips: number; miles: number; recorded: number; atIrsRate: number };
    /** Mileage counted on another line (or none), because of its category. */
    elsewhere: { trips: number; miles: number; recorded: number; lines: string[] };
  };
  totalExpenses: number;
  net: number;
}

export function buildScheduleCSummary(
  income: IncomeReport,
  expenses: ExpenseReport,
  gigRows: ReportGigRow[],
  scheduleC: ScheduleCLineLabel[],
): ScheduleCSummary {
  const labels = new Map(scheduleC.map(s => [s.code, s.label] as const));
  const tripDay = new Map(gigRows.map(r => [r.id, dayOf(r.date ?? null)] as const));

  // The year's mileage, as the Expenses report counted it (paid, not tied to a purchase).
  const line9 = { trips: 0, miles: 0, recorded: 0, atIrsRate: 0 };
  const elsewhere = { trips: 0, miles: 0, recorded: 0, lines: [] as string[] };
  for (const r of expenses.rows) {
    if (r.source !== 'Gig' || !r.miles || r.miles <= 0) continue;
    if (r.line === CAR_AND_TRUCK_LINE) {
      line9.trips += 1;
      line9.miles += r.miles;
      line9.recorded = money(line9.recorded + r.amount);
      line9.atIrsRate = money(line9.atIrsRate + calculateMileageAmount(r.miles, tripDay.get(r.id) ?? r.date));
    } else {
      elsewhere.trips += 1;
      elsewhere.miles += r.miles;
      elsewhere.recorded = money(elsewhere.recorded + r.amount);
      const where = r.line ?? 'none';
      if (!elsewhere.lines.includes(where)) elsewhere.lines.push(where);
    }
  }

  const lines: ScheduleCLine[] = expenses.byLine
    .filter(g => g.line !== null)
    .map(g => ({
      line: g.line!,
      label: labels.get(g.line!) ?? '',
      total: g.total,
      miles: g.line === CAR_AND_TRUCK_LINE ? line9.miles : null,
    }));

  const noLine = expenses.rows.filter(r => r.line === null);
  const noCategory = money(noLine.filter(r => r.unlisted).reduce((s, r) => s + r.amount, 0));
  const notDeducted = money(noLine.filter(r => !r.unlisted).reduce((s, r) => s + r.amount, 0));
  const totalExpenses = money(lines.reduce((s, l) => s + l.total, 0) + noCategory);

  const costOfGoodsSold = expenses.costOfGoodsSold.total;
  const grossProfit = money(income.total - costOfGoodsSold);

  return {
    receipts: income.total,
    costOfGoodsSold,
    costOfGoodsSoldLabel: labels.get(COGS_LINE) ?? 'Cost of goods sold (Part III)',
    grossProfit,
    lines,
    noCategory,
    notDeducted,
    mileage: { line9, elsewhere },
    totalExpenses,
    net: money(grossProfit - totalExpenses),
  };
}

export function scheduleCCsv(r: ScheduleCSummary): string {
  const row = (line: string, description: string, amount: number, miles: number | null = null) =>
    [line, description, amount.toFixed(2), miles ?? ''];
  return Papa.unparse({
    fields: ['Line', 'Description', 'Amount', 'Miles'],
    data: [
      row('', 'Gross receipts', r.receipts),
      row(COGS_LINE, r.costOfGoodsSoldLabel, r.costOfGoodsSold),
      row('', 'Gross profit', r.grossProfit),
      ...r.lines.map(l => row(l.line, l.label, l.total, l.miles)),
      ...(r.noCategory ? [row('', NO_CATEGORY_LABEL, r.noCategory)] : []),
      row('', 'Total expenses', r.totalExpenses),
      row('', 'Net (before depreciation)', r.net),
      ...(r.notDeducted ? [row('', NOT_DEDUCTED_LABEL, r.notDeducted)] : []),
    ],
  });
}

// ---- Needs attention ---------------------------------------------------------------

/** Equipment, as loaded by services/taxReport.service. */
export interface ReportAsset {
  id: string;
  manufacturer_model: string | null;
  description: string | null;
  category: string | null;
  acquisition_date: string | null;
  item_cost: number | null;
  status: string | null;
  retired_on: string | null;
  recovery_period: number | null;
  purchase_line_id: string | null;
  quantity?: number | null;
  liquidation_amt?: number | null;
  serial_number?: string | null;
  tag_number?: string | null;
  equipment_item_id?: string | null;
  /** The lot a written-off piece was split off (#185), set only by write_off_pieces. */
  written_off_from?: string | null;
}

/**
 * Pieces split off a lot when written off (#185): the record says which lot (written_off_from),
 * and that lot is still listed. The lot already answers for them, so they aren't flagged a
 * second time.
 */
export function isSplitOffPiece(a: ReportAsset, all: readonly ReportAsset[]): boolean {
  if (a.status !== 'Missing' || !a.written_off_from) return false;
  return all.some(o => o.id === a.written_off_from);
}

/** A purchase's invoice (its header row). */
export interface ReportInvoice {
  id: string;
  purchase_date: string | null;
  vendor: string | null;
  description: string | null;
  total_inv_amount: number | null;
}

export type AttentionKey = 'no-category' | 'no-recovery-period' | 'no-cost' | 'no-disposal-date' | 'invoice-mismatch';

export interface AttentionRow {
  id: string;
  item: string;
  date: string;
  amount: number | null;
  problem: string;
  /** The purchase (invoice) to open to fix it. */
  purchaseId?: string | null;
  /** The equipment record to open to fix it. */
  assetId?: string | null;
}

export interface AttentionGroup {
  key: AttentionKey;
  title: string;
  rows: AttentionRow[];
}

export interface NeedsAttentionReport {
  groups: AttentionGroup[];
  total: number;
}

export const ATTENTION_TITLES: Record<AttentionKey, string> = {
  'no-category': 'Expensed with no expense category',
  'no-recovery-period': 'Depreciated with no recovery period',
  'no-cost': 'Equipment with no cost',
  'no-disposal-date': 'Disposed or returned with no date disposed',
  'invoice-mismatch': 'Invoices that don’t add up',
};

const DISPOSED_STATUSES = new Set(['Disposed', 'Returned', 'Missing']);
const byDate = (a: AttentionRow, b: AttentionRow) => a.date.localeCompare(b.date);
const assetName = (a: ReportAsset) => a.manufacturer_model || a.description || '(equipment)';
const withVendor = (what: string, vendor: string | null | undefined) => vendor ? `${what} (${vendor})` : what;

export function buildNeedsAttentionReport(
  data: { lines: ReportPurchaseLine[]; assets: ReportAsset[]; invoices: ReportInvoice[]; expenses: ExpenseReport },
  year: number,
): NeedsAttentionReport {
  const { lines, assets, invoices, expenses } = data;
  const lineById = new Map(lines.map(l => [l.id, l] as const));

  // 1. The Expenses report's purchase lines that have no category on the list.
  const noCategory: AttentionRow[] = expenses.rows
    .filter(r => r.source === 'Purchase' && r.unlisted)
    .map(r => ({
      id: r.id,
      item: withVendor(r.description || '(no description)', r.payee),
      date: r.date,
      amount: r.amount,
      problem: r.category ? `“${r.category}” isn’t on your expense list` : 'No category',
      purchaseId: lineById.get(r.id)?.parent_id ?? null,
    }));

  // 2. Depreciated lines bought in the year: each unit with no recovery period; a line with no equipment at all.
  const depreciated = lines.filter(l => l.tax_treatment === 'depreciate' && inYear(lineDay(l), year));
  const noPeriod: AttentionRow[] = [];
  const untracked: AttentionRow[] = [];
  for (const l of depreciated) {
    const units = assets.filter(a => a.purchase_line_id === l.id || a.id === l.asset_id);
    if (units.length === 0 && !l.asset_id) {
      untracked.push({
        id: l.id, item: withVendor(l.description || '(no description)', l.vendor ?? l.parent?.vendor), date: lineDay(l)!,
        amount: lineCost(l), problem: 'Depreciated, but not tracked as equipment, so it has no recovery period',
        purchaseId: l.parent_id ?? null,
      });
    }
    for (const a of units) {
      if (a.recovery_period != null || noPeriod.some(x => x.id === a.id) || isSplitOffPiece(a, assets)) continue;
      noPeriod.push({
        id: a.id, item: assetName(a), date: lineDay(l)!,
        amount: a.item_cost != null ? money(Number(a.item_cost)) : null,
        problem: 'Depreciated, with no recovery period', assetId: a.id,
      });
    }
  }

  // 3. Equipment bought in the year with no cost.
  const noCost: AttentionRow[] = assets
    .filter(a => inYear(dayOf(a.acquisition_date), year) && !Number(a.item_cost ?? 0) && !isSplitOffPiece(a, assets))
    .map(a => ({
      id: a.id, item: assetName(a), date: dayOf(a.acquisition_date)!,
      amount: a.item_cost != null ? 0 : null, problem: 'No cost', assetId: a.id,
    }));

  // 4. Disposed or returned with no date disposed, whatever year.
  const noDisposalDate: AttentionRow[] = assets
    .filter(a => DISPOSED_STATUSES.has(a.status ?? '') && !a.retired_on)
    .map(a => ({
      id: a.id, item: assetName(a), date: dayOf(a.acquisition_date) ?? '',
      amount: a.item_cost != null ? money(Number(a.item_cost)) : null,
      problem: `${a.status}, with no date disposed`, assetId: a.id,
    }));

  // 5. Invoices in the year whose lines don't add up to the total (the purchase list's Mismatch rule, to the cent).
  const children = new Map<string, ReportPurchaseLine[]>();
  for (const l of lines) if (l.parent_id) children.set(l.parent_id, [...(children.get(l.parent_id) ?? []), l]);
  const mismatched: AttentionRow[] = [];
  for (const h of invoices) {
    const day = dayOf(h.purchase_date);
    if (!inYear(day, year)) continue;
    const kids = children.get(h.id) ?? [];
    const diff = money(getDiscrepancy(h.total_inv_amount, kids));
    if (Math.abs(diff) <= 0.01) continue;
    const total = money(Number(h.total_inv_amount ?? 0));
    mismatched.push({
      id: h.id,
      item: [h.vendor || '(no vendor)', h.description].filter(Boolean).join(': '),
      date: day!,
      amount: total,
      problem: `Lines total ${usd(money(total - diff))}; the invoice total is ${usd(total)} (off by ${usd(Math.abs(diff))})`,
      purchaseId: h.id,
    });
  }

  const groups: AttentionGroup[] = ([
    ['no-category', noCategory],
    ['no-recovery-period', [...noPeriod.sort(byDate), ...untracked.sort(byDate)]],
    ['no-cost', noCost.sort(byDate)],
    ['no-disposal-date', noDisposalDate.sort(byDate)],
    ['invoice-mismatch', mismatched.sort(byDate)],
  ] as [AttentionKey, AttentionRow[]][]).map(([key, rows]) => ({ key, title: ATTENTION_TITLES[key], rows }));

  return { groups, total: groups.reduce((s, g) => s + g.rows.length, 0) };
}

export function needsAttentionCsv(r: NeedsAttentionReport): string {
  return Papa.unparse({
    fields: ['Group', 'Item', 'Date', 'Amount', 'Problem'],
    data: r.groups.flatMap(g => g.rows.map(x => [g.title, x.item, x.date, x.amount?.toFixed(2) ?? '', x.problem])),
  });
}

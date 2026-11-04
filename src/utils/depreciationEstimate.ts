/**
 * Depreciation for the Schedule C report (#337): a filed year's Form 4562 figures as entered, and
 * an estimate of the open year's line 13 from the years entered and the app's own purchases.
 *
 * A vintage is a year's line 19 rows (equipment placed in service that year), or, for a year with
 * nothing entered, its depreciated purchases. Line 17 of year N is each earlier vintage's basis × its
 * rate for that year of recovery. Every row is rounded to whole dollars and every total is the sum of
 * the rounded rows, as the form is filled in, so a breakdown always adds up.
 */
import { macrsRate, defaultMethod, type MacrsMethod, type Quarter, type RecoveryYears } from './macrs';
import type { TaxYearDepreciation } from '../services/taxYearDepreciation.service';

/** A depreciated purchase recorded in the app. */
export interface PlacedItem {
  date: string;
  cost: number;
  recoveryYears: RecoveryYears;
}

/** A depreciated record disposed of: its share of its line's cost, and when it was bought and disposed of. */
export interface DisposedItem {
  bought: string;
  disposed: string;
  cost: number;
  recoveryYears: RecoveryYears;
}

type Quarters = [number, number, number, number];

export interface Vintage {
  year: number;
  recoveryYears: RecoveryYears;
  method: MacrsMethod;
  convention: 'HY' | 'MQ';
  basis: number;
  /** Mid-quarter: the basis placed in service in each quarter. */
  quarters: Quarters | null;
  /** The quarters were worked out from the row's deduction, not from purchase dates. */
  quartersApproximated: boolean;
  /** Basis per dollar of the app's cost for this year and class: carries a disposed record's cost into the vintage. */
  basisPerCost: number | null;
  source: 'entered' | 'app';
}

export interface BreakdownRow {
  label: string;
  amount: number;
  note?: string;
}

/** The method for the app's own purchases: the usual one, except its 15-year class (leasehold build-out, qualified improvement property) is straight line. */
export const appMethod = (years: RecoveryYears): MacrsMethod => (years === 15 ? 'SL' : defaultMethod(years));

const yearOf = (date: string) => Number(date.slice(0, 4));
const quarterOf = (date: string): Quarter => (Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1) as Quarter;
const cents = (n: number) => Math.round(n * 100) / 100;
const dollars = (n: number) => Math.round(n + 1e-9);
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${n}%`;
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/** The app's cost of a class placed in service in a year, by quarter. */
function costByQuarter(purchases: readonly PlacedItem[], year: number, years: RecoveryYears): Quarters {
  const q: Quarters = [0, 0, 0, 0];
  for (const p of purchases) if (yearOf(p.date) === year && p.recoveryYears === years) q[quarterOf(p.date) - 1] += p.cost;
  return q;
}

/**
 * A mid-quarter row's quarters, from its deduction (g): the basis is split between the two adjacent
 * quarters whose first-year rates bracket (g) ÷ (c), so year 1 comes out exactly. With no deduction,
 * or one at or below the fourth quarter's rate, all of it is in Q4.
 */
function quartersFromDeduction(basis: number, deduction: number | null, years: RecoveryYears, method: MacrsMethod): Quarters {
  const q: Quarters = [0, 0, 0, 0];
  const rates = ([1, 2, 3, 4] as Quarter[]).map(n => macrsRate(years, method, 'MQ', n, 1));
  const ratio = deduction != null && basis > 0 ? (deduction / basis) * 100 : null;
  if (ratio == null || ratio <= rates[3]) { q[3] = basis; return q; }
  if (ratio >= rates[0]) { q[0] = basis; return q; }
  const i = rates.findIndex((r, n) => n < 3 && ratio <= r && ratio >= rates[n + 1]);
  const inFirst = cents(basis * (ratio - rates[i + 1]) / (rates[i] - rates[i + 1]));
  q[i] = inFirst;
  q[i + 1] = cents(basis - inFirst);
  return q;
}

/** Each entered year's line 19 rows as vintages; mid-quarter quarters from purchase dates when the app has them. */
export function vintagesFrom(filed: readonly TaxYearDepreciation[], purchases: readonly PlacedItem[]): Vintage[] {
  return filed.flatMap(f => f.rows.map((row): Vintage => {
    const years = row.recovery_years;
    const app = costByQuarter(purchases, f.year, years);
    const appTotal = sum(app);
    let quarters: Quarters | null = null;
    let approximated = false;
    if (row.convention === 'MQ') {
      if (appTotal > 0) quarters = app.map(c => cents(c * row.basis / appTotal)) as Quarters;
      else { quarters = quartersFromDeduction(row.basis, row.deduction, years, row.method); approximated = true; }
    }
    return {
      year: f.year, recoveryYears: years, method: row.method, convention: row.convention, basis: row.basis,
      quarters, quartersApproximated: approximated, basisPerCost: appTotal > 0 ? row.basis / appTotal : null, source: 'entered',
    };
  }));
}

/**
 * A year's purchases as vintages, for a year with nothing entered: cost as basis, the usual method.
 * `goneSameYear`: what was disposed of in the year it was bought, taken off its class and quarter
 * (it gets no deduction), by its share of cost, so part of a lot counts too.
 */
function appVintages(
  purchases: readonly PlacedItem[], year: number, convention: 'HY' | 'MQ', factor = 1, goneSameYear: readonly DisposedItem[] = [],
): Vintage[] {
  const classes = [...new Set(purchases.filter(p => yearOf(p.date) === year).map(p => p.recoveryYears))].sort((a, b) => a - b);
  return classes.map(years => {
    const cost = costByQuarter(purchases, year, years);
    for (const d of goneSameYear) {
      if (yearOf(d.bought) === year && yearOf(d.disposed) === year && d.recoveryYears === years) {
        const i = quarterOf(d.bought) - 1;
        cost[i] = Math.max(0, cents(cost[i] - d.cost));
      }
    }
    const q = cost.map(c => cents(c * factor)) as Quarters;
    return {
      year, recoveryYears: years, method: appMethod(years), convention, basis: cents(sum(q)),
      quarters: convention === 'MQ' ? q : null, quartersApproximated: false, basisPerCost: factor, source: 'app',
    };
  });
}

/** One vintage's deduction in a year, before rounding, on the basis (and quarters) given. */
function deduction(v: Vintage, year: number, basis: number, quarters: Quarters | null): number {
  const k = year - v.year + 1;
  if (v.convention === 'MQ' && quarters) {
    return sum(quarters.map((b, i) => b * macrsRate(v.recoveryYears, v.method, 'MQ', (i + 1) as Quarter, k) / 100));
  }
  return basis * macrsRate(v.recoveryYears, v.method, 'HY', null, k) / 100;
}

function describe(v: Vintage, year: number, basis: number, quarters: Quarters | null): string {
  const k = year - v.year + 1;
  if (v.convention === 'MQ' && quarters) {
    return quarters.map((b, i) => (b ? `Q${i + 1} ${usd(b)} × ${pct(macrsRate(v.recoveryYears, v.method, 'MQ', (i + 1) as Quarter, k))}` : ''))
      .filter(Boolean).join(', ');
  }
  return `${usd(basis)} × ${pct(macrsRate(v.recoveryYears, v.method, 'HY', null, k))}`;
}

/**
 * A vintage's basis still owned in a year: less what was disposed of before it. A disposed record's
 * share of an entered vintage is its cost × the vintage's basis per dollar of the app's cost.
 */
function owned(v: Vintage, disposals: readonly DisposedItem[], before: number) {
  let basis = v.basis;
  const quarters = v.quarters ? [...v.quarters] as Quarters : null;
  for (const d of disposals) {
    if (yearOf(d.bought) !== v.year || d.recoveryYears !== v.recoveryYears || v.basisPerCost == null) continue;
    if (yearOf(d.disposed) >= before) continue;
    const share = cents(d.cost * v.basisPerCost);
    basis -= share;
    if (quarters) quarters[quarterOf(d.bought) - 1] -= share;
  }
  return { basis: cents(basis), quarters };
}

/** Line 17 of a year: every earlier vintage's deduction, one row each, and this year's disposals as their own rows. */
export function line17For(year: number, vintages: readonly Vintage[], disposals: readonly DisposedItem[] = []): { rows: BreakdownRow[]; total: number } {
  const rows: BreakdownRow[] = [];
  for (const v of vintages.filter(x => x.year < year).sort((a, b) => a.year - b.year || a.recoveryYears - b.recoveryYears)) {
    const { basis, quarters } = owned(v, disposals, year);
    if (basis <= 0) continue;
    const amount = dollars(deduction(v, year, basis, quarters));
    if (amount === 0) continue;
    rows.push({
      label: `Line 17: ${v.year} equipment, ${v.recoveryYears}-year ${v.convention} (${describe(v, year, basis, quarters)})`,
      amount,
      ...(v.source === 'app' ? { note: `From your purchases; no Form 4562 entered for ${v.year}` }
        : v.quartersApproximated ? { note: 'Quarters approximated from the deduction entered' } : {}),
    });
    // Disposed of this year: the part of the year not taken (HY: half; MQ: to the middle of the quarter of disposal).
    let lost = 0;
    for (const d of disposals) {
      if (yearOf(d.bought) !== v.year || d.recoveryYears !== v.recoveryYears || v.basisPerCost == null || yearOf(d.disposed) !== year) continue;
      const share = cents(d.cost * v.basisPerCost);
      const q = quarterOf(d.bought);
      const full = deduction(v, year, share, v.convention === 'MQ' ? ([1, 2, 3, 4].map(n => (n === q ? share : 0)) as Quarters) : null);
      const kept = v.convention === 'MQ' ? ((quarterOf(d.disposed) - 1) * 3 + 1.5) / 12 : 0.5;
      lost += full * (1 - kept);
    }
    if (lost > 0) {
      rows.push({
        label: `${v.year} equipment disposed of in ${year} (${v.convention === 'MQ' ? 'to mid-quarter' : 'half year'})`,
        amount: -dollars(lost),
      });
    }
  }
  return { rows, total: sum(rows.map(r => r.amount)) };
}

export interface OpenYearEstimate {
  rows: BreakdownRow[];
  total: number;
  /**
   * Line 17 on the latest filed return that the years before it don't explain: shown, not carried
   * forward. Negative when the purchases of years with nothing entered (`appYears`) explain more.
   */
  gap: { year: number; amount: number; appYears: number[] } | null;
}

/** The open year's estimate of Schedule C line 13. */
export function estimateOpenYear(args: {
  year: number;
  figures: TaxYearDepreciation | null;
  filed: readonly TaxYearDepreciation[];
  purchases: readonly PlacedItem[];
  disposals: readonly DisposedItem[];
}): OpenYearEstimate {
  const { year, figures, purchases, disposals } = args;
  const filed = args.filed.filter(f => f.year < year);
  const entered = new Set(filed.map(f => f.year));
  const earlierYears = [...new Set(purchases.map(p => yearOf(p.date)))].filter(y => y < year && !entered.has(y));
  const vintages = [...vintagesFrom(filed, purchases), ...earlierYears.flatMap(y => appVintages(purchases, y, 'HY'))];

  const rows: BreakdownRow[] = [...line17For(year, vintages, disposals).rows];

  // This year's purchases (less what's already disposed of), less planned Section 179 and bonus, pro rata.
  const thisYear = purchases.filter(p => yearOf(p.date) === year);
  const goneThisYear = disposals.filter(d => yearOf(d.bought) === year && yearOf(d.disposed) === year);
  const planned179 = figures?.planned_179 ?? 0;
  const plannedBonus = figures?.planned_bonus ?? 0;
  const cost = Math.max(0, sum(thisYear.map(p => p.cost)) - sum(goneThisYear.map(d => d.cost)));
  const factor = cost > 0 ? Math.max(0, 1 - (planned179 + plannedBonus) / cost) : 0;
  const convention = figures?.estimate_convention ?? 'HY';
  for (const v of appVintages(thisYear, year, convention, factor, goneThisYear)) {
    const amount = dollars(deduction(v, year, v.basis, v.quarters));
    if (amount === 0) continue;
    rows.push({ label: `Line 19: ${year} purchases, ${v.recoveryYears}-year ${convention} (${describe(v, year, v.basis, v.quarters)})`, amount });
  }
  if (planned179) rows.push({ label: 'Line 12: Section 179 (planned)', amount: dollars(planned179) });
  if (plannedBonus) rows.push({ label: 'Line 14: Special depreciation (planned)', amount: dollars(plannedBonus) });
  if (figures?.other_expected) rows.push({ label: 'Other depreciation you expect', amount: dollars(figures.other_expected) });

  // The latest filed year's line 17 against what the years before it explain.
  const latest = [...filed].filter(f => f.line_17 != null).sort((a, b) => b.year - a.year)[0];
  let gap: OpenYearEstimate['gap'] = null;
  if (latest) {
    const explained = line17For(latest.year, vintages.filter(v => v.year < latest.year), disposals).total;
    const diff = dollars(latest.line_17! - explained);
    const appYears = [...new Set(vintages.filter(v => v.source === 'app' && v.year < latest.year).map(v => v.year))].sort((a, b) => a - b);
    if (diff !== 0) gap = { year: latest.year, amount: diff, appYears };
  }
  return { rows, total: sum(rows.map(r => r.amount)), gap };
}

export interface FiledYearView {
  status: 'entered' | 'not-entered';
  /** Line 22 as entered; the sum of the parts when it wasn't. */
  total: number | null;
  rows: BreakdownRow[];
  /** Line 17 as entered, against what the earlier years entered give. */
  line17Check: { entered: number; fromYearsEntered: number } | null;
  /** How much of line 22 comes from lines not entered here (15, 16, 20). */
  unexplained: number;
}

/** A filed year's line 13: the Form 4562 figures as entered. */
export function filedYearView(figures: TaxYearDepreciation | null, vintages: readonly Vintage[]): FiledYearView {
  if (!figures) return { status: 'not-entered', total: null, rows: [], line17Check: null, unexplained: 0 };
  const rows: BreakdownRow[] = [];
  if (figures.line_12 != null) rows.push({ label: 'Line 12: Section 179', amount: dollars(figures.line_12) });
  if (figures.line_14 != null) rows.push({ label: 'Line 14: special depreciation', amount: dollars(figures.line_14) });
  if (figures.line_17 != null) rows.push({ label: 'Line 17: equipment from earlier years', amount: dollars(figures.line_17) });
  for (const r of figures.rows) {
    if (r.deduction != null) rows.push({ label: `Line 19(g): ${figures.year} equipment, ${r.recovery_years}-year ${r.convention}`, amount: dollars(r.deduction) });
  }
  if (figures.line_21 != null) rows.push({ label: 'Line 21: listed property', amount: dollars(figures.line_21) });
  const parts = sum(rows.map(r => r.amount));
  return {
    status: 'entered',
    total: figures.line_22 != null ? dollars(figures.line_22) : parts,
    rows,
    line17Check: figures.line_17 != null
      ? { entered: dollars(figures.line_17), fromYearsEntered: line17For(figures.year, vintages.filter(v => v.year < figures.year)).total }
      : null,
    unexplained: figures.line_22 != null ? dollars(figures.line_22) - parts : 0,
  };
}

/** A suggested Form 4562 line 19 row, from the app's purchases for a year and class. */
export interface SuggestedRow {
  recovery_years: RecoveryYears;
  /** The app's cost for the class, before Section 179 and bonus. */
  cost: number;
  basis: number;
  convention: 'HY' | 'MQ';
  method: MacrsMethod;
  deduction: number;
}

/**
 * The prefill for a filed year's line 19 (§5): one row per class bought that year, its cost less the
 * entered Section 179 and bonus pro rata by cost, and the first year's deduction on it (MQ quarters
 * from purchase dates).
 */
export function suggestedRows(
  year: number,
  purchases: readonly PlacedItem[],
  upFront: { line_12: number | null; line_14: number | null },
  convention: 'HY' | 'MQ',
): SuggestedRow[] {
  const cost = sum(purchases.filter(p => yearOf(p.date) === year).map(p => p.cost));
  const factor = cost > 0 ? Math.max(0, 1 - ((upFront.line_12 ?? 0) + (upFront.line_14 ?? 0)) / cost) : 0;
  return appVintages(purchases, year, convention, factor).map(v => ({
    recovery_years: v.recoveryYears,
    cost: cents(sum(costByQuarter(purchases, year, v.recoveryYears))),
    basis: v.basis,
    convention,
    method: v.method,
    deduction: dollars(deduction(v, year, v.basis, v.quarters)),
  }));
}

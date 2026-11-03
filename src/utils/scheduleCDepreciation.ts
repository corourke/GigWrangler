/**
 * Schedule C line 13, depreciation and section 179 (#337): for a year with Form 4562 line 22
 * entered, that figure; for a filed (locked) year with nothing entered, "Not entered"; otherwise an
 * estimate from the years entered and the app's purchases. The arithmetic is in depreciationEstimate.
 */
import {
  estimateOpenYear, filedYearView, vintagesFrom,
  type BreakdownRow, type DisposedItem, type OpenYearEstimate, type PlacedItem,
} from './depreciationEstimate';
import type { TaxYearDepreciation } from '../services/taxYearDepreciation.service';

export const LINE_13_LABEL = 'Depreciation and section 179';

export type Line13Source = 'Form 4562 line 22' | 'Estimated' | 'Not entered';

export interface Line13 {
  source: Line13Source;
  /** Null when not entered. */
  amount: number | null;
  rows: BreakdownRow[];
  /** A filed year: line 17 as entered, against what the earlier years entered give. */
  line17Check: { entered: number; fromYearsEntered: number } | null;
  /** A filed year: what line 22 holds from lines not entered here (15, 16, 20). */
  unexplained: number;
  /** An estimate: line 17 of the last filed return the earlier years don't explain. */
  gap: OpenYearEstimate['gap'];
  /** The net before depreciation, less line 13; null when not entered. */
  netAfter: number | null;
}

export function buildLine13(args: {
  year: number;
  /** Net before depreciation. */
  net: number;
  figures: readonly TaxYearDepreciation[];
  locked: ReadonlySet<number>;
  purchases: readonly PlacedItem[];
  disposals: readonly DisposedItem[];
}): Line13 {
  const { year, net, figures, locked, purchases, disposals } = args;
  const mine = figures.find(f => f.year === year) ?? null;
  const after = (amount: number) => Math.round((net - amount) * 100) / 100;

  if (mine?.line_22 != null) {
    const view = filedYearView(mine, vintagesFrom(figures.filter(f => f.year < year), purchases));
    return {
      source: 'Form 4562 line 22', amount: view.total, rows: view.rows,
      line17Check: view.line17Check, unexplained: view.unexplained, gap: null, netAfter: after(view.total!),
    };
  }
  if (locked.has(year)) {
    return { source: 'Not entered', amount: null, rows: [], line17Check: null, unexplained: 0, gap: null, netAfter: null };
  }
  const e = estimateOpenYear({ year, figures: mine, filed: figures.filter(f => f.line_22 != null), purchases, disposals });
  return { source: 'Estimated', amount: e.total, rows: e.rows, line17Check: null, unexplained: 0, gap: e.gap, netAfter: after(e.total) };
}

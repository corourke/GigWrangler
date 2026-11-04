/** Shared by the Form 4562 form and the estimate inputs (#337): money, typed amounts, and a year's figures. */
import type { DepreciationFigures, TaxYearDepreciation } from '../../services/taxYearDepreciation.service';

export const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export const BLANK_FIGURES: DepreciationFigures = {
  line_12: null, line_14: null, line_17: null, line_21: null, line_22: null,
  planned_179: null, planned_bonus: null, other_expected: null, estimate_convention: 'HY',
};

/** Just the figures of a saved year, so a save of one part keeps the other. */
export function figuresOf(d: TaxYearDepreciation | null | undefined): DepreciationFigures {
  if (!d) return { ...BLANK_FIGURES };
  const { line_12, line_14, line_17, line_21, line_22, planned_179, planned_bonus, other_expected, estimate_convention } = d;
  return { line_12, line_14, line_17, line_21, line_22, planned_179, planned_bonus, other_expected, estimate_convention };
}

export const text = (n: number | null | undefined) => (n == null ? '' : String(n));
/** A typed amount: blank is null, anything else a number of 0 or more (NaN when it isn't). */
export const parseAmount = (v: string): number | null => {
  const t = v.trim().replace(/[$,]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

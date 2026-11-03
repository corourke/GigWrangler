/**
 * Depreciation for the Schedule C report (#337). For a filed year, the figures copied by hand
 * from its Form 4562 (lines 12, 14, 17, 21 and 22, and its line 19 rows); for the open year, the
 * optional planned Section 179 and bonus, other depreciation expected, and the estimate's
 * convention. Admins and Managers read; only Admins save, also for a locked year.
 */
import { handleApiError } from '../utils/api-error-utils';
import { getCurrentUser, getSupabase } from './base/dataAccess';

export type RecoveryYears = 3 | 5 | 7 | 10 | 15 | 20;
export type Convention = 'HY' | 'MQ';
export type DepreciationMethod = '200DB' | '150DB' | 'SL';

/** One Form 4562 line 19 row: (c) basis, (d) recovery period, (e) convention, (f) method, (g) deduction. */
export interface DepreciationRow {
  recovery_years: RecoveryYears;
  basis: number;
  convention: Convention;
  method: DepreciationMethod;
  deduction: number | null;
}

/** The figures a year can hold, each blank (null) until entered. */
export interface DepreciationFigures {
  line_12: number | null;
  line_14: number | null;
  line_17: number | null;
  line_21: number | null;
  line_22: number | null;
  planned_179: number | null;
  planned_bonus: number | null;
  other_expected: number | null;
  estimate_convention: Convention;
}

export interface TaxYearDepreciation extends DepreciationFigures {
  year: number;
  updated_at: string | null;
  updated_by_name: string | null;
  rows: DepreciationRow[];
}

const AMOUNTS = ['line_12', 'line_14', 'line_17', 'line_21', 'line_22', 'planned_179', 'planned_bonus', 'other_expected'] as const;
const COLUMNS = `year, ${AMOUNTS.join(', ')}, estimate_convention, updated_at, `
  + 'updated_by_user:users!updated_by(first_name, last_name, email), '
  + 'rows:tax_year_depreciation_rows(recovery_years, basis, convention, method, deduction)';

// numeric columns can arrive as strings; a blank stays blank.
const amount = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

function nameOf(u: { first_name?: string | null; last_name?: string | null; email?: string | null } | null): string | null {
  if (!u) return null;
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || null;
}

function toRow(r: any): DepreciationRow {
  return {
    recovery_years: Number(r.recovery_years) as RecoveryYears,
    basis: Number(r.basis),
    convention: r.convention,
    method: r.method,
    deduction: amount(r.deduction),
  };
}

/** Every year with figures, newest first. */
export async function getTaxYearDepreciation(organizationId: string): Promise<TaxYearDepreciation[]> {
  try {
    await getCurrentUser();
    const supabase = getSupabase();
    const { data, error } = await supabase.from('tax_year_depreciation')
      .select(COLUMNS)
      .eq('organization_id', organizationId)
      .order('year', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((d: any): TaxYearDepreciation => ({
      year: Number(d.year),
      ...Object.fromEntries(AMOUNTS.map(k => [k, amount(d[k])])) as Record<(typeof AMOUNTS)[number], number | null>,
      estimate_convention: d.estimate_convention,
      updated_at: d.updated_at ?? null,
      updated_by_name: nameOf(d.updated_by_user),
      rows: (d.rows ?? []).map(toRow),
    }));
  } catch (err) {
    return handleApiError(err, 'load the depreciation figures');
  }
}

/** Save a year's figures and replace its line 19 rows, in one call (Admins only). */
export async function saveTaxYearDepreciation(
  organizationId: string,
  year: number,
  figures: Partial<DepreciationFigures>,
  rows: DepreciationRow[],
): Promise<void> {
  try {
    await getCurrentUser();
    const supabase = getSupabase();
    const { error } = await supabase.rpc('save_tax_year_depreciation', {
      p_org: organizationId,
      p_year: year,
      p_figures: {
        ...Object.fromEntries(AMOUNTS.map(k => [k, amount(figures[k])])),
        estimate_convention: figures.estimate_convention ?? 'HY',
      },
      p_rows: rows.map(r => ({ ...r, basis: Number(r.basis), deduction: amount(r.deduction) })),
    });
    if (error) throw error;
  } catch (err) {
    return handleApiError(err, 'save the depreciation figures');
  }
}

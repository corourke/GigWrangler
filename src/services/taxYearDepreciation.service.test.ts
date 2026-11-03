import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTaxYearDepreciation, saveTaxYearDepreciation } from './taxYearDepreciation.service';

const chain: any = {};
const rpc = vi.fn();
const getCurrentUser = vi.fn();
vi.mock('./base/dataAccess', () => ({
  getSupabase: () => ({ from: (t: string) => chain.from(t), rpc: (...a: unknown[]) => rpc(...a) }),
  getCurrentUser: () => getCurrentUser(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of ['from', 'select', 'eq', 'order']) chain[m] = vi.fn(() => chain);
  getCurrentUser.mockResolvedValue({ id: 'u1' });
  rpc.mockResolvedValue({ data: null, error: null });
});

// #337: the Form 4562 figures a user entered for each year, and the open year's planned amounts.
describe('tax year depreciation service', () => {
  it('reads each year\'s figures and line 19 rows, newest first, as numbers', async () => {
    chain.order.mockResolvedValueOnce({ data: [{
      year: 2024, line_12: '4000.00', line_14: null, line_17: null, line_21: null, line_22: '4214.00',
      planned_179: null, planned_bonus: null, other_expected: null, estimate_convention: 'HY',
      updated_at: '2026-11-03T20:00:00Z', updated_by_user: { first_name: 'Alex', last_name: 'Admin', email: 'a@example.com' },
      rows: [{ recovery_years: 7, basis: '6000.00', convention: 'MQ', method: '200DB', deduction: '214.00' }],
    }], error: null });
    expect(await getTaxYearDepreciation('org-1')).toEqual([{
      year: 2024, line_12: 4000, line_14: null, line_17: null, line_21: null, line_22: 4214,
      planned_179: null, planned_bonus: null, other_expected: null, estimate_convention: 'HY',
      updated_at: '2026-11-03T20:00:00Z', updated_by_name: 'Alex Admin',
      rows: [{ recovery_years: 7, basis: 6000, convention: 'MQ', method: '200DB', deduction: 214 }],
    }]);
    expect(chain.from).toHaveBeenCalledWith('tax_year_depreciation');
    expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(chain.order).toHaveBeenCalledWith('year', { ascending: false });
  });

  it('keeps a row\'s blank deduction blank, and names nobody when no one is recorded', async () => {
    chain.order.mockResolvedValueOnce({ data: [{
      year: 2026, line_12: null, line_14: null, line_17: null, line_21: null, line_22: null,
      planned_179: '1000', planned_bonus: null, other_expected: '250', estimate_convention: 'MQ',
      updated_at: null, updated_by_user: null,
      rows: [{ recovery_years: 5, basis: '800', convention: 'HY', method: 'SL', deduction: null }],
    }], error: null });
    const [y] = await getTaxYearDepreciation('org-1');
    expect(y).toMatchObject({ planned_179: 1000, other_expected: 250, estimate_convention: 'MQ', updated_by_name: null });
    expect(y.rows[0]).toEqual({ recovery_years: 5, basis: 800, convention: 'HY', method: 'SL', deduction: null });
  });

  it('requires a signed-in user', async () => {
    getCurrentUser.mockRejectedValueOnce(new Error('not signed in'));
    await expect(getTaxYearDepreciation('org-1')).rejects.toThrow();
  });

  it('saves a year through one call that replaces its rows; blanks go as null', async () => {
    await saveTaxYearDepreciation('org-1', 2024, { line_12: 4000, line_22: 4214 },
      [{ recovery_years: 7, basis: 6000, convention: 'MQ', method: '200DB', deduction: 214 }]);
    expect(rpc).toHaveBeenCalledWith('save_tax_year_depreciation', {
      p_org: 'org-1', p_year: 2024,
      p_figures: { line_12: 4000, line_14: null, line_17: null, line_21: null, line_22: 4214,
        planned_179: null, planned_bonus: null, other_expected: null, estimate_convention: 'HY' },
      p_rows: [{ recovery_years: 7, basis: 6000, convention: 'MQ', method: '200DB', deduction: 214 }],
    });
  });

  it('a refused save says what it was doing', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    await expect(saveTaxYearDepreciation('org-1', 2024, {}, [])).rejects.toThrow(/save the depreciation figures/);
  });
});

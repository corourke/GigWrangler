import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithQuery as render } from '../../test/renderWithQuery';
import userEvent from '@testing-library/user-event';
import TaxYearsCard from './TaxYearsCard';
import { toast } from 'sonner';
import { getTaxYears, saveTaxYear } from '../../services/taxYear.service';
import { getTaxYearDepreciation, saveTaxYearDepreciation, type TaxYearDepreciation } from '../../services/taxYearDepreciation.service';

vi.mock('../../services/taxYear.service', () => ({
  getTaxYears: vi.fn(),
  saveTaxYear: vi.fn(async () => ({})),
  deleteTaxYear: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock('../../services/taxYearDepreciation.service', () => ({
  getTaxYearDepreciation: vi.fn(async () => []),
  saveTaxYearDepreciation: vi.fn(async () => {}),
}));

// #133: filed tax years are locked so their purchases keep their tax fields.
describe('TaxYearsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTaxYears).mockResolvedValue([
      { organization_id: 'org-1', year: 2025, locked: true, filed_on: '2026-04-10', notes: null },
      { organization_id: 'org-1', year: 2024, locked: false, filed_on: null, notes: null },
    ]);
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([]);
  });

  const row = (year: string) => screen.getByRole('row', { name: new RegExp(`^${year}`) });

  it('lists each year as locked or open', async () => {
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    await waitFor(() => expect(row('2025')).toBeInTheDocument());
    expect(within(row('2025')).getByText('Locked')).toBeInTheDocument();
    expect(within(row('2025')).getByText('Apr 10, 2026')).toBeInTheDocument();
    expect(within(row('2024')).getByText('Open')).toBeInTheDocument();
  });

  it('lets an Admin lock a filed year', async () => {
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    await screen.findByText('Locked');
    await userEvent.clear(screen.getByLabelText('Tax year'));
    await userEvent.type(screen.getByLabelText('Tax year'), '2023');
    await userEvent.type(screen.getByLabelText('Filed on'), '2024-04-01');
    await userEvent.click(screen.getByRole('button', { name: 'Lock year' }));
    await waitFor(() => expect(saveTaxYear).toHaveBeenCalledWith('org-1', 2023, { locked: true, filed_on: '2024-04-01' }));
  });

  it('lets an Admin unlock a year, and lock it again', async () => {
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    await screen.findByText('Locked');
    await userEvent.click(within(row('2025')).getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(saveTaxYear).toHaveBeenCalledWith('org-1', 2025, { locked: false }));
    await userEvent.click(within(row('2024')).getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(saveTaxYear).toHaveBeenCalledWith('org-1', 2024, { locked: true }));
  });

  it('is read-only for Managers', async () => {
    render(<TaxYearsCard organizationId="org-1" userRole="Manager" />);
    await screen.findByText('Locked');
    expect(screen.queryByRole('button', { name: 'Lock year' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only Admins can lock or unlock a year/)).toBeInTheDocument();
  });
});

// #337: each year's Form 4562 figures, and the open year's estimate inputs. Every amount is invented.
describe('TaxYearsCard: Form 4562 figures', () => {
  const thisYear = new Date().getFullYear();
  const blank = {
    line_12: null, line_14: null, line_17: null, line_21: null, line_22: null,
    planned_179: null, planned_bonus: null, other_expected: null, estimate_convention: 'HY' as const,
  };
  const y2024: TaxYearDepreciation = {
    ...blank, year: 2024, line_12: 4000, line_22: 4214, updated_at: '2026-11-03T10:00:00Z', updated_by_name: 'Alex Admin',
    rows: [{ recovery_years: 7, basis: 6000, convention: 'MQ', method: '200DB', deduction: 214 }],
  };
  const y2025: TaxYearDepreciation = {
    ...blank, year: 2025, line_17: 1653, line_22: 2100, updated_at: null, updated_by_name: null,
    rows: [{ recovery_years: 7, basis: 3000, convention: 'HY', method: '200DB', deduction: 429 }],
  };
  const purchases = [{ date: '2024-11-15', cost: 10000, recoveryYears: 7 as const }];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTaxYears).mockResolvedValue([
      { organization_id: 'org-1', year: 2025, locked: true, filed_on: '2026-04-10', notes: null },
      { organization_id: 'org-1', year: 2024, locked: true, filed_on: '2025-04-10', notes: null },
    ]);
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([y2025, y2024]);
  });

  const row = (year: string) => screen.getByRole('row', { name: new RegExp(`^${year}`) });
  const open = async (year: number) => {
    await userEvent.click(within(await waitFor(() => row(String(year)))).getByRole('button', { name: 'Form 4562' }));
    return screen.getByRole('region', { name: `Form 4562 for ${year}` });
  };

  it("shows each year's line 22, or that nothing is entered", async () => {
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([y2024]);
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    await waitFor(() => expect(within(row('2024')).getByText('Line 22: $4,214')).toBeInTheDocument());
    expect(within(row('2025')).getByText('Not entered')).toBeInTheDocument();
  });

  it('lets an Admin enter a locked year\'s figures and line 19 rows, keeping its estimate inputs', async () => {
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([{ ...blank, year: 2025, planned_179: 500, updated_at: null, updated_by_name: null, rows: [] }]);
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    const form = await open(2025);
    expect(within(form).getByText(/This year is locked/)).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText(/Line 17/), '1653');
    await userEvent.click(within(form).getByRole('button', { name: 'Add a line 19 row' }));
    await userEvent.type(within(form).getByLabelText('Row 1 (c) basis'), '3000');
    await userEvent.selectOptions(within(form).getByLabelText('Row 1 (d) recovery period'), '5');
    await userEvent.type(within(form).getByLabelText('Row 1 (g) deduction'), '600');
    await userEvent.type(within(form).getByLabelText(/Line 22/), '2253');
    await userEvent.click(within(form).getByRole('button', { name: 'Save Form 4562 figures' }));
    await waitFor(() => expect(saveTaxYearDepreciation).toHaveBeenCalledWith('org-1', 2025,
      { ...blank, line_17: 1653, line_22: 2253, planned_179: 500 },
      [{ recovery_years: 5, basis: 3000, convention: 'HY', method: '200DB', deduction: 600 }]));
  });

  it('shows who saved the figures last, and when', async () => {
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    const form = await open(2024);
    expect(within(form).getByText(/Last saved by Alex Admin on Nov 3, 2026/)).toBeInTheDocument();
  });

  it('checks line 22 against the lines entered, and line 17 against the earlier years entered', async () => {
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    const form = await open(2025);
    expect(within(form).getByText(/come to \$2,082: line 22 includes \$18 from lines not entered here \(15, 16, 20\)/)).toBeInTheDocument();
    expect(within(form).getByText(/From the years entered here, line 17 comes to \$1,653, matching/)).toBeInTheDocument();
    await userEvent.clear(within(form).getByLabelText(/Line 17/));
    await userEvent.type(within(form).getByLabelText(/Line 17/), '2065');
    expect(within(form).getByText(/\$412 of line 17 isn't broken down by year/)).toBeInTheDocument();
  });

  it('names how a mid-quarter row\'s quarters are worked out', async () => {
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" purchases={purchases} />);
    const form = await open(2024);
    expect(within(form).getByText('Quarters from purchase dates: Q4 $6,000')).toBeInTheDocument();
  });

  it("suggests line 19 from the app's purchases, less Section 179, and fills a row with it", async () => {
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([{ ...y2024, rows: [] }]);
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" purchases={purchases} />);
    const form = await open(2024);
    expect(within(form).getByText('From GigWrangler: $10,000 of 7-year equipment bought in 2024, less Section 179 and bonus of $4,000 = $6,000')).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: "Use GigWrangler's 7-year values" }));
    expect(within(form).getByLabelText('Row 1 (c) basis')).toHaveValue('6000');
    expect(within(form).getByLabelText('Row 1 (g) deduction')).toHaveValue('857');
    await userEvent.clear(within(form).getByLabelText('Row 1 (c) basis'));
    await userEvent.type(within(form).getByLabelText('Row 1 (c) basis'), '5000');
    expect(within(form).getByText(/Your 7-year basis is \$1,000 less than GigWrangler's/)).toBeInTheDocument();
    expect(within(form).getByText(/business use under 100%/)).toBeInTheDocument();
  });

  it('refuses a negative amount or a row without a basis', async () => {
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([]);
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    const form = await open(2024);
    await userEvent.type(within(form).getByLabelText(/Line 12/), '-5');
    expect(within(form).getByText('Amounts must be 0 or more.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save Form 4562 figures' })).toBeDisabled();
    await userEvent.clear(within(form).getByLabelText(/Line 12/));
    await userEvent.click(within(form).getByRole('button', { name: 'Add a line 19 row' }));
    expect(within(form).getByText('Row 1 needs a basis, column (c).')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save Form 4562 figures' })).toBeDisabled();
  });

  // Coordinator's review of #342: figures without line 22 would be ignored by the Schedule C report.
  it('needs line 22 to save once any figure is filled in', async () => {
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([]);
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    const form = await open(2024);
    const save = () => within(form).getByRole('button', { name: 'Save Form 4562 figures' });
    await userEvent.type(within(form).getByLabelText(/Line 17/), '1653');
    expect(within(form).getByText('Line 22 is the total on your form; enter it to save.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/Line 22/), '1653');
    expect(within(form).queryByText(/Line 22 is the total on your form/)).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it('needs line 22 for line 19 rows too', async () => {
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([]);
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    const form = await open(2024);
    await userEvent.click(within(form).getByRole('button', { name: 'Add a line 19 row' }));
    await userEvent.type(within(form).getByLabelText('Row 1 (c) basis'), '3000');
    expect(within(form).getByText('Line 22 is the total on your form; enter it to save.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save Form 4562 figures' })).toBeDisabled();
  });

  it('lets an Admin save the open year\'s estimate inputs, keeping its rows', async () => {
    const open: TaxYearDepreciation = { ...blank, year: thisYear, updated_at: null, updated_by_name: null,
      rows: [{ recovery_years: 7, basis: 100, convention: 'HY', method: '200DB', deduction: null }] };
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([open]);
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    const est = await screen.findByRole('region', { name: `Estimate inputs for ${thisYear}` });
    await userEvent.type(within(est).getByLabelText('Planned Section 179'), '500');
    await userEvent.type(within(est).getByLabelText('Other depreciation you expect'), '300');
    await userEvent.selectOptions(within(est).getByLabelText(/Convention for this year's purchases/), 'MQ');
    await userEvent.click(within(est).getByRole('button', { name: 'Save estimate inputs' }));
    await waitFor(() => expect(saveTaxYearDepreciation).toHaveBeenCalledWith('org-1', thisYear,
      { ...blank, planned_179: 500, other_expected: 300, estimate_convention: 'MQ' }, open.rows));
  });

  it('tells the Schedule C report after saving figures or locking a year (#337 PR 3)', async () => {
    const onChanged = vi.fn();
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" onChanged={onChanged} />);
    const form = await open(2024);
    await userEvent.click(within(form).getByRole('button', { name: 'Save Form 4562 figures' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await userEvent.click(within(row('2025')).getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  });

  it('is read-only for Managers', async () => {
    render(<TaxYearsCard organizationId="org-1" userRole="Manager" />);
    const form = await open(2024);
    expect(within(form).getByLabelText(/Line 12/)).toBeDisabled();
    expect(within(form).queryByRole('button', { name: 'Save Form 4562 figures' })).not.toBeInTheDocument();
    expect(within(form).queryByRole('button', { name: 'Add a line 19 row' })).not.toBeInTheDocument();
    const est = screen.getByRole('region', { name: `Estimate inputs for ${thisYear}` });
    expect(within(est).getByLabelText('Planned Section 179')).toBeDisabled();
    expect(within(est).queryByRole('button', { name: 'Save estimate inputs' })).not.toBeInTheDocument();
  });
});

// A10 characterization: loading, a failed load, another organization, and fresh data after each save.
describe('TaxYearsCard: loading and refreshing (A10)', () => {
  const row = (year: string) => screen.getByRole('row', { name: new RegExp(`^${year}`) });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTaxYears).mockResolvedValue([
      { organization_id: 'org-1', year: 2024, locked: false, filed_on: null, notes: null },
    ]);
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([]);
    vi.mocked(saveTaxYear).mockResolvedValue({} as any);
    vi.mocked(saveTaxYearDepreciation).mockResolvedValue(undefined as any);
  });

  it('shows Loading…, then the years', async () => {
    let resolve!: (v: any) => void;
    vi.mocked(getTaxYears).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    resolve([{ organization_id: 'org-1', year: 2024, locked: false, filed_on: null, notes: null }]);
    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('says when the years fail to load, and loads them when opened again', async () => {
    vi.mocked(getTaxYears).mockRejectedValueOnce(new Error('Could not read'));
    vi.mocked(getTaxYearDepreciation).mockRejectedValueOnce(new Error('No figures'));
    const first = render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not read'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No figures'));
    expect(await screen.findByText('No years locked yet.')).toBeInTheDocument();
    // Opened again (a remount), against the same cache.
    first.rerender(<TaxYearsCard key="again" organizationId="org-1" userRole="Admin" />);
    expect(await screen.findByText('Open')).toBeInTheDocument();
  });

  it('switching organization shows that organization\'s years', async () => {
    vi.mocked(getTaxYears).mockImplementation(async (orgId: string) => [
      { organization_id: orgId, year: orgId === 'org-2' ? 2021 : 2024, locked: false, filed_on: null, notes: null },
    ]);
    const { rerender } = render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    await waitFor(() => expect(row('2024')).toBeInTheDocument());
    rerender(<TaxYearsCard organizationId="org-2" userRole="Admin" />);
    await waitFor(() => expect(row('2021')).toBeInTheDocument());
    expect(screen.queryByRole('row', { name: /^2024/ })).not.toBeInTheDocument();
    expect(getTaxYearDepreciation).toHaveBeenLastCalledWith('org-2');
  });

  it('after locking a year, the list shows it locked', async () => {
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    await waitFor(() => expect(row('2024')).toBeInTheDocument());
    vi.mocked(getTaxYears).mockResolvedValue([
      { organization_id: 'org-1', year: 2024, locked: true, filed_on: null, notes: null },
    ]);
    await userEvent.click(within(row('2024')).getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(within(row('2024')).getByText('Locked')).toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith('2024 locked');
  });

  it('after saving the figures, the list shows the new line 22', async () => {
    render(<TaxYearsCard organizationId="org-1" userRole="Admin" />);
    await waitFor(() => expect(row('2024')).toBeInTheDocument());
    expect(within(row('2024')).getByText('Not entered')).toBeInTheDocument();
    await userEvent.click(within(row('2024')).getByRole('button', { name: 'Form 4562' }));
    vi.mocked(getTaxYearDepreciation).mockResolvedValue([
      { organization_id: 'org-1', year: 2024, line_22: 1000, rows: [], updated_at: null, updated_by_name: null } as any,
    ]);
    const form = await screen.findByRole('region', { name: /Form 4562 for 2024/ });
    await userEvent.type(within(form).getByLabelText(/Line 22/), '1000');
    await userEvent.click(within(form).getByRole('button', { name: 'Save Form 4562 figures' }));
    await waitFor(() => expect(saveTaxYearDepreciation).toHaveBeenCalled());
    await waitFor(() => expect(within(row('2024')).getByText(/Line 22: \$1,000/)).toBeInTheDocument());
  });
});

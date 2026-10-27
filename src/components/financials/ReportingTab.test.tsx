import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportingTab from './ReportingTab';
import { getTaxReportData } from '../../services/taxReport.service';

const downloadCsv = vi.fn();
vi.mock('../../utils/taxReports', async (orig) => ({ ...(await orig<any>()), downloadCsv: (...a: any[]) => downloadCsv(...a) }));
// The purchase editor stands in for ReviewScannedDataDialog: it shows which purchase it edits, and saves.
vi.mock('../ReviewScannedDataDialog', () => ({
  default: (p: any) => p.open ? (
    <div role="dialog" aria-label="Edit purchase">
      {p.editPurchaseId}
      <button type="button" onClick={() => { p.onUpdated?.(p.editPurchaseId); p.onOpenChange(false); }}>Save Changes</button>
    </div>
  ) : null,
}));
vi.mock('../../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn(async () => new Set([2025])) }));

const asset = { id: 'a1', manufacturer_model: 'Midas M32', category: 'Audio', recovery_period: null, retired_on: null, liquidation_amt: null, status: 'Active' };
vi.mock('../../services/taxReport.service', () => ({
  getTaxReportData: vi.fn(async () => ({
    lines: [
      { id: 'p1', purchase_date: '2026-03-01', vendor: 'Sweetwater', description: 'Gaff tape', category: 'Supplies', quantity: 1, item_cost: 40, line_cost: 40,
        tax_treatment: 'expense', asset_id: null, parent: null, asset: null },
      { id: 'p2', purchase_date: '2026-03-02', vendor: 'Sweetwater', description: 'Console', category: 'Audio', quantity: 1, item_cost: 3200, line_cost: 3200,
        tax_treatment: 'depreciate', asset_id: 'a1', parent: null, asset },
      { id: 'p3', purchase_date: '2025-05-01', vendor: 'Amazon', description: 'Old cable', category: 'Supplies', quantity: 1, item_cost: 9, line_cost: 9,
        tax_treatment: 'expense', asset_id: null, parent: null, asset: null },
      { id: 'p4', purchase_date: '2026-06-01', vendor: 'Sweetwater', description: 'Wireless receiver', category: 'Audio', quantity: 1, item_cost: 900, line_cost: 900,
        tax_treatment: 'expense', asset_id: null, parent_id: 'h4', parent: null, asset: null },
      { id: 'p6', purchase_date: '2025-06-01', vendor: 'Sweetwater', description: 'Hazer', category: 'Lighting', quantity: 1, item_cost: 450, line_cost: 450,
        tax_treatment: 'depreciate', asset_id: null, parent_id: 'h6', parent: null, asset: null },
    ],
    gigRows: [
      { id: 'g1', gig_id: 'x', direction: 'in', stage: 'paid', amount_settled: 1500, paid_at: '2026-04-02', description: 'Balance', category: null,
        mileage: null, purchase_id: null, staff_assignment_id: null, external_entity_name: null, reference_number: 'INV-7',
        counterparty: { name: 'Hotel Del' }, gig: { title: 'Spring Gala', start: '2026-04-01' } },
    ],
    categories: [{ name: 'Supplies', schedule_c_line: '22' }],
    scheduleC: [{ code: '22', label: 'Supplies' }],
    equipmentCategories: ['Audio', 'Lighting'],
  })),
}));

const purchaseLine = (o: Record<string, unknown>) => ({ vendor: 'Sweetwater', quantity: 1, asset_id: null, parent: null, asset: null, ...o });
const gigOut = (o: Record<string, unknown>) => ({ gig_id: 'x', direction: 'out', stage: 'paid', description: 'Parking', mileage: null, purchase_id: null,
  staff_assignment_id: null, external_entity_name: 'City lot', reference_number: null, counterparty: null, gig: { title: 'Spring Gala', start: '2026-04-01' }, ...o });
/** Only these rows, with the default category lists (issue #194). */
const onlyRows = (lines: unknown[], gigRows: unknown[] = []) => vi.mocked(getTaxReportData).mockResolvedValueOnce({
  lines, gigRows, categories: [{ name: 'Supplies', schedule_c_line: '22' }], scheduleC: [{ code: '22', label: 'Supplies' }], equipmentCategories: ['Audio'],
} as any);

/** Any data, with Supplies (line 22) and Car and truck (line 9) on the lists. */
const withData = (d: { lines?: unknown[]; gigRows?: unknown[]; assets?: unknown[]; invoices?: unknown[] }) => vi.mocked(getTaxReportData).mockResolvedValueOnce({
  lines: [], gigRows: [], assets: [], invoices: [], ...d,
  categories: [{ name: 'Supplies', schedule_c_line: '22' }],
  scheduleC: [{ code: '9', label: 'Car and truck expenses' }, { code: '22', label: 'Supplies' }], equipmentCategories: ['Audio'],
} as any);

describe('ReportingTab (#125)', () => {
  beforeEach(() => vi.clearAllMocks());
  const year = String(new Date().getFullYear());

  const open = async (onEditAsset = vi.fn()) => {
    render(<ReportingTab organizationId="org-1" organizationName="Act4 Audio" onEditAsset={onEditAsset} />);
    await screen.findByRole('group', { name: 'Report' });
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Tax year' }), '2026');
    return onEditAsset;
  };

  it('offers every year with data, and this year', async () => {
    await open();
    const years = within(screen.getByRole('combobox', { name: 'Tax year' })).getAllByRole('option').map(o => o.textContent);
    expect(years).toEqual(expect.arrayContaining(['2026', '2025', year]));
  });

  it('shows income received in the year and downloads it as CSV', async () => {
    await open();
    const table = await screen.findByRole('table', { name: 'Income' });
    expect(within(table).getByText('Spring Gala')).toBeInTheDocument();
    expect(within(table).getByText('Hotel Del')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }));
    expect(downloadCsv).toHaveBeenCalledWith(expect.stringContaining('Spring Gala'), 'act4-audio-income-2026.csv');
  });

  it('shows expenses by Schedule C line, then every expense', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Expenses' }));
    expect(within(screen.getByRole('table', { name: 'Expenses by Schedule C line' })).getByText('Line 22: Supplies')).toBeInTheDocument();
    const all = screen.getByRole('table', { name: 'Expenses' });
    expect(within(all).getByText('Gaff tape')).toBeInTheDocument();
    expect(within(all).queryByText('Console')).not.toBeInTheDocument();
    expect(within(all).queryByText('Old cable')).not.toBeInTheDocument();
  });

  it('shows the year\'s depreciated equipment and asks for a missing recovery period', async () => {
    const onEditAsset = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Assets' }));
    expect(within(screen.getByRole('table', { name: 'Assets' })).getByText('Midas M32')).toBeInTheDocument();
    expect(screen.getByText('Need a recovery period')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose a recovery period: Midas M32' }));
    expect(onEditAsset).toHaveBeenCalledWith('a1');
    await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }));
    expect(downloadCsv).toHaveBeenCalledWith(expect.stringContaining('Midas M32'), 'act4-audio-assets-2026.csv');
  });

  describe('the Grey zone report', () => {
    it('lists equipment costing $200 to $2,500 each, with its treatment, and links to the purchase to change it', async () => {
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Grey zone' }));
      const table = screen.getByRole('table', { name: 'Grey zone' });
      const row = within(table).getByText('Wireless receiver').closest('tr')!;
      expect(within(row).getByText('Expense')).toBeInTheDocument();
      expect(within(table).queryByText('Console')).not.toBeInTheDocument();     // over $2,500
      expect(within(table).queryByText('Gaff tape')).not.toBeInTheDocument();   // under $200
      expect(within(table).queryByText('Hazer')).not.toBeInTheDocument();       // another year

      await userEvent.click(within(row).getByRole('button', { name: 'Change the treatment: Wireless receiver' }));
      const dialog = await screen.findByRole('dialog', { name: 'Edit purchase' });
      expect(dialog).toHaveTextContent('h4');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(getTaxReportData).toHaveBeenCalledTimes(2));   // reloaded after the save
    });

    it('is read-only in a filed year', async () => {
      await open();
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tax year' }), '2025');
      await userEvent.click(screen.getByRole('button', { name: 'Grey zone' }));
      const row = within(screen.getByRole('table', { name: 'Grey zone' })).getByText('Hazer').closest('tr')!;
      expect(within(row).getByText('Depreciate')).toBeInTheDocument();
      expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    });

    it('downloads as CSV', async () => {
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Grey zone' }));
      await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }));
      expect(downloadCsv).toHaveBeenCalledWith(expect.stringContaining('Wireless receiver'), 'act4-audio-grey-zone-2026.csv');
    });

    it('says so when there is nothing in the grey zone', async () => {
      onlyRows([]);
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Grey zone' }));
      expect(screen.getByText('No equipment costing $200 to $2,500 each was bought in 2026.')).toBeInTheDocument();
    });
  });

  it('marks a filed year', async () => {
    await open();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tax year' }), '2025');
    expect(screen.getByText('2025 is filed')).toBeInTheDocument();
  });

  it('offers a year whose only activity is a disposal, and shows it there (issue #194)', async () => {
    onlyRows([purchaseLine({ id: 'p9', purchase_date: '2019-06-01', description: 'Old amp', category: 'Audio', item_cost: 900, line_cost: 900,
      tax_treatment: 'depreciate', asset_id: 'a9',
      asset: { ...asset, id: 'a9', manufacturer_model: 'Crown XLS', retired_on: '2023-08-15', liquidation_amt: 200, status: 'Sold' } })]);
    render(<ReportingTab organizationId="org-1" organizationName="Act4 Audio" />);
    await screen.findByRole('group', { name: 'Report' });
    const select = await screen.findByRole('combobox', { name: 'Tax year' });
    await within(select).findByRole('option', { name: '2019' });
    expect(within(select).getAllByRole('option').map(o => o.textContent)).toContain('2023');
    await userEvent.selectOptions(select, '2023');
    await userEvent.click(screen.getByRole('button', { name: 'Assets' }));
    expect(screen.getByText('Disposed of in 2023')).toBeInTheDocument();
    expect(screen.getByText('Crown XLS')).toBeInTheDocument();
  });

  describe('the Schedule C summary', () => {
    it('shows receipts, expenses by line with line 9 mileage, the totals and the net, and downloads it', async () => {
      withData({
        lines: [purchaseLine({ id: 'p1', purchase_date: '2026-03-01', description: 'Gaff tape', category: 'Supplies', item_cost: 40, line_cost: 40, tax_treatment: 'expense' })],
        gigRows: [
          { ...gigOut({ id: 'in1', amount_settled: 1500, paid_at: '2026-04-02' }), direction: 'in' },
          gigOut({ id: 'm1', category: 'Car and truck expenses', description: 'Mileage', mileage: 100, date: '2026-07-01', amount_settled: 76, paid_at: '2026-07-02' }),
        ],
      });
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Schedule C' }));
      const table = screen.getByRole('table', { name: 'Schedule C summary' });
      const row = (label: string) => within(table).getByText(label).closest('tr')!;
      expect(row('Gross receipts')).toHaveTextContent('$1,500.00');
      expect(row('Line 9: Car and truck expenses')).toHaveTextContent('100 mi');
      expect(row('Line 9: Car and truck expenses')).toHaveTextContent('$76.00');
      expect(row('Line 22: Supplies')).toHaveTextContent('$40.00');
      expect(row('Total expenses')).toHaveTextContent('$116.00');
      expect(row('Net (before depreciation)')).toHaveTextContent('$1,384.00');
      expect(screen.getByText('Depreciation and Section 179 are worked out by your tax program from the Assets report.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }));
      expect(downloadCsv).toHaveBeenCalledWith(expect.stringContaining('Net (before depreciation)'), 'act4-audio-schedule-c-2026.csv');
    });

    it('shows the no-category row only when there is one', async () => {
      withData({ lines: [purchaseLine({ id: 'p5', purchase_date: '2026-03-05', description: 'Strings', category: 'Gear', item_cost: 12, line_cost: 12, tax_treatment: 'expense' })] });
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Schedule C' }));
      expect(screen.getByText('No category (no Schedule C line)').closest('tr')).toHaveTextContent('$12.00');
    });
  });

  describe('cost of goods sold, line 4 (#321)', () => {
    const withResale = () => vi.mocked(getTaxReportData).mockResolvedValueOnce({
      lines: [
        purchaseLine({ id: 'p1', purchase_date: '2026-03-01', description: 'Gaff tape', category: 'Supplies', item_cost: 40, line_cost: 40, tax_treatment: 'expense' }),
        purchaseLine({ id: 'r1', purchase_date: '2026-05-12', description: 'Heads for resale', category: 'Cost of goods sold (resale)', item_cost: 60, line_cost: 600, quantity: 10, tax_treatment: 'expense' }),
      ],
      gigRows: [{ ...gigOut({ id: 'in1', amount_settled: 1500, paid_at: '2026-04-02' }), direction: 'in' }],
      assets: [], invoices: [],
      categories: [{ name: 'Supplies', schedule_c_line: '22' }, { name: 'Cost of goods sold (resale)', schedule_c_line: '4' }],
      scheduleC: [{ code: '4', label: 'Cost of goods sold (Part III)' }, { code: '22', label: 'Supplies' }], equipmentCategories: ['Audio'],
    } as any);

    it('the Expenses report shows it apart, outside the Part II total', async () => {
      withResale();
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Expenses' }));
      expect(screen.getByText('Expenses in 2026').parentElement).toHaveTextContent('$40.00');
      expect(screen.getByText('Cost of goods sold', { selector: 'p' }).parentElement).toHaveTextContent('$600.00');
      const cogs = screen.getByRole('table', { name: 'Cost of goods sold' });
      expect(within(cogs).getByText('Cost of goods sold (resale)').closest('tr')).toHaveTextContent('$600.00');
      const partII = screen.getByRole('table', { name: 'Expenses by Schedule C line' });
      expect(within(partII).queryByText(/Line 4/)).not.toBeInTheDocument();
      expect(within(partII).getAllByText('Total').at(-1)!.closest('tr')).toHaveTextContent('$40.00');  // the footer row
      expect(within(screen.getByRole('table', { name: 'Expenses' })).getByText('Heads for resale')).toBeInTheDocument();
    });

    it('the Schedule C summary takes it off receipts as gross profit, then the expenses', async () => {
      withResale();
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Schedule C' }));
      const table = screen.getByRole('table', { name: 'Schedule C summary' });
      const row = (label: string) => within(table).getByText(label).closest('tr')!;
      expect(row('Gross receipts')).toHaveTextContent('$1,500.00');
      expect(row('Line 4: Cost of goods sold (Part III)')).toHaveTextContent('$600.00');
      expect(row('Gross profit')).toHaveTextContent('$900.00');
      expect(row('Total expenses')).toHaveTextContent('$40.00');
      expect(row('Net (before depreciation)')).toHaveTextContent('$860.00');
    });

    it('the Expenses report has no cost of goods sold section when nothing is on line 4', async () => {
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Expenses' }));
      expect(screen.queryByRole('table', { name: 'Cost of goods sold' })).not.toBeInTheDocument();
      expect(screen.queryByText('Cost of goods sold')).not.toBeInTheDocument();
    });
  });

  describe('Needs attention', () => {
    const problems = () => withData({
      lines: [purchaseLine({ id: 'p5', parent_id: 'h1', purchase_date: '2026-03-05', description: 'Strings', category: 'Gear', item_cost: 12, line_cost: 12, tax_treatment: 'expense' })],
      invoices: [{ id: 'h1', purchase_date: '2026-03-05', vendor: 'Sweetwater', description: null, total_inv_amount: 12 }],
      assets: [{ id: 'a9', manufacturer_model: 'Crown XLS', description: null, category: 'Audio', acquisition_date: '2019-06-01', item_cost: 900,
        status: 'Disposed', retired_on: null, recovery_period: 7, purchase_line_id: null }],
    });

    it('groups what needs fixing, with counts and links to fix it, and downloads it', async () => {
      problems();
      const onEditAsset = await open();
      await userEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
      const noCategory = screen.getByRole('table', { name: 'Expensed with no expense category' });
      expect(screen.getByRole('heading', { name: /Expensed with no expense category/ })).toHaveTextContent('1');
      expect(within(noCategory).getByText('Strings (Sweetwater)')).toBeInTheDocument();
      const disposed = screen.getByRole('table', { name: 'Disposed or returned with no date disposed' });
      expect(within(disposed).getByText('Crown XLS')).toBeInTheDocument();
      await userEvent.click(within(disposed).getByRole('button', { name: 'Edit the equipment: Crown XLS' }));
      expect(onEditAsset).toHaveBeenCalledWith('a9');

      await userEvent.click(within(noCategory).getByRole('button', { name: 'Edit the purchase: Strings (Sweetwater)' }));
      expect(await screen.findByRole('dialog', { name: 'Edit purchase' })).toHaveTextContent('h1');

      await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }));
      expect(downloadCsv).toHaveBeenCalledWith(expect.stringContaining('Strings (Sweetwater)'), 'act4-audio-needs-attention-2026.csv');
    });

    it('says so when nothing needs attention', async () => {
      withData({});
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
      expect(screen.getByText('Nothing needs attention for 2026.')).toBeInTheDocument();
    });

    it('doesn\'t offer to edit a purchase in a filed year', async () => {
      withData({ lines: [purchaseLine({ id: 'p7', parent_id: 'h7', purchase_date: '2025-03-05', description: 'Picks', category: 'Gear', item_cost: 5, line_cost: 5, tax_treatment: 'expense' })] });
      await open();
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tax year' }), '2025');
      await userEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
      const row = within(screen.getByRole('table', { name: 'Expensed with no expense category' })).getByText('Picks (Sweetwater)').closest('tr')!;
      expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('the "Need a category" hint says where to choose one (issue #194)', () => {
    const unlistedPurchase = purchaseLine({ id: 'p5', purchase_date: '2026-03-05', description: 'Strings', category: 'Gear', item_cost: 12, line_cost: 12, tax_treatment: 'expense' });
    const uncategorizedGigCost = gigOut({ id: 'g5', amount_settled: 20, paid_at: '2026-04-02', category: null });
    const hint = async () => {
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Expenses' }));
      return screen.getByRole('status').textContent ?? '';
    };

    it('a purchase: edit the purchase', async () => {
      onlyRows([unlistedPurchase]);
      const text = await hint();
      expect(text).toMatch(/Edit the purchase to choose one\./);
      expect(text).not.toMatch(/Financials tab/);
    });

    it('a gig cost that didn\'t come from a purchase: the gig\'s Financials tab', async () => {
      onlyRows([], [uncategorizedGigCost]);
      const text = await hint();
      expect(text).toMatch(/1 item has no category, or one that isn’t on your expense list/);
      expect(text).toMatch(/Choose one on the gig’s Financials tab\./);
      expect(text).not.toMatch(/Edit the purchase/);
    });

    it('both: each is counted with its own fix', async () => {
      onlyRows([unlistedPurchase], [uncategorizedGigCost, gigOut({ id: 'g6', amount_settled: 5, paid_at: '2026-05-02', category: null })]);
      const text = await hint();
      expect(text).toMatch(/3 items have no category/);
      expect(text).toMatch(/1 from a purchase: edit the purchase\./);
      expect(text).toMatch(/2 from gigs: choose one on the gig’s Financials tab\./);
    });
  });
});

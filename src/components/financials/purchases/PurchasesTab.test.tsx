import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { render } from '../testRender';
import PurchasesTab from './PurchasesTab';
import { getLinkedGigExpenses, getPurchases, trackPurchaseLineAsEquipment, deletePurchase, setPurchaseLineGig, createLedgerEntryForPurchaseLine } from '../../../services/purchase.service';
import { getPurchaseIdsWithLedgerEntry } from '../../../services/gig.service';
import { toast } from 'sonner';
import { presetRange } from './purchaseFilters';

const recent = presetRange('last-30').to; // today
const old = '2024-02-10';

const rows = [
  { id: 'h1', row_type: 'header', vendor: 'Sweetwater', purchase_date: recent, total_inv_amount: 120 },
  { id: 'i1', row_type: 'item', parent_id: 'h1', vendor: 'Sweetwater', purchase_date: recent, line_cost: 120, description: 'Cables' },
  { id: 'h2', row_type: 'header', vendor: 'Guitar Center', purchase_date: old, total_inv_amount: 900 },
  { id: 'i2', row_type: 'asset', tax_treatment: 'depreciate', parent_id: 'h2', vendor: 'Guitar Center', purchase_date: old, line_cost: 900, asset_id: 'a1', description: 'Mixer' },
  { id: 'h3', row_type: 'header', vendor: 'Amazon', purchase_date: old, total_inv_amount: 0 },
  { id: 'i3', row_type: 'asset', tax_treatment: 'expense', parent_id: 'h3', vendor: 'Amazon', purchase_date: old, line_cost: 0, asset_id: 'a3', description: 'Mic stand' },
];

vi.mock('../../../services/purchase.service', () => ({
  getPurchases: vi.fn(async () => rows),
  trackPurchaseLineAsEquipment: vi.fn(async () => 'a-new'),
  scanInvoice: vi.fn(),
  deletePurchase: vi.fn(),
  setPurchaseLineGig: vi.fn(),
  createLedgerEntryForPurchaseLine: vi.fn(),
  purchaseLineLedgerAmount: vi.fn(),
  getLinkedGigExpenses: vi.fn(async () => ({ entries: 0, gigs: 0, amount: 0 })),
}));
vi.mock('../../../services/attachment.service', () => ({
  getEntityAttachments: vi.fn(async () => []),
  uploadAttachment: vi.fn(),
  linkAttachmentToEntity: vi.fn(),
}));
vi.mock('../../../services/gig.service', () => ({
  getGigOptionsForOrganization: vi.fn(async () => []),
  getGigFinancialsByPurchaseId: vi.fn(async () => []),
  getPurchaseIdsWithLedgerEntry: vi.fn(async () => new Set()),
}));
vi.mock('./PurchaseDetailPanel', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock('../../ReviewScannedDataDialog', () => ({ default: () => null }));

const props = {
  organization: { id: 'org-1', name: 'Act4Audio' } as any,
  user: { id: 'u1' } as any,
  userRole: 'Admin' as const,
};

const totals = () => screen.getByTestId('purchase-totals');

describe('Purchases report (10-01)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens on the last 30 days, with filtered and all-time totals', async () => {
    render(<PurchasesTab {...props} />);
    await waitFor(() => expect(screen.getByText('Sweetwater')).toBeInTheDocument());
    expect(screen.queryByText('Guitar Center')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(totals()).getByText('$120.00')).toBeInTheDocument();
    const allTime = screen.getByTestId('purchase-totals-all-time');
    expect(within(allTime).getByText('$1,020.00')).toBeInTheDocument();
    expect(within(allTime).getByText('1 depreciated · 2 expensed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear all filters/i })).not.toBeInTheDocument();
  });

  it('switches period with a preset, and Clear all filters goes back to the last 30 days', async () => {
    render(<PurchasesTab {...props} />);
    await waitFor(() => expect(screen.getByText('Sweetwater')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(screen.getByText('Guitar Center')).toBeInTheDocument();
    expect(within(totals()).getAllByText('$1,020.00').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText('Search vendor...'), { target: { value: 'guitar' } });
    expect(screen.queryByText('Sweetwater')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    expect(screen.getByPlaceholderText('Search vendor...')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Sweetwater')).toBeInTheDocument();
    expect(screen.queryByText('Guitar Center')).not.toBeInTheDocument();
  });

  it('typing a date by hand clears the preset', async () => {
    render(<PurchasesTab {...props} />);
    await waitFor(() => expect(screen.getByText('Sweetwater')).toBeInTheDocument());
    const [from] = screen.getAllByDisplayValue(presetRange('last-30').from);
    fireEvent.change(from, { target: { value: '2024-01-01' } });
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Guitar Center')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear all filters/i })).toBeInTheDocument();
  });

  it('offers to show all time when nothing falls in the period', async () => {
    const { getPurchases } = await import('../../../services/purchase.service');
    vi.mocked(getPurchases).mockResolvedValueOnce(rows.slice(2) as any);
    render(<PurchasesTab {...props} />);
    await waitFor(() => expect(screen.getByText('No purchases found')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Show all time' }));
    expect(screen.getByText('Guitar Center')).toBeInTheDocument();
  });
});

// #133: tax treatment and equipment are separate on each line.
describe('Purchases report: tax treatment and equipment (#133)', () => {
  beforeEach(() => vi.clearAllMocks());

  const open = async (description: string) => {
    render(<PurchasesTab {...props} />);
    await waitFor(() => expect(screen.getByText('Sweetwater')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    fireEvent.click(screen.getByText(description));
    return screen.getByText(description).closest('tr')!;
  };

  it('shows each line\'s tax treatment, and marks equipment with an icon in its own column', async () => {
    const row = await open('Mic stand');
    expect(within(row).getByText('Expense')).toBeInTheDocument();
    const cells = within(row).getAllByRole('cell');
    const headers = within(row.closest('table')!).getAllByRole('columnheader').map(h => h.textContent);
    expect(headers.slice(0, 3)).toEqual(['Type', 'Description / Model', 'Equipment']);
    expect(within(cells[2]).getByRole('img', { name: 'Tracked as equipment' })).toBeInTheDocument();
    expect(within(cells[0]).queryByText('Equipment')).not.toBeInTheDocument();
    const mixer = screen.getByText('Mixer').closest('tr')!;
    expect(within(mixer).getByText('Depreciate')).toBeInTheDocument();
  });

  it('a long description is cut short, with the full text on hover, so it can\'t push the other columns', async () => {
    const row = await open('Mic stand');
    const cell = within(row).getAllByRole('cell')[1];
    expect(cell).toHaveClass('truncate');
    expect(cell).toHaveAttribute('title', 'Mic stand');
    expect(row.closest('table')).toHaveClass('table-fixed');
  });

  it('offers Track as equipment, not Reclassify as Asset, on an untracked expense line', async () => {
    const svc = await import('../../../services/purchase.service');
    await open('Cables');
    expect(screen.queryByRole('button', { name: /Reclassify as Asset/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Track as equipment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Track it' }));
    await waitFor(() => expect(svc.trackPurchaseLineAsEquipment).toHaveBeenCalledWith('i1'));
  });

  it('a depreciated line can\'t be assigned to a gig', async () => {
    await open('Mixer');
    expect(screen.queryByText('Assign Gig:')).not.toBeInTheDocument();
    expect(screen.getByText(/Depreciated items aren't gig expenses/)).toBeInTheDocument();
  });

  it('an expensed line can be assigned to a gig even when it is equipment', async () => {
    await open('Mic stand');
    expect(screen.getByText('Assign Gig:')).toBeInTheDocument();
  });

  it('filters by tax treatment and by equipment', async () => {
    render(<PurchasesTab {...props} />);
    await waitFor(() => expect(screen.getByText('Sweetwater')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(screen.getByRole('combobox', { name: 'Type' })).toBeInTheDocument();
  });
});

// #133 step 3: gig links live on lines; a purchase itself is never assigned to a gig.
describe('Purchases report: gig links are on lines (#133 step 3)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has no purchase-level "Assign receipt to gig" pulldown', async () => {
    render(<PurchasesTab {...props} />);
    await waitFor(() => expect(screen.getByText('Sweetwater')).toBeInTheDocument());
    expect(screen.queryByText('Assign receipt to gig…')).not.toBeInTheDocument();
  });

  it('opening a gig money row that points at a line shows that line\'s whole purchase', async () => {
    render(<PurchasesTab {...props} highlightPurchaseId="i3" />);
    await waitFor(() => expect(screen.getByText('Mic stand')).toBeInTheDocument());
    expect(screen.getByText('Amazon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit purchase' })).toBeInTheDocument();
    expect(screen.queryByText('Guitar Center')).not.toBeInTheDocument();
  });
});

describe('Deleting a purchase removes its gig expenses (B2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says how much expense, from how many gigs, goes with a whole purchase', async () => {
    vi.mocked(getLinkedGigExpenses).mockResolvedValueOnce({ entries: 2, gigs: 1, amount: 120 });
    render(<PurchasesTab {...props} />);
    await waitFor(() => expect(screen.getByText('Sweetwater')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Delete purchase'));
    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByText('This also removes $120.00 of expenses from 1 gig.')).toBeInTheDocument();
    expect(getLinkedGigExpenses).toHaveBeenCalledWith(['h1', 'i1']);
    expect(within(dialog).queryByText(/will not be automatically deleted/)).not.toBeInTheDocument();
  });

  it('says nothing about gigs when no gig expense is linked', async () => {
    render(<PurchasesTab {...props} />);
    await waitFor(() => expect(screen.getByText('Sweetwater')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Delete purchase'));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(getLinkedGigExpenses).toHaveBeenCalled());
    expect(within(dialog).queryByText(/This also removes/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/will not be automatically deleted/)).not.toBeInTheDocument();
  });
});

// B21: the tab changes a line's gig in one call (setPurchaseLineGig), never as a purchase update
// followed by separate gig-expense moves or deletes.
describe('PurchasesTab: a line\'s gig changes in one call (B21)', () => {
  it('uses setPurchaseLineGig, not a gig_id update plus ledger steps', async () => {
    const { readFileSync } = await import('node:fs');
    // The write moved into the screen's data hook (A10); the screen calls it through the hook.
    const source = ['PurchasesTab.tsx', 'usePurchasesData.ts']
      .map((f) => readFileSync(`src/components/financials/purchases/${f}`, 'utf8')).join('\n');
    expect(source).toContain('setPurchaseLineGig(');
    expect(source).not.toMatch(/updatePurchase\([^)]*gig_id/);
    expect(source).not.toMatch(/reconcileLedgerForLineGigChange|removeLedgerEntriesForPurchaseLine/);
  });
});

// A10 characterization: how the report loads, fails, follows the organization and refreshes after
// each write. These pass before and after the move to TanStack Query.
describe('Purchases report: loading and refreshing (A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPurchases).mockImplementation(async () => rows as any);
  });

  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  it('shows a spinner, then the purchases', async () => {
    const load = deferred<any>();
    vi.mocked(getPurchases).mockReturnValueOnce(load.promise);
    render(<PurchasesTab {...props} />);
    expect(screen.getByText('Loading purchases...')).toBeInTheDocument();
    load.resolve(rows);
    expect(await screen.findByText('Sweetwater')).toBeInTheDocument();
    expect(screen.queryByText('Loading purchases...')).not.toBeInTheDocument();
    expect(getPurchases).toHaveBeenCalledWith('org-1');
  });

  it('says when the purchases fail to load, and loads them when opened again', async () => {
    vi.mocked(getPurchases).mockRejectedValueOnce(new Error('offline'));
    const first = render(<PurchasesTab {...props} />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load purchases'));
    expect(screen.queryByText('Sweetwater')).not.toBeInTheDocument();
    first.unmount();
    render(<PurchasesTab {...props} />, { queryClient: first.queryClient });
    expect(await screen.findByText('Sweetwater')).toBeInTheDocument();
  });

  it('switching organization shows the new organization\'s purchases', async () => {
    const recentRow = (id: string, vendor: string) => [
      { id: `h-${id}`, row_type: 'header', vendor, purchase_date: recent, total_inv_amount: 10 },
      { id: `i-${id}`, row_type: 'item', parent_id: `h-${id}`, vendor, purchase_date: recent, line_cost: 10, description: 'Tape' },
    ];
    vi.mocked(getPurchases).mockImplementation(async (orgId: string) =>
      (orgId === 'org-2' ? recentRow('2', 'Second Vendor') : recentRow('1', 'First Vendor')) as any);
    const { rerender } = render(<PurchasesTab {...props} />);
    expect(await screen.findByText('First Vendor')).toBeInTheDocument();
    rerender(<PurchasesTab {...props} organization={{ id: 'org-2', name: 'Other' } as any} />);
    expect(await screen.findByText('Second Vendor')).toBeInTheDocument();
    expect(screen.queryByText('First Vendor')).not.toBeInTheDocument();
    expect(getPurchases).toHaveBeenLastCalledWith('org-2');
  });

  it('a late answer for the earlier organization never replaces the new one (B12)', async () => {
    const slow = deferred<any>();
    vi.mocked(getPurchases).mockImplementation(async (orgId: string) =>
      orgId === 'org-1' ? slow.promise : ([
        { id: 'h-2', row_type: 'header', vendor: 'Second Vendor', purchase_date: recent, total_inv_amount: 10 },
        { id: 'i-2', row_type: 'item', parent_id: 'h-2', vendor: 'Second Vendor', purchase_date: recent, line_cost: 10 },
      ] as any));
    const { rerender } = render(<PurchasesTab {...props} />);
    rerender(<PurchasesTab {...props} organization={{ id: 'org-2', name: 'Other' } as any} />);
    expect(await screen.findByText('Second Vendor')).toBeInTheDocument();
    slow.resolve(rows);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Second Vendor')).toBeInTheDocument();
    expect(screen.queryByText('Sweetwater')).not.toBeInTheDocument();
  });

  it('tracking a line as equipment shows the line as equipment', async () => {
    render(<PurchasesTab {...props} />);
    fireEvent.click(await screen.findByText('Cables'));
    const tracked = rows.map((r) => (r.id === 'i1' ? { ...r, asset_id: 'a-new' } : r));
    vi.mocked(getPurchases).mockImplementation(async () => tracked as any);
    fireEvent.click(screen.getByRole('button', { name: /Track as equipment/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Track it' }));
    await waitFor(() => expect(trackPurchaseLineAsEquipment).toHaveBeenCalledWith('i1'));
    const row = (await screen.findByText('Cables')).closest('tr')!;
    expect(await within(row).findByRole('img', { name: 'Tracked as equipment' })).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Now tracked as equipment');
  });

  it('deleting a purchase takes it off the report', async () => {
    vi.mocked(deletePurchase).mockResolvedValueOnce(undefined as any);
    render(<PurchasesTab {...props} />);
    await screen.findByText('Sweetwater');
    vi.mocked(getPurchases).mockImplementation(async () => rows.filter((r) => r.id !== 'h1' && r.parent_id !== 'h1') as any);
    fireEvent.click(screen.getByTitle('Delete purchase'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deletePurchase).toHaveBeenCalledWith('h1'));
    await waitFor(() => expect(screen.queryByText('Sweetwater')).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith('Purchase deleted');
  });

  it('assigning a line to a gig, then adding it to the ledger, shows the line in the ledger', async () => {
    const withGig = rows.map((r) => (r.id === 'i1' ? { ...r, gig_id: 'g1' } : r));
    vi.mocked(getPurchases).mockImplementation(async () => withGig as any);
    const events: Event[] = [];
    const listen = (e: Event) => events.push(e);
    window.addEventListener('gig-financials-updated', listen);
    vi.mocked(createLedgerEntryForPurchaseLine).mockResolvedValueOnce({ created: true } as any);
    render(<PurchasesTab {...props} />);
    fireEvent.click(await screen.findByText('Cables'));
    const add = await screen.findByRole('button', { name: /Add to gig ledger/ });
    vi.mocked(getPurchaseIdsWithLedgerEntry).mockResolvedValue(new Set(['i1']));
    const calls = vi.mocked(getPurchases).mock.calls.length;
    fireEvent.click(add);
    await waitFor(() => expect(createLedgerEntryForPurchaseLine).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }), 'g1', 'org-1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Add to gig ledger/ })).not.toBeInTheDocument());
    expect(vi.mocked(getPurchases).mock.calls.length).toBeGreaterThan(calls);
    expect(toast.success).toHaveBeenCalledWith('Added to the gig ledger');
    expect(events).toHaveLength(1);
    window.removeEventListener('gig-financials-updated', listen);
    vi.mocked(getPurchaseIdsWithLedgerEntry).mockResolvedValue(new Set());
  });

  it('a failed gig change still reloads the report', async () => {
    vi.mocked(setPurchaseLineGig).mockRejectedValueOnce(new Error('Nope'));
    const withGig = rows.map((r) => (r.id === 'i1' ? { ...r, gig_id: 'g1' } : r));
    vi.mocked(getPurchases).mockImplementation(async () => withGig as any);
    render(<PurchasesTab {...props} />);
    fireEvent.click(await screen.findByText('Cables'));
    const calls = vi.mocked(getPurchases).mock.calls.length;
    // Clearing the gig of a line with no ledger rows goes straight to the save.
    fireEvent.click(await screen.findByTitle('Clear gig'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nope'));
    await waitFor(() => expect(vi.mocked(getPurchases).mock.calls.length).toBeGreaterThan(calls));
  });
});

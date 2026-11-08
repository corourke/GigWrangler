import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import PurchasesTab from './PurchasesTab';
import { getLinkedGigExpenses } from '../../../services/purchase.service';
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
  updatePurchase: vi.fn(),
  reconcileLedgerForLineGigChange: vi.fn(),
  createLedgerEntryForPurchaseLine: vi.fn(),
  removeLedgerEntriesForPurchaseLine: vi.fn(),
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
    const source = readFileSync('src/components/financials/purchases/PurchasesTab.tsx', 'utf8');
    expect(source).toContain('setPurchaseLineGig(');
    expect(source).not.toMatch(/updatePurchase\([^)]*gig_id/);
    expect(source).not.toMatch(/reconcileLedgerForLineGigChange|removeLedgerEntriesForPurchaseLine/);
  });
});

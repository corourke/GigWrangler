import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewScannedDataDialog from './ReviewScannedDataDialog';
import { createPurchaseWithUnits } from '../services/purchase.service';
import { linkAttachmentToEntity, uploadAttachment } from '../services/attachment.service';

vi.mock('../services/purchase.service', () => ({
  createPurchaseWithUnits: vi.fn(async () => ({ id: 'p-new', line_ids: [], unit_ids: [] })),
  addLineUnits: vi.fn(async () => ['unit-new']),
  getPurchaseWithDetails: vi.fn(),
  updatePurchase: vi.fn(),
  createPurchase: vi.fn(),
  deletePurchase: vi.fn(),
  computeAssetFieldChanges: vi.fn(() => []),
  trackPurchaseLineAsEquipment: vi.fn(async () => 'asset-new'),
  createLedgerEntryForPurchaseLine: vi.fn(async () => ({ created: true, financial: {} })),
}));
vi.mock('../services/equipmentItem.service', () => ({
  getItems: vi.fn(async () => [{ id: 'item-k12', manufacturer_model: 'QSC K12.2', category: 'Audio', type: 'Speaker, Powered', records: [] }]),
}));
vi.mock('../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn(async () => new Set<number>()) }));
vi.mock('../services/gig.service', () => ({ createGigFinancial: vi.fn(), getGigFinancials: vi.fn(async () => []), updateGigFinancial: vi.fn() }));
vi.mock('../services/attachment.service', () => ({
  uploadAttachment: vi.fn(async () => ({ id: 'att-uploaded' })),
  linkAttachmentToEntity: vi.fn(async () => ({})),
  getAttachmentUrl: vi.fn(),
}));
vi.mock('../services/asset.service', () => ({ updateAsset: vi.fn(), deleteAsset: vi.fn() }));
vi.mock('../services/purchaseCategory.service', () => ({
  getTypeUsage: vi.fn(async () => [{ type: 'Cable, XLR', count: 7 }]),
  getExpenseCategories: vi.fn(async () => ['Small audio parts', 'Small lighting parts', 'Supplies', 'Software subscriptions'].map(name => ({ name, schedule_c_line: '27b' }))),
  getEquipmentCategories: vi.fn(async () => ['Audio', 'Lighting', 'Misc']),
  // Audio and Lighting imply 7 years; Misc has no default, so it is asked (#125).
  getEquipmentCategoryPeriods: vi.fn(async () => ({ audio: 7, lighting: 7, misc: null })),
}));

// The Equipment details pop-up, opened from a line's chip.
const chip = (desc: string) => screen.getByRole('button', { name: `Equipment details: ${desc}` });
async function setEquipment(desc: string, fields: { category?: string; newCategory?: string; type?: string; period?: string; tags?: string[] }) {
  await userEvent.click(chip(desc));
  const dialog = within(await screen.findByRole('dialog', { name: 'Equipment details' }));
  if (fields.category) await userEvent.selectOptions(dialog.getByLabelText(/^Category/), fields.category);
  if (fields.newCategory) {
    await userEvent.selectOptions(dialog.getByLabelText(/^Category/), 'Add new category…');
    await userEvent.type(dialog.getByLabelText(/^Category/), fields.newCategory);
  }
  if (fields.type) await userEvent.type(dialog.getByRole('combobox', { name: 'Type' }), fields.type);
  if (fields.tags) {
    await userEvent.click(dialog.getByRole('radio', { name: /^Unit/ }));
    for (const [i, tag] of fields.tags.entries()) {
      await userEvent.type(dialog.getByLabelText(fields.tags.length > 1 ? `Inventory tag, unit ${i + 1}` : 'Inventory tag'), tag);
    }
  }
  if (fields.period) await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Recovery period' }), fields.period);
  await userEvent.click(dialog.getByRole('button', { name: 'Done' }));
}

const scanned = {
  vendor: 'Amazon',
  purchase_date: '2026-07-05',
  total_inv_amount: 25,
  items: [{ description: 'Gaffer tape', quantity: 1, item_price: 25, item_cost: 25, category: 'Supplies', is_asset: false }],
};

describe('ReviewScannedDataDialog in a page (Scan invoices, 10-02)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saving a queued invoice links its file and reports success, without "cancelling" (which discards the invoice)', async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    render(
      <ReviewScannedDataDialog
        layout="page" open cancelLabel="Discard"
        onOpenChange={onOpenChange} onSuccess={onSuccess}
        organizationId="org-1" scannedData={scanned as any} file={null} attachmentId="att-queued"
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save Purchase' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('p-new'));
    expect(createPurchaseWithUnits).toHaveBeenCalled();
    expect(linkAttachmentToEntity).toHaveBeenCalledWith('att-queued', 'purchase', 'p-new');
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('still closes as a dialog after saving', async () => {
    const onOpenChange = vi.fn();
    render(
      <ReviewScannedDataDialog
        open onOpenChange={onOpenChange} onSuccess={vi.fn()}
        organizationId="org-1" scannedData={scanned as any} file={null}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save Purchase' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe('ReviewScannedDataDialog: $0 invoice total (#226)', () => {
  beforeEach(() => vi.clearAllMocks());
  const renderWith = (data: any) => render(
    <ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" scannedData={data} file={null} />,
  );

  it('blocks Save when the total is $0 but the lines add up, and "Use $25.00" fixes it', async () => {
    renderWith({ ...scanned, total_inv_amount: 0 });
    expect(await screen.findByText('Enter the invoice total, or set it to match the lines ($25.00).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Purchase' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Use $25.00' }));
    expect(screen.queryByText(/Enter the invoice total/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Purchase' })).toBeEnabled();
  });

  it('still saves a total that matches its lines, including all $0', async () => {
    renderWith({ ...scanned, total_inv_amount: 0, items: [{ ...scanned.items[0], item_price: 0, item_cost: 0 }] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Purchase' })).toBeEnabled());
    expect(screen.queryByText(/Enter the invoice total/)).not.toBeInTheDocument();
  });
});

describe('ReviewScannedDataDialog: $0 invoice total follow-ups (#226 item 5)', () => {
  beforeEach(() => vi.clearAllMocks());

  const line = (over: any) => ({ id: 'l1', row_type: 'item', tax_treatment: 'expense', description: 'Stand', quantity: 1, item_price: 100, item_cost: 50, asset_id: null, category: 'Audio', ...over });
  const openEdit = async (items: any[], opts: { date?: string; total?: number; locked?: number[] } = {}) => {
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({
      id: 'h1', vendor: 'Sweetwater', purchase_date: opts.date ?? '2026-03-01', total_inv_amount: opts.total ?? 0, description: 'Stands',
      items, assets: [], attachments: [],
    } as any);
    const years = await import('../services/taxYear.service');
    vi.mocked(years.getLockedTaxYears).mockResolvedValue(new Set(opts.locked ?? []));
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()} organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1" />);
    await screen.findAllByRole('group', { name: /^Tax treatment/ });
    return svc;
  };

  it('a filed-year purchase with a $0 total over costed lines still saves a description change, with no message or "Use $" button', async () => {
    const svc = await openEdit([line({})], { date: '2025-02-14', locked: [2025] });
    expect(screen.getByText(/2025 tax year is filed/)).toBeInTheDocument();
    expect(screen.queryByText(/Enter the invoice total/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Use \$/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByDisplayValue('Stand'), ' stand');
    const save = screen.getByRole('button', { name: 'Save Changes' });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('l1', { description: 'Stand stand' }));
  });

  it('"Use $X" keeps the stored line costs (priced 100 costed 50, unpriced costed 50) instead of re-spreading the total', async () => {
    const svc = await openEdit([
      line({}),
      line({ id: 'l2', description: 'Bag', item_price: null, item_cost: 50 }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Use $100.00' }));
    expect(screen.queryByText(/Enter the invoice total/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('l2', expect.anything()));
    expect(svc.updatePurchase).toHaveBeenCalledWith('h1', expect.objectContaining({ total_inv_amount: 100 }));
    expect(svc.updatePurchase).toHaveBeenCalledWith('l1', expect.objectContaining({ item_cost: 50 }));
    expect(svc.updatePurchase).toHaveBeenCalledWith('l2', expect.objectContaining({ item_cost: 50 }));
  });

  it('clearing the total in edit mode shows the message and disables Save', async () => {
    await openEdit([line({ item_price: 100, item_cost: 130 })], { total: 130 });
    const save = screen.getByRole('button', { name: 'Save Changes' });
    expect(save).toBeEnabled();
    expect(screen.queryByText(/Enter the invoice total/)).not.toBeInTheDocument();
    await userEvent.clear(screen.getByDisplayValue('130'));
    expect(await screen.findByText(/Enter the invoice total/)).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it('lines totalling under half a cent do not block a $0 total', async () => {
    await openEdit([line({ item_price: 0.004, item_cost: 0.004 })]);
    expect(screen.queryByText(/Enter the invoice total/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  it('shows the $0 total message instead of the Mismatch banner, and keeps Mismatch for other cases', async () => {
    const { unmount } = render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" scannedData={{ ...scanned, total_inv_amount: 0 } as any} file={null} />);
    expect(await screen.findByText(/Enter the invoice total/)).toBeInTheDocument();
    expect(screen.queryByText(/Mismatch/)).not.toBeInTheDocument();
    unmount();
    // stored costs of 50 against a $100 total (edit mode keeps stored costs)
    await openEdit([line({})], { total: 100 });
    expect(await screen.findByText(/Mismatch/)).toBeInTheDocument();
    expect(screen.queryByText(/Enter the invoice total/)).not.toBeInTheDocument();
  });
});

// #128: CSV-imported lines carry a cost but no printed price. Opening such a
// purchase for edit recomputed every cost from the (missing) price, so saving
// wrote $0 costs and proposed $0 to the linked assets.
describe('ReviewScannedDataDialog editing a cost-only purchase (#128)', () => {
  const costOnly = {
    id: 'h1', vendor: 'IDJ Now', purchase_date: '2025-01-20', total_inv_amount: 131.58, description: 'Light bar, and carry bag',
    items: [
      { id: 'l1', row_type: 'item', description: 'Carry bag', quantity: 1, item_price: null, item_cost: 84.92, asset_id: null },
      { id: 'l2', row_type: 'asset', description: 'T-Bar', quantity: 1, item_price: null, item_cost: 46.66, asset_id: 'a2', category: 'Supplies' },
    ],
    assets: [{ id: 'a2', description: 'T-Bar', quantity: 1, item_price: null, item_cost: 46.66 }],
    attachments: [],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue(costOnly as any);
  });

  const openForEdit = () =>
    render(
      <ReviewScannedDataDialog
        open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()}
        organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1"
      />,
    );

  it('keeps the stored line costs when saved without changes', async () => {
    const svc = await import('../services/purchase.service');
    openForEdit();
    await userEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('l2', expect.anything()));

    expect(svc.updatePurchase).toHaveBeenCalledWith('l1', expect.objectContaining({ item_cost: 84.92, line_cost: 84.92 }));
    expect(svc.updatePurchase).toHaveBeenCalledWith('l2', expect.objectContaining({ item_cost: 46.66, line_cost: 46.66 }));
    // the linked asset is compared against its stored cost, not $0
    expect(svc.computeAssetFieldChanges).toHaveBeenCalledWith(expect.objectContaining({ item_cost: 46.66 }), expect.anything());
  });

  it('scales the stored costs, not printed prices, when the invoice total changes', async () => {
    const svc = await import('../services/purchase.service');
    openForEdit();
    const total = await screen.findByDisplayValue('131.58');
    await userEvent.clear(total);
    await userEvent.type(total, '263.16');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('l2', expect.anything()));

    expect(svc.updatePurchase).toHaveBeenCalledWith('l1', expect.objectContaining({ item_cost: expect.closeTo(169.84, 2) }));
    expect(svc.updatePurchase).toHaveBeenCalledWith('l2', expect.objectContaining({ item_cost: expect.closeTo(93.32, 2) }));
  });

  it('shows the stored costs when it opens, with no mismatch against the total', async () => {
    openForEdit();
    expect(await screen.findByText('$84.92')).toBeInTheDocument();
    expect(screen.getByText('$46.66')).toBeInTheDocument();
  });
});


// #133: each line answers two separate questions — track as equipment, and
// expense or depreciate (pre-set from the per-item cost; the $200–$2,500 grey
// zone is the user's call).
describe('ReviewScannedDataDialog: tax treatment and equipment (#133)', () => {
  const threeLines = {
    vendor: 'Sweetwater', purchase_date: '2026-07-05', total_inv_amount: 3289,
    items: [
      { description: 'Cable', quantity: 1, item_price: 50, item_cost: 50, is_asset: false },
      { description: 'Console', quantity: 1, item_price: 3000, item_cost: 3000, is_asset: true, category: 'Audio' },
      { description: 'Moving head', quantity: 1, item_price: 239, item_cost: 239, is_asset: true, category: 'Lighting' },
    ],
  };
  const tax = (desc: string) => within(screen.getByRole('group', { name: `Tax treatment: ${desc}` }));
  const pressed = (desc: string, label: string) => tax(desc).getByRole('button', { name: label }).getAttribute('aria-pressed');

  beforeEach(() => vi.clearAllMocks());

  const openNew = (data: any = threeLines) =>
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" scannedData={data} file={null} />);

  it('pre-sets expense under $200 and depreciate over $2,500, and leaves the grey zone open', async () => {
    openNew();
    await screen.findByRole('group', { name: 'Tax treatment: Cable' });
    expect(pressed('Cable', 'Expense')).toBe('true');
    expect(pressed('Console', 'Depreciate')).toBe('true');
    expect(pressed('Moving head', 'Expense')).toBe('false');
    expect(pressed('Moving head', 'Depreciate')).toBe('false');
  });

  it('won\'t save until every grey-zone line has a treatment, then saves each line\'s choice', async () => {
    openNew();
    const save = await screen.findByRole('button', { name: 'Save Purchase' });
    expect(save).toBeDisabled();
    expect(screen.getByText(/Choose Expense or Depreciate for 1 item/)).toBeInTheDocument();

    await userEvent.click(tax('Moving head').getByRole('button', { name: 'Expense' }));
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(createPurchaseWithUnits).toHaveBeenCalled());

    const [, items, units] = vi.mocked(createPurchaseWithUnits).mock.calls[0];
    expect(items!.map((i: any) => i.tax_treatment)).toEqual(['expense', 'depreciate', 'expense']);
    expect(items!.map((i: any) => i.row_type)).toEqual(['line', 'line', 'line']);
    // Tracked as equipment is separate: the expensed moving head is still equipment,
    // each a lot of 1 until serials or tags are entered (#183).
    expect(units!.map((u: any) => [u.line_index, u.quantity])).toEqual([[1, 1], [2, 1]]);
  });

  it('a depreciated line is always tracked as equipment', async () => {
    openNew({ ...threeLines, total_inv_amount: 400, items: [{ description: 'Amp', quantity: 1, item_price: 400, item_cost: 400, is_asset: false }] });
    const track = await screen.findByRole('switch', { name: 'Track Amp as equipment' });
    expect(track).not.toBeChecked();
    await userEvent.click(tax('Amp').getByRole('button', { name: 'Depreciate' }));
    expect(track).toBeChecked();
    expect(track).toBeDisabled();
  });

  it('explains the choice behind the (?)', async () => {
    openNew();
    await userEvent.click((await screen.findAllByRole('button', { name: 'About expense or depreciate' }))[0]);
    expect(await screen.findByText(/From \$200 to \$2500 is a grey zone/)).toBeInTheDocument();
  });
});

describe('ReviewScannedDataDialog: editing tax treatment and equipment (#133)', () => {
  const purchase = (date: string) => ({
    id: 'h1', vendor: 'Sweetwater', purchase_date: date, total_inv_amount: 400, description: 'Stands',
    items: [{ id: 'l1', row_type: 'item', tax_treatment: 'expense', description: 'Stand', quantity: 1, item_price: 400, item_cost: 400, asset_id: null, category: 'Audio' }],
    assets: [], attachments: [],
  });
  const tax = () => within(screen.getByRole('group', { name: 'Tax treatment: Stand' }));

  beforeEach(() => vi.clearAllMocks());

  const openEdit = async (date: string, opts: { locked?: number[]; ledger?: boolean } = {}) => {
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({ ...purchase(date), gig_id: opts.ledger ? 'g1' : null, items: purchase(date).items.map(i => ({ ...i, gig_id: opts.ledger ? 'g1' : null })) } as any);
    const gigs = await import('../services/gig.service');
    vi.mocked(gigs.getGigFinancials).mockResolvedValue(opts.ledger ? [{ id: 'f1', purchase_id: 'l1', amount: 400 }] as any : []);
    const years = await import('../services/taxYear.service');
    vi.mocked(years.getLockedTaxYears).mockResolvedValue(new Set(opts.locked ?? []));
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()} organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1" />);
    await screen.findByRole('group', { name: 'Tax treatment: Stand' });
    return svc;
  };

  it('a line tracked and depreciated while editing gets its category\'s recovery period once depreciated (#125)', async () => {
    const svc = await openEdit('2026-03-01');
    const assets = await import('../services/asset.service');
    await userEvent.click(tax().getByRole('button', { name: 'Depreciate' }));
    expect(chip('Stand')).toHaveTextContent('7-year');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(assets.updateAsset).toHaveBeenCalledWith('unit-new', { recovery_period: 7 }));
    const depreciate = vi.mocked(svc.updatePurchase).mock.calls.findIndex(c => c[0] === 'l1');
    const period = vi.mocked(assets.updateAsset).mock.calls.findIndex(c => c[1]?.recovery_period === 7);
    expect(vi.mocked(svc.updatePurchase).mock.invocationCallOrder[depreciate])
      .toBeLessThan(vi.mocked(assets.updateAsset).mock.invocationCallOrder[period]);
  });

  it('tracks an expensed line as equipment and then depreciates it, in that order', async () => {
    const svc = await openEdit('2026-03-01');
    expect(tax().getByRole('button', { name: 'Expense' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(tax().getByRole('button', { name: 'Depreciate' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('l1', expect.objectContaining({ tax_treatment: 'depreciate' })));
    expect(svc.addLineUnits).toHaveBeenCalledWith('l1', [expect.objectContaining({ quantity: 1 })]);
    const trackOrder = vi.mocked(svc.addLineUnits).mock.invocationCallOrder[0];
    const lineUpdate = vi.mocked(svc.updatePurchase).mock.calls.findIndex(c => c[0] === 'l1');
    expect(trackOrder).toBeLessThan(vi.mocked(svc.updatePurchase).mock.invocationCallOrder[lineUpdate]);
  });

  it('can track an expensed line as equipment without changing its treatment, giving the equipment its own category', async () => {
    const svc = await openEdit('2026-03-01');
    const assets = await import('../services/asset.service');
    await userEvent.click(screen.getByRole('switch', { name: 'Track Stand as equipment' }));
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(screen.getByText(/Choose an equipment category for 1 item/)).toBeInTheDocument();
    await setEquipment('Stand', { category: 'Lighting', type: 'Stand, Lighting' });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.addLineUnits).toHaveBeenCalled());
    expect(svc.addLineUnits).toHaveBeenCalledWith('l1', [expect.objectContaining({
      category: 'Lighting', type: 'Stand, Lighting', replacement_value: 400, quantity: 1, serial_number: null, tag_number: null,
    })]);
    expect(assets.updateAsset).not.toHaveBeenCalled();
    expect(svc.updatePurchase).toHaveBeenCalledWith('l1', expect.objectContaining({ tax_treatment: 'expense' }));
  });

  it('won\'t depreciate a line that is a gig expense', async () => {
    await openEdit('2026-03-01', { ledger: true });
    expect(tax().getByRole('button', { name: 'Depreciate' })).toBeDisabled();
  });

  it('a purchase in a filed year only lets descriptions change, and equipment be tracked', async () => {
    const svc = await openEdit('2025-02-14', { locked: [2025] });
    expect(screen.getByText(/2025 tax year is filed/)).toBeInTheDocument();
    expect(tax().getByRole('button', { name: 'Depreciate' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Expense category: Stand' })).toBeDisabled();
    await userEvent.click(screen.getByRole('switch', { name: 'Track Stand as equipment' }));
    // the equipment category isn't a tax field, so it can still be chosen
    await setEquipment('Stand', { category: 'Audio' });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.addLineUnits).toHaveBeenCalledWith('l1', [expect.objectContaining({ category: 'Audio' })]));
    expect(svc.updatePurchase).toHaveBeenCalledWith('l1', { description: 'Stand' });
    expect(svc.updatePurchase).toHaveBeenCalledWith('h1', expect.not.objectContaining({ total_inv_amount: expect.anything() }));
  });
});

describe('ReviewScannedDataDialog: categories (10-06)', () => {
  const invoice = {
    vendor: 'Sweetwater', purchase_date: '2026-07-05', total_inv_amount: 3050,
    items: [
      { description: 'Cable', quantity: 1, item_price: 50, item_cost: 50, is_asset: false, category: 'Audio' },
      { description: 'Console', quantity: 1, item_price: 3000, item_cost: 3000, is_asset: true, category: 'Audio' },
    ],
  };
  const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;

  beforeEach(() => vi.clearAllMocks());
  const openNew = async (data: any = invoice) => {
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" scannedData={data} file={null} />);
    // the lists have loaded
    const cats = await import('../services/purchaseCategory.service');
    await waitFor(() => expect(cats.getEquipmentCategories).toHaveBeenCalled());
    await screen.findAllByRole('group', { name: /^Tax treatment/ });
  };

  it('an expensed line picks from the expense categories, with the scanned category mapped to its heading', async () => {
    await openNew();
    expect(select('Expense category: Cable').value).toBe('Small audio parts');
    expect(screen.queryByRole('button', { name: 'Equipment details: Cable' })).not.toBeInTheDocument();
  });

  it('a depreciated line has one category: its equipment category', async () => {
    await openNew();
    expect(chip('Console')).toHaveTextContent('Audio');
    expect(screen.queryByRole('combobox', { name: 'Expense category: Console' })).not.toBeInTheDocument();
  });

  it('the equipment switch is labelled and, when on, asks for an equipment category too', async () => {
    await openNew();
    const sw = screen.getByRole('switch', { name: 'Track Cable as equipment' });
    expect(sw).toHaveTextContent('Equipment');
    expect(sw).not.toBeChecked();
    await userEvent.click(sw);
    expect(sw).toBeChecked();
    expect(chip('Cable')).toHaveTextContent('Audio');
    expect(select('Expense category: Cable').value).toBe('Small audio parts');
  });

  it('saves the expense category on the line and the equipment category on its asset', async () => {
    await openNew();
    await userEvent.click(screen.getByRole('switch', { name: 'Track Cable as equipment' }));
    await setEquipment('Cable', { category: 'Misc' });
    await userEvent.selectOptions(select('Expense category: Cable'), 'Supplies');
    await userEvent.click(screen.getByRole('button', { name: 'Save Purchase' }));
    await waitFor(() => expect(createPurchaseWithUnits).toHaveBeenCalled());
    const [, items, units] = vi.mocked(createPurchaseWithUnits).mock.calls[0];
    expect(items!.map((i: any) => i.category)).toEqual(['Supplies', 'Audio']);
    expect(units!.map((u: any) => u.category)).toEqual(['Misc', 'Audio']);
  });

  it('switching to Depreciate moves the equipment category onto the line, and back', async () => {
    await openNew({ ...invoice, total_inv_amount: 450, items: [{ description: 'Amp', quantity: 1, item_price: 450, item_cost: 450, is_asset: true, category: 'Audio' }] });
    const tax = within(screen.getByRole('group', { name: 'Tax treatment: Amp' }));
    await userEvent.click(tax.getByRole('button', { name: 'Depreciate' }));
    expect(chip('Amp')).toHaveTextContent('Audio');
    await userEvent.click(tax.getByRole('button', { name: 'Expense' }));
    expect(select('Expense category: Amp').value).toBe('Small audio parts');
    expect(chip('Amp')).toHaveTextContent('Audio');
  });

  describe('recovery period (#125)', () => {
    it('a depreciated line takes its category\'s period and saves it on the equipment', async () => {
      await openNew();
      expect(chip('Console')).toHaveTextContent('7-year');
      expect(chip('Console')).not.toHaveTextContent('Choose a recovery period');
      await userEvent.click(screen.getByRole('button', { name: 'Save Purchase' }));
      await waitFor(() => expect(createPurchaseWithUnits).toHaveBeenCalled());
      const [, , units] = vi.mocked(createPurchaseWithUnits).mock.calls[0];
      expect(units![0].recovery_period).toBe(7);
    });

    it('asks when the category has no default, and won\'t save until it is answered', async () => {
      await openNew({ ...invoice, total_inv_amount: 3000, items: [{ description: 'Hazer', quantity: 1, item_price: 3000, item_cost: 3000, is_asset: true, category: 'Misc' }] });
      expect(chip('Hazer')).toHaveTextContent('Choose a recovery period');
      expect(screen.getByText(/Choose a recovery period for 1 depreciated item/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save Purchase' })).toBeDisabled();
      await setEquipment('Hazer', { period: '5' });
      expect(chip('Hazer')).toHaveTextContent('5-year');
      await userEvent.click(screen.getByRole('button', { name: 'Save Purchase' }));
      await waitFor(() => expect(createPurchaseWithUnits).toHaveBeenCalled());
      const [, , units] = vi.mocked(createPurchaseWithUnits).mock.calls[0];
      expect(units![0].recovery_period).toBe(5);
    });

    it('an expensed line has none', async () => {
      await openNew();
      await userEvent.click(screen.getByRole('switch', { name: 'Track Cable as equipment' }));
      expect(chip('Cable')).not.toHaveTextContent('-year');
      await userEvent.click(screen.getByRole('button', { name: 'Save Purchase' }));
      await waitFor(() => expect(createPurchaseWithUnits).toHaveBeenCalled());
      const [, , units] = vi.mocked(createPurchaseWithUnits).mock.calls[0];
      expect(units![0].recovery_period).toBeUndefined();
    });
  });

  it('can add a new equipment category', async () => {
    await openNew({ ...invoice, total_inv_amount: 3000, items: [{ description: 'Switcher', quantity: 1, item_price: 3000, item_cost: 3000, is_asset: true }] });
    expect(chip('Switcher')).toHaveTextContent('Choose an equipment category');
    await setEquipment('Switcher', { newCategory: 'Video', period: '7' });
    expect(chip('Switcher')).toHaveTextContent('Video');
    await userEvent.click(screen.getByRole('button', { name: 'Save Purchase' }));
    await waitFor(() => expect(createPurchaseWithUnits).toHaveBeenCalled());
    const [, items, units] = vi.mocked(createPurchaseWithUnits).mock.calls[0];
    expect(items![0].category).toBe('Video');
    expect(units![0].category).toBe('Video');
  });

  it('keeps a saved category that is not on the list', async () => {
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({
      id: 'h1', vendor: 'V', purchase_date: '2026-03-01', total_inv_amount: 20, description: '',
      items: [{ id: 'l1', row_type: 'item', tax_treatment: 'expense', description: 'Pens', quantity: 1, item_price: 20, item_cost: 20, asset_id: null, category: 'Office' }],
      assets: [], attachments: [],
    } as any);
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()} organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1" />);
    await screen.findByRole('option', { name: 'Supplies' });
    expect(select('Expense category: Pens').value).toBe('Office');
    expect(screen.getByRole('option', { name: 'Office (not on the list)' })).toBeInTheDocument();
  });

  it('a line added while editing is written as row_type line (10-07)', async () => {
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({
      id: 'h1', vendor: 'V', purchase_date: '2026-03-01', total_inv_amount: 20, description: '',
      items: [{ id: 'l1', row_type: 'line', tax_treatment: 'expense', description: 'Pens', quantity: 1, item_price: 20, item_cost: 20, asset_id: null, category: 'Supplies' }],
      assets: [], attachments: [],
    } as any);
    vi.mocked(svc.createPurchase).mockResolvedValue({ id: 'l2' } as any);
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()} organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1" />);
    await screen.findByRole('option', { name: 'Supplies' });
    await userEvent.click(screen.getByRole('button', { name: /Add Item/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.createPurchase).toHaveBeenCalled());
    expect(vi.mocked(svc.createPurchase).mock.calls[0][0]).toEqual(expect.objectContaining({ row_type: 'line' }));
  });

  it('an existing expensed line already tracked shows its equipment\'s category', async () => {
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({
      id: 'h1', vendor: 'V', purchase_date: '2026-03-01', total_inv_amount: 20, description: '',
      items: [{ id: 'l1', row_type: 'asset', tax_treatment: 'expense', description: 'Clamp', quantity: 1, item_price: 20, item_cost: 20, asset_id: 'a1', category: 'Small lighting parts' }],
      assets: [{ id: 'a1', category: 'Lighting', item_cost: 20, quantity: 1 }], attachments: [],
    } as any);
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()} organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1" />);
    await screen.findByRole('option', { name: 'Supplies' });
    expect(select('Expense category: Clamp').value).toBe('Small lighting parts');
    expect(chip('Clamp')).toHaveTextContent('Lighting');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.computeAssetFieldChanges).toHaveBeenCalled());
    // The line's price, cost, vendor and date reach its equipment; its name and category are the item's (#183).
    expect(svc.computeAssetFieldChanges).toHaveBeenCalledWith({ item_price: 20, item_cost: 20, vendor: 'V', purchase_date: '2026-03-01' }, expect.objectContaining({ id: 'a1' }));
  });
});

// #130 / #133 step 3: a receipt scanned on a gig links its expensed lines to the gig,
// one money-out row each. The purchase itself, and depreciated equipment, are not the gig's.
// #226 item 6: a line tracked as equipment AND expensed must have an expense category.
describe('ReviewScannedDataDialog: expense category on a tracked, expensed line (#226 item 6)', () => {
  const NEEDS = 'Choose an expense category';
  const line = (over: Record<string, unknown> = {}) => ({
    description: 'Strap', quantity: 1, item_price: 50, item_cost: 50, is_asset: true, ...over,
  });
  const invoice = (items: any[]) => ({ vendor: 'Amazon', purchase_date: '2026-07-05', total_inv_amount: 50, items });
  const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;

  beforeEach(() => vi.clearAllMocks());
  const openNew = async (items: any[]) => {
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" scannedData={invoice(items)} file={null} />);
    await screen.findByRole('group', { name: 'Tax treatment: Strap' });
    const cats = await import('../services/purchaseCategory.service');
    await waitFor(() => expect(cats.getExpenseCategories).toHaveBeenCalled());
  };

  it('a tracked, expensed line with no expense category shows the message and blocks Save', async () => {
    await openNew([line({ category: 'Gadgets' })]);
    expect(select('Expense category: Strap').value).toBe('');
    expect(screen.getByText(NEEDS)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Purchase' })).toBeDisabled();
  });

  it('saves once an expense category is chosen, and the message goes away', async () => {
    await openNew([line({ category: 'Gadgets' })]);
    await userEvent.selectOptions(select('Expense category: Strap'), 'Supplies');
    expect(screen.queryByText(NEEDS)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save Purchase' }));
    await waitFor(() => expect(createPurchaseWithUnits).toHaveBeenCalled());
    expect(vi.mocked(createPurchaseWithUnits).mock.calls[0][1]!.map((i: any) => i.category)).toEqual(['Supplies']);
  });

  it('blocks Save the moment an untracked line with no category is tracked as equipment', async () => {
    await openNew([line({ is_asset: false, category: undefined })]);
    expect(screen.queryByText(NEEDS)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Track Strap as equipment' }));
    await setEquipment('Strap', { category: 'Audio' });
    expect(screen.getByText(NEEDS)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Purchase' })).toBeDisabled();
  });

  it('an untracked expensed line with no category is unchanged: no message, and it saves', async () => {
    await openNew([line({ is_asset: false })]);
    expect(select('Expense category: Strap').value).toBe('');
    expect(screen.queryByText(NEEDS)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save Purchase' });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(createPurchaseWithUnits).toHaveBeenCalled());
  });

  it('a filed-year purchase is not blocked: only descriptions save there', async () => {
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({
      id: 'h1', vendor: 'Amazon', purchase_date: '2025-02-14', total_inv_amount: 50, description: 'Straps', gig_id: null,
      items: [{ id: 'l1', row_type: 'item', tax_treatment: 'expense', description: 'Strap', quantity: 1, item_price: 50, item_cost: 50, asset_id: null, category: null, gig_id: null }],
      assets: [], attachments: [],
    } as any);
    const years = await import('../services/taxYear.service');
    vi.mocked(years.getLockedTaxYears).mockResolvedValue(new Set([2025]));
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()} organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1" />);
    await screen.findByRole('group', { name: 'Tax treatment: Strap' });
    await userEvent.click(screen.getByRole('switch', { name: 'Track Strap as equipment' }));
    await setEquipment('Strap', { category: 'Audio' });
    expect(select('Expense category: Strap')).toBeDisabled();
    expect(screen.queryByText(NEEDS)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });
});

describe('ReviewScannedDataDialog: Upload Receipt on a gig (#130)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('links each expensed line to the gig, never the purchase or depreciated equipment', async () => {
    const svc = await import('../services/purchase.service');
    const gigs = await import('../services/gig.service');
    const lines = [
      { id: 'l-tape', row_type: 'item', tax_treatment: 'expense', description: 'Tape', line_cost: 50 },
      { id: 'l-console', row_type: 'asset', tax_treatment: 'depreciate', description: 'Console', line_cost: 3000 },
    ];
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({ id: 'p-new', items: lines } as any);
    render(
      <ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" gigId="g1" file={null}
        scannedData={{ vendor: 'Sweetwater', purchase_date: '2026-07-05', total_inv_amount: 3050, items: [
          { description: 'Tape', quantity: 1, item_price: 50, item_cost: 50, is_asset: false, category: 'Supplies' },
          { description: 'Console', quantity: 1, item_price: 3000, item_cost: 3000, is_asset: true, category: 'Audio' },
        ] } as any} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save Purchase' }));
    await waitFor(() => expect(svc.createLedgerEntryForPurchaseLine).toHaveBeenCalled());

    const [header] = vi.mocked(createPurchaseWithUnits).mock.calls[0];
    expect(header).not.toHaveProperty('gig_id');
    expect(svc.updatePurchase).toHaveBeenCalledTimes(1);
    expect(svc.updatePurchase).toHaveBeenCalledWith('l-tape', { gig_id: 'g1' });
    expect(svc.createLedgerEntryForPurchaseLine).toHaveBeenCalledTimes(1);
    expect(svc.createLedgerEntryForPurchaseLine).toHaveBeenCalledWith(expect.objectContaining({ id: 'l-tape' }), 'g1', 'org-1');
    expect(gigs.createGigFinancial).not.toHaveBeenCalled();
  });
});

describe('ReviewScannedDataDialog: equipment details pop-up (10-06)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('new equipment saves its Type, and the chip shows it with its units', async () => {
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" file={null}
      scannedData={{ vendor: 'Amazon', purchase_date: '2026-06-14', total_inv_amount: 27.31, items: [
        { description: 'PowerCON breakout box', quantity: 1, item_price: 69.99, item_cost: 27.31, is_asset: true, category: 'Power' },
      ] } as any} />);
    await setEquipment('PowerCON breakout box', { type: 'Distribution, PowerCon Breakout', tags: ['PB-01'] });
    expect(chip('PowerCON breakout box')).toHaveTextContent('Power › Distribution, PowerCon Breakout');
    expect(chip('PowerCON breakout box')).toHaveTextContent('1 unit');
    await userEvent.click(screen.getByRole('button', { name: 'Save Purchase' }));
    await waitFor(() => expect(createPurchaseWithUnits).toHaveBeenCalled());
    const [, , units] = vi.mocked(createPurchaseWithUnits).mock.calls[0];
    expect(units![0]).toEqual(expect.objectContaining({ category: 'Power', type: 'Distribution, PowerCon Breakout', tag_number: 'PB-01', quantity: 1 }));
    expect(units![0]).not.toHaveProperty('kit_ids');
  });

  it('won’t save a units line until each unit has a serial or a tag', async () => {
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" file={null}
      scannedData={{ vendor: 'Amazon', purchase_date: '2026-06-14', total_inv_amount: 100, items: [
        { description: 'Mic', quantity: 2, item_price: 50, item_cost: 50, is_asset: true, category: 'Audio' },
      ] } as any} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Equipment details: Mic' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Equipment details' }));
    await userEvent.click(dialog.getByRole('radio', { name: /^Unit/ }));
    await userEvent.type(dialog.getByLabelText('Inventory tag, unit 1'), 'M-1');
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }));
    expect(dialog.getByText('Unit 2 needs a serial number or a tag (either will do).')).toBeInTheDocument();
  });

  // 10-07 (Cameron): the switch sat before the expense dropdown and the chip
  // after it, so the two halves of one control were split apart.
  it('the Equipment switch sits after the expense category, joined to its details', async () => {
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" file={null}
      scannedData={{ vendor: 'Amazon', purchase_date: '2026-06-14', total_inv_amount: 100, items: [
        { description: 'Wireless DMX', quantity: 1, item_price: 100, item_cost: 100, is_asset: true, category: 'Lighting' },
        { description: 'Wall station', quantity: 1, item_price: 0, item_cost: 0, is_asset: false },
      ] } as any} />);
    const expense = screen.getByRole('combobox', { name: 'Expense category: Wireless DMX' });
    const toggle = screen.getByRole('switch', { name: 'Track Wireless DMX as equipment' });
    const details = chip('Wireless DMX');
    expect(expense.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One control: the switch and its details share a group, and the details name the category.
    const group = screen.getByRole('group', { name: 'Equipment: Wireless DMX' });
    expect(group).toContainElement(toggle);
    expect(group).toContainElement(details);
    expect(within(group).queryByText('Equipment')).toBeNull();
    expect(details).toHaveTextContent('Lighting');
    // Off: the switch shows the plain label and there are no details to open.
    const offGroup = screen.getByRole('group', { name: 'Equipment: Wall station' });
    expect(within(offGroup).getByText('Equipment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equipment details: Wall station' })).toBeNull();
    // Turned on without a category, the details ask for one.
    await userEvent.click(screen.getByRole('switch', { name: 'Track Wall station as equipment' }));
    expect(chip('Wall station')).toHaveTextContent('Choose an equipment category');
  });

  it('a saved line shows its item and units; editing a unit\'s tag proposes the change', async () => {
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({
      id: 'h1', vendor: 'V', purchase_date: '2026-03-01', total_inv_amount: 20, description: '',
      items: [{ id: 'l1', row_type: 'line', tax_treatment: 'expense', description: 'Clamp', quantity: 1, item_price: 20, item_cost: 20, asset_id: 'a1', category: 'Small lighting parts' }],
      assets: [{ id: 'a1', purchase_line_id: 'l1', equipment_item_id: 'i-clamp', manufacturer_model: 'Clamp', category: 'Lighting', type: 'Clamp', tag_number: 'C-1',
        item_price: 20, item_cost: 20, vendor: 'V', acquisition_date: '2026-03-01', quantity: 1 }], attachments: [],
    } as any);
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()} organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Equipment details: Clamp' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Equipment details' }));
    expect(dialog.getByText('Lighting · Clamp')).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Change item' })).not.toBeInTheDocument();
    const tag = dialog.getByLabelText('Inventory tag');
    expect(tag).toHaveValue('C-1');
    await userEvent.clear(tag);
    await userEvent.type(tag, 'C-2');
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Confirm linked record updates')).toBeInTheDocument();
    expect(screen.getByText('C-2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Save/ }));
    const assets = await import('../services/asset.service');
    await waitFor(() => expect(assets.updateAsset).toHaveBeenCalledWith('a1', { tag_number: 'C-2' }));
  });
});

// #183 piece C: a saved line's quantity and its equipment.
describe('ReviewScannedDataDialog: a saved line\'s units (#183)', () => {
  beforeEach(() => vi.clearAllMocks());

  const unitRec = (id: string, tag: string) => ({ id, purchase_line_id: 'l1', equipment_item_id: 'i-k12', manufacturer_model: 'QSC K12.2', category: 'Audio',
    tag_number: tag, item_price: 949, item_cost: 949, vendor: 'V', acquisition_date: '2026-03-01', quantity: 1, replacement_value: 1049 });
  const openSaved = async (quantity: number, records: any[], tax: 'expense' | 'depreciate' = 'expense') => {
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({
      id: 'h1', vendor: 'V', purchase_date: '2026-03-01', total_inv_amount: 949 * quantity, description: '',
      items: [{ id: 'l1', row_type: 'line', tax_treatment: tax, description: 'K12', quantity, item_price: 949, item_cost: 949,
        asset_id: records[0].id, category: 'Small audio parts', purchase_date: '2026-03-01' }],
      assets: records, attachments: [],
    } as any);
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()} organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1" />);
    await screen.findByRole('button', { name: 'Equipment details: K12' });
    return svc;
  };
  /** Tick a unit to remove, and choose to delete it. */
  const removeUnit = async (tag: string, how: 'Delete' | 'Mark Inactive' = 'Delete') => {
    await userEvent.click(within(screen.getByRole('group', { name: 'Units to remove: K12' })).getByRole('checkbox', { name: tag }));
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^${how}`) }));
  };

  it('more pieces on the line: their serials or tags are entered, and they are added as units', async () => {
    const svc = await openSaved(3, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102')]);
    expect(screen.getByRole('button', { name: 'Equipment details: K12' })).toHaveTextContent('Serials or tags needed');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Equipment details: K12' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Equipment details' }));
    expect(dialog.getByLabelText('Inventory tag, unit 1')).toHaveValue('DSL-0101');
    await userEvent.type(dialog.getByLabelText('Inventory tag, unit 3'), 'DSL-0103');
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.addLineUnits).toHaveBeenCalledWith('l1', [expect.objectContaining({
      equipment_item_id: 'i-k12', tag_number: 'DSL-0103', quantity: 1,
    })]));
  });

  it('fewer pieces on the line: update the equipment, removing the units ticked', async () => {
    await openSaved(2, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102'), unitRec('u3', 'DSL-0103')]);
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('The line is now 2; it has 3 units.')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /Confirm & Save/ });
    await userEvent.click(screen.getByRole('radio', { name: 'Update the equipment: remove 1 unit' }));
    expect(confirm).toBeDisabled();
    await removeUnit('DSL-0102');
    await userEvent.click(confirm);
    const assets = await import('../services/asset.service');
    await waitFor(() => expect(assets.deleteAsset).toHaveBeenCalledWith('u2'));
    expect(assets.deleteAsset).toHaveBeenCalledTimes(1);
  });

  it('fewer pieces on a depreciated line: removing the unit the line points at moves the line to a kept unit first', async () => {
    // The database refuses to delete a depreciated line's own equipment record (purchases_check_depreciate_has_asset).
    const svc = await openSaved(2, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102'), unitRec('u3', 'DSL-0103')]
      .map(r => ({ ...r, recovery_period: 5 })), 'depreciate');
    const assets = await import('../services/asset.service');
    let marker = 'u1';
    const calls: string[] = [];
    vi.mocked(svc.updatePurchase).mockImplementation(async (id: string, d: any) => {
      calls.push(`purchase ${id}`);
      if (id === 'l1' && 'asset_id' in d) marker = d.asset_id;
      return {} as any;
    });
    vi.mocked(assets.deleteAsset).mockImplementation(async (id: string) => {
      calls.push(`delete ${id}`);
      if (id === marker) throw new Error('A depreciated purchase line must keep its equipment record');
      return { success: true };
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Update the equipment: remove 1 unit' }));
    await removeUnit('DSL-0101');
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Save/ }));
    await waitFor(() => expect(assets.deleteAsset).toHaveBeenCalledWith('u1'));
    expect(svc.updatePurchase).toHaveBeenCalledWith('l1', { asset_id: 'u2' });
    expect(calls.indexOf('purchase l1')).toBeLessThan(calls.indexOf('delete u1'));
    // The equipment changes go first, so a refusal leaves the purchase as it was.
    expect(calls.indexOf('delete u1')).toBeLessThan(calls.indexOf('purchase h1'));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('h1', expect.anything()));
  });

  it('a price change on the line skips the units being removed', async () => {
    const real = await vi.importActual<typeof import('../services/purchase.service')>('../services/purchase.service');
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.computeAssetFieldChanges).mockImplementation(real.computeAssetFieldChanges);
    await openSaved(2, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102'), unitRec('u3', 'DSL-0103')]);
    const assets = await import('../services/asset.service');
    const price = screen.getAllByDisplayValue('949')[0];
    await userEvent.clear(price);
    await userEvent.type(price, '900');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Update the equipment: remove 1 unit' }));
    await removeUnit('DSL-0103');
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Save/ }));
    await waitFor(() => expect(assets.updateAsset).toHaveBeenCalledWith('u1', expect.objectContaining({ item_price: 900 })));
    expect(assets.updateAsset).toHaveBeenCalledWith('u2', expect.objectContaining({ item_price: 900 }));
    expect(assets.updateAsset).not.toHaveBeenCalledWith('u3', expect.anything());
  });

  it('fewer pieces on an expensed line: removing its first unit keeps the line tracked', async () => {
    const svc = await openSaved(2, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102'), unitRec('u3', 'DSL-0103')]);
    const assets = await import('../services/asset.service');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Update the equipment: remove 1 unit' }));
    await removeUnit('DSL-0101');
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Save/ }));
    await waitFor(() => expect(assets.deleteAsset).toHaveBeenCalledWith('u1'));
    expect(svc.updatePurchase).toHaveBeenCalledWith('l1', { asset_id: 'u2' });
    expect(vi.mocked(svc.updatePurchase).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(assets.deleteAsset).mock.invocationCallOrder[0]);
  });

  it('removed units: asks each time whether to delete them or mark them Inactive', async () => {
    await openSaved(2, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102'), unitRec('u3', 'DSL-0103')]);
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Update the equipment: remove 1 unit' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Units to remove: K12' })).getByRole('checkbox', { name: 'DSL-0103' }));
    expect(screen.getByRole('button', { name: /Confirm & Save/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /^Delete/ })).toHaveAccessibleName(/kits and scan history go with/);
    expect(screen.getByRole('radio', { name: /^Mark Inactive/ })).toBeInTheDocument();
  });

  it('Mark Inactive keeps the unit, unlinked from the line, and keeps the line tracked', async () => {
    const svc = await openSaved(2, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102'), unitRec('u3', 'DSL-0103')]);
    const assets = await import('../services/asset.service');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Update the equipment: remove 1 unit' }));
    await removeUnit('DSL-0101', 'Mark Inactive');
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Save/ }));
    await waitFor(() => expect(assets.updateAsset).toHaveBeenCalledWith('u1', { status: 'Inactive', purchase_line_id: null }));
    expect(svc.updatePurchase).toHaveBeenCalledWith('l1', { asset_id: 'u2' });
    expect(assets.deleteAsset).not.toHaveBeenCalled();
  });

  it('a save without opening the pop-up leaves each unit\'s own value, insurance and period alone', async () => {
    const svc = await openSaved(3, [unitRec('u1', 'DSL-0101'), { ...unitRec('u2', 'DSL-0102'), replacement_value: 2000, insurance_policy_added: true },
      unitRec('u3', 'DSL-0103')]);
    const assets = await import('../services/asset.service');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('h1', expect.anything()));
    expect(screen.queryByText('Confirm linked record updates')).not.toBeInTheDocument();
    expect(assets.updateAsset).not.toHaveBeenCalled();
  });

  it('a value changed in the pop-up goes to every unit', async () => {
    await openSaved(2, [unitRec('u1', 'DSL-0101'), { ...unitRec('u2', 'DSL-0102'), replacement_value: 2000 }]);
    const assets = await import('../services/asset.service');
    await userEvent.click(screen.getByRole('button', { name: 'Equipment details: K12' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Equipment details' }));
    const value = dialog.getByLabelText(/Replacement Value/);
    await userEvent.clear(value);
    await userEvent.type(value, '1100');
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await userEvent.click(await screen.findByRole('button', { name: /Confirm & Save/ }));
    await waitFor(() => expect(assets.updateAsset).toHaveBeenCalledWith('u1', { replacement_value: 1100 }));
    expect(assets.updateAsset).toHaveBeenCalledWith('u2', { replacement_value: 1100 });
  });

  it('when removing a unit fails, the purchase itself is not saved', async () => {
    const svc = await openSaved(2, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102'), unitRec('u3', 'DSL-0103')]);
    const assets = await import('../services/asset.service');
    vi.mocked(assets.deleteAsset).mockRejectedValue(new Error('refused'));
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Update the equipment: remove 1 unit' }));
    await removeUnit('DSL-0103');
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Save/ }));
    await waitFor(() => expect(assets.deleteAsset).toHaveBeenCalledWith('u3'));
    expect(svc.updatePurchase).not.toHaveBeenCalled();
  });

  it('a line lowered in this edit must have a choice before saving', async () => {
    await openSaved(3, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102'), unitRec('u3', 'DSL-0103')]);
    const qty = screen.getByPlaceholderText('1');
    await userEvent.clear(qty);
    await userEvent.type(qty, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('The line is now 2; it has 3 units.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Leave the equipment as it is' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Confirm & Save/ })).toBeDisabled();
  });

  it('a line left with more units on an earlier save starts at "Leave the equipment as it is"', async () => {
    const svc = await openSaved(2, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102'), unitRec('u3', 'DSL-0103')]);
    const assets = await import('../services/asset.service');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('radio', { name: 'Leave the equipment as it is' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Save/ }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('h1', expect.anything()));
    expect(assets.deleteAsset).not.toHaveBeenCalled();
  });

  it('fewer pieces on the line: or leave the equipment as it is', async () => {
    const svc = await openSaved(2, [unitRec('u1', 'DSL-0101'), unitRec('u2', 'DSL-0102'), unitRec('u3', 'DSL-0103')]);
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Leave the equipment as it is' }));
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Save/ }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('l1', expect.objectContaining({ quantity: 2 })));
    const assets = await import('../services/asset.service');
    expect(assets.deleteAsset).not.toHaveBeenCalled();
  });

  it('a lot whose line changed: update its quantity, or leave it', async () => {
    const lot = { ...unitRec('lot1', ''), tag_number: null, quantity: 10 };
    await openSaved(8, [lot]);
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('The line is now 8; its lot is 10.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Update the equipment: make the lot 8' }));
    await userEvent.click(screen.getByRole('button', { name: /Confirm & Save/ }));
    const assets = await import('../services/asset.service');
    await waitFor(() => expect(assets.updateAsset).toHaveBeenCalledWith('lot1', { quantity: 8 }));
  });
});

// #131 (Cameron's answers, 10-07)
describe('ReviewScannedDataDialog: purchase data fixes (#131)', () => {
  beforeEach(() => vi.clearAllMocks());

  const editing = async (over: Record<string, any> = {}) => {
    const svc = await import('../services/purchase.service');
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({
      id: 'h1', vendor: 'V', purchase_date: '2026-03-01', total_inv_amount: 21.6, description: '',
      items: [{ id: 'l1', row_type: 'line', tax_treatment: 'expense', description: 'Tape', quantity: 1, item_price: 20, item_cost: 21.6,
                line_cost: 21.6, asset_id: null, category: 'Supplies', purchase_date: '2026-03-01', gig_id: over.gig_id ?? null }],
      assets: [], attachments: [],
    } as any);
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()} organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1" />);
    await screen.findByRole('option', { name: 'Supplies' });
    return svc;
  };

  it('changing the purchase date moves its lines to the new date', async () => {
    const svc = await editing();
    fireEvent.change(screen.getByDisplayValue('2026-03-01'), { target: { value: '2026-03-05' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('l1', expect.anything()));
    expect(svc.updatePurchase).toHaveBeenCalledWith('l1', expect.objectContaining({ purchase_date: '2026-03-05' }));
  });

  it('a line\'s gig expense follows the line cost, amount and settled amount', async () => {
    const gigs = await import('../services/gig.service');
    vi.mocked(gigs.getGigFinancials).mockResolvedValueOnce([
      { id: 'f1', purchase_id: 'l1', amount: 20, amount_settled: 20, stage: 'paid' },
    ] as any);
    await editing({ gig_id: 'g1' });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await userEvent.click(await screen.findByRole('button', { name: /Confirm & Save/ }));
    await waitFor(() => expect(gigs.updateGigFinancial).toHaveBeenCalled());
    expect(gigs.updateGigFinancial).toHaveBeenCalledWith('f1', { amount: 21.6, amount_settled: 21.6 });
  });

  it('new equipment keeps the scanned manufacturer and model, or falls back to the description', async () => {
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" file={null}
      scannedData={{ vendor: 'Sweetwater', purchase_date: '2026-06-14', total_inv_amount: 200, items: [
        { description: 'Shure SM58 vocal mic with clip and bag', manufacturer_model: 'Shure SM58', quantity: 1, item_price: 100, item_cost: 100, is_asset: true, category: 'Audio' },
        { description: 'XLR cable 25ft', quantity: 1, item_price: 100, item_cost: 100, is_asset: true, category: 'Audio' },
      ] } as any} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save Purchase' }));
    await waitFor(() => expect(createPurchaseWithUnits).toHaveBeenCalled());
    const [, , units] = vi.mocked(createPurchaseWithUnits).mock.calls[0];
    expect(units!.map((u: any) => u.manufacturer_model)).toEqual(['Shure SM58', 'XLR cable 25ft']);
    expect(units![0].description).toBe('Shure SM58 vocal mic with clip and bag');
  });
});

describe('ReviewScannedDataDialog: one record per unit (#183)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves a line of 2 with a tag on each as 2 units: the purchase that failed to save', async () => {
    const svc = await import('../services/purchase.service');
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} organizationId="org-1" file={null}
      scannedData={{ vendor: 'Sweetwater', purchase_date: '2026-07-05', total_inv_amount: 1898,
        items: [{ description: 'QSC K12.2', quantity: 2, item_price: 949, item_cost: 949, is_asset: true, category: 'Audio' }] } as any} />);
    // $949 each is in the grey zone: choose Depreciate.
    await userEvent.click(within(await screen.findByRole('group', { name: 'Tax treatment: QSC K12.2' })).getByRole('button', { name: 'Depreciate' }));
    await userEvent.click(screen.getByRole('button', { name: 'Equipment details: QSC K12.2' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Equipment details' }));
    await userEvent.click(dialog.getByRole('radio', { name: /^Unit/ }));
    await userEvent.type(dialog.getByLabelText('Inventory tag, unit 1'), 'DSL-0101');
    await userEvent.type(dialog.getByLabelText('Inventory tag, unit 2'), 'DSL-0102');
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Purchase' }));

    await waitFor(() => expect(svc.createPurchaseWithUnits).toHaveBeenCalled());
    const [, items, units] = vi.mocked(svc.createPurchaseWithUnits).mock.calls[0];
    expect(items).toHaveLength(1);
    expect(units.map((u: any) => [u.line_index, u.tag_number, u.quantity])).toEqual([[0, 'DSL-0101', 1], [0, 'DSL-0102', 1]]);
    expect(units.every((u: any) => u.manufacturer_model === 'QSC K12.2' && u.category === 'Audio' && u.replacement_value === 949
      && u.recovery_period === 7)).toBe(true);
  });
});

// #330: a saved line keeps its stored line_cost / line_amount unless its own quantity, price or
// cost share changes. Here "Heads" was trimmed by 6¢ so the lines add up to the paid total:
// 10 × 23.921 = 239.21 but it stores 239.15; 10 × 23.899 = 238.99 but it stores 239.00.
describe('ReviewScannedDataDialog: editing keeps stored line totals (#330)', () => {
  const heads = { id: 'l1', row_type: 'line', tax_treatment: 'expense', description: 'Heads', quantity: 10, item_price: 23.899, item_cost: 23.921,
    line_amount: 239.0, line_cost: 239.15, asset_id: null, category: 'Small audio parts', gig_id: null as string | null };
  const cable = { id: 'l2', row_type: 'line', tax_treatment: 'expense', description: 'Cable', quantity: 2, item_price: 30, item_cost: 30.425,
    line_amount: 60, line_cost: 60.85, asset_id: null, category: 'Small audio parts', gig_id: null as string | null };

  beforeEach(() => vi.clearAllMocks());

  const openEdit = async (opts: { total?: number; ledger?: boolean } = {}) => {
    const svc = await import('../services/purchase.service');
    const gigId = opts.ledger ? 'g1' : null;
    vi.mocked(svc.getPurchaseWithDetails).mockResolvedValue({
      id: 'h1', vendor: 'Sweetwater', purchase_date: '2026-06-23', total_inv_amount: opts.total ?? 300, description: 'Parts', gig_id: gigId,
      items: [{ ...heads, gig_id: gigId }, { ...cable }], assets: [], attachments: [],
    } as any);
    const gigs = await import('../services/gig.service');
    vi.mocked(gigs.getGigFinancials).mockResolvedValue(opts.ledger ? [{ id: 'f1', purchase_id: 'l1', amount: 239.15 }] as any : []);
    const years = await import('../services/taxYear.service');
    vi.mocked(years.getLockedTaxYears).mockResolvedValue(new Set());
    render(<ReviewScannedDataDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} onUpdated={vi.fn()} organizationId="org-1" scannedData={null} file={null} editPurchaseId="h1" />);
    await screen.findByRole('group', { name: 'Tax treatment: Heads' });
    return svc;
  };
  const sent = (svc: any, id: string) => vi.mocked(svc.updatePurchase).mock.calls.find(([lineId]: any[]) => lineId === id)![1] as any;

  it('saved with no changes, every stored total comes back as it was, and no gig-ledger change is offered', async () => {
    const svc = await openEdit({ ledger: true });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('l2', expect.anything()));
    expect(sent(svc, 'l1')).toMatchObject({ line_cost: 239.15, line_amount: 239.0, item_cost: 23.921, item_price: 23.899, quantity: 10 });
    expect(sent(svc, 'l2')).toMatchObject({ line_cost: 60.85, line_amount: 60, item_cost: 30.425, item_price: 30, quantity: 2 });
    expect(screen.queryByRole('button', { name: /Confirm & Save/ })).not.toBeInTheDocument();
    const gigs = await import('../services/gig.service');
    expect(gigs.updateGigFinancial).not.toHaveBeenCalled();
  });

  it('changing only a line\'s category keeps its stored totals, and the untouched line\'s', async () => {
    const svc = await openEdit();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Expense category: Heads' }), 'Supplies');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('l2', expect.anything()));
    expect(sent(svc, 'l1')).toMatchObject({ category: 'Supplies', line_cost: 239.15, line_amount: 239.0 });
    expect(sent(svc, 'l2')).toMatchObject({ line_cost: 60.85, line_amount: 60 });
  });

  it('changing a quantity re-spreads the costs, and each line whose cost moved is recomputed', async () => {
    const svc = await openEdit();
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '11' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(svc.updatePurchase).toHaveBeenCalledWith('l2', expect.anything()));
    const h = sent(svc, 'l1');
    const c = sent(svc, 'l2');
    expect(h.quantity).toBe(11);
    expect(h.item_cost).not.toBe(23.921);
    expect(h.line_cost).toBe(Number((11 * h.item_cost).toFixed(4)));
    expect(h.line_amount).toBe(Number((11 * 23.899).toFixed(4)));
    expect(c.item_cost).not.toBe(30.425);
    expect(c.line_cost).toBe(Number((2 * c.item_cost).toFixed(4)));
    expect(c.line_amount).toBe(60);
  });

  it('reads Reconciled when the stored line costs add up to the invoice', async () => {
    await openEdit();
    expect(screen.getByText(/Reconciled/)).toBeInTheDocument();
    expect(screen.getByText(/Line costs \$300\.00 vs Invoice \$300\.00/)).toBeInTheDocument();
  });

  it('"Use $X" offers the stored line costs\' sum', async () => {
    await openEdit({ total: 0 });
    expect(await screen.findByRole('button', { name: 'Use $300.00' })).toBeInTheDocument();
  });
});

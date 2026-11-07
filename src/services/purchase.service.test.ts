import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPurchases,
  createPurchase,
  trackPurchaseLineAsEquipment,
  createPurchaseWithUnits,
  addLineUnits,
  getLineUnits,
  scanInvoice,
  importPurchases,
  deletePurchase,
  computeAssetFieldChanges,
  purchaseLineLedgerAmount,
  buildPurchaseLineLedgerPayload,
  createLedgerEntryForPurchaseLine,
  reconcileLedgerForLineGigChange,
  removeLedgerEntriesForPurchaseLine,
  getLinkedGigExpenses,
} from './purchase.service';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';
import {
  getGigFinancialsByPurchaseId,
  createGigFinancial,
  updateGigFinancial,
  deleteGigFinancial,
} from './gigFinancial.service';
import { getKitOptions, createKit, addKitAssetLines } from './kit.service';

// Mock Supabase client
vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

// Mock Auth utils
vi.mock('../utils/supabase/auth-utils', () => ({
  requireAuth: vi.fn(),
}));

// Mock the gig-financial primitives the ledger-lifecycle helpers delegate to.
// Kit lines written by the import (#183 D).
vi.mock('./kit.service', () => ({
  getKitOptions: vi.fn(async () => []),
  createKit: vi.fn(),
  addKitAssetLines: vi.fn(async () => undefined),
}));

vi.mock('./gigFinancial.service', () => ({
  getGigFinancialsByPurchaseId: vi.fn(),
  createGigFinancial: vi.fn(),
  updateGigFinancial: vi.fn(),
  deleteGigFinancial: vi.fn(),
}));

describe('purchase.service', () => {
  let mockSupabase: any;
  const mockUser = { id: 'user-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      rpc: vi.fn(),
      functions: {
        invoke: vi.fn(),
      },
      then: vi.fn(),
    };

    (createClient as any).mockReturnValue(mockSupabase);
    (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: mockUser });
  });

  describe('getPurchases', () => {
    it('should fetch purchases for an organization', async () => {
      const mockData = [{ id: 'p1', vendor: 'Amazon' }];
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: mockData, error: null }));

      const result = await getPurchases('org-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('purchases');
      expect(mockSupabase.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(result).toEqual(mockData);
    });

    it('should apply filters correctly', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: [], error: null }));

      await getPurchases('org-1', { gig_id: 'gig-1', vendor: 'test' });

      expect(mockSupabase.eq).toHaveBeenCalledWith('gig_id', 'gig-1');
      expect(mockSupabase.ilike).toHaveBeenCalledWith('vendor', '%test%');
    });
  });

  describe('createPurchase', () => {
    it('should insert a new purchase', async () => {
      const purchaseData = { vendor: 'Apple', organization_id: 'org-1' };
      const mockResult = { id: 'p1', ...purchaseData };
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: mockResult, error: null }));

      const result = await createPurchase(purchaseData);

      expect(mockSupabase.insert).toHaveBeenCalledWith(purchaseData);
      expect(result).toEqual(mockResult);
    });
  });

  describe('createPurchaseWithUnits (#183)', () => {
    it('saves the purchase, its lines and one record per unit through create_purchase_transaction_v2', async () => {
      const header = { organization_id: 'org-1', vendor: 'Sweetwater' };
      const items = [{ organization_id: 'org-1', description: 'QSC K12.2', quantity: 2 }];
      const units = [
        { organization_id: 'org-1', line_index: 0, manufacturer_model: 'QSC K12.2', category: 'Audio', serial_number: 'GAA1', tag_number: null, quantity: 1 },
        { organization_id: 'org-1', line_index: 0, manufacturer_model: 'QSC K12.2', category: 'Audio', serial_number: null, tag_number: 'DSL-0102', quantity: 1 },
      ];
      mockSupabase.rpc.mockResolvedValue({ data: { id: 'h1', line_ids: ['l1'], unit_ids: ['u1', 'u2'] }, error: null });

      const result = await createPurchaseWithUnits(header, items, units);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('create_purchase_transaction_v2', { p_header: header, p_items: items, p_units: units });
      expect(result).toEqual({ id: 'h1', line_ids: ['l1'], unit_ids: ['u1', 'u2'] });
    });

    it('passes the database’s refusal on', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Each unit must name a line of this purchase' } });
      await expect(createPurchaseWithUnits({ organization_id: 'org-1' }, [], [])).rejects.toMatchObject({ message: 'Each unit must name a line of this purchase' });
    });
  });

  describe('addLineUnits (#183)', () => {
    it('adds units to a saved line through add_purchase_line_units', async () => {
      const units = [{ organization_id: 'org-1', manufacturer_model: 'QSC K12.2', category: 'Audio', serial_number: null, tag_number: 'DSL-0104', quantity: 1 }];
      mockSupabase.rpc.mockResolvedValue({ data: ['u4'], error: null });

      expect(await addLineUnits('line-1', units)).toEqual(['u4']);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('add_purchase_line_units', { p_line_id: 'line-1', p_units: units });
    });
  });

  describe('getLineUnits (#183)', () => {
    it('reads the units or lot of a line through their purchase_line_id', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: [{ id: 'u1' }, { id: 'u2' }], error: null }));

      expect(await getLineUnits('line-1')).toEqual([{ id: 'u1' }, { id: 'u2' }]);
      expect(mockSupabase.from).toHaveBeenCalledWith('assets');
      expect(mockSupabase.eq).toHaveBeenCalledWith('purchase_line_id', 'line-1');
    });
  });

  describe('scanInvoice', () => {
    it('should invoke the ai-scan edge function with the file and organization id', async () => {
      const mockFile = new File(['test'], 'invoice.pdf', { type: 'application/pdf' });
      const mockResult = { vendor: 'Amazon', items: [] };
      mockSupabase.functions.invoke.mockResolvedValue({ data: mockResult, error: null });

      const result = await scanInvoice(mockFile, 'org-1');

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('ai-scan', expect.any(Object));
      const body = mockSupabase.functions.invoke.mock.calls[0][1].body as FormData;
      // The edge function requires organization_id to enforce org membership
      expect(body.get('organization_id')).toBe('org-1');
      expect(body.get('file')).toBe(mockFile);
      expect(result).toEqual(mockResult);
    });
  });

  describe('importPurchases (#183 D)', () => {
    const header = { organization_id: 'org-1', purchase_date: '2025-11-03', vendor: 'Sweetwater', total_inv_amount: 905.03 };
    const lineOf = (description: string, quantity: number) => ({ organization_id: 'org-1', row_type: 'line' as const, description, quantity, tax_treatment: 'depreciate' as const });
    const unit = (line_index: number, serial_number: string | null, quantity = 1) => ({
      organization_id: 'org-1', line_index, manufacturer_model: 'Shure SM58', category: 'Audio', serial_number, tag_number: null, quantity,
    });
    const micPurchase = {
      label: 'Purchase on 2025-11-03 from Sweetwater',
      header,
      items: [lineOf('Shure SM58', 2), lineOf('Mic Clip', 10)],
      units: [unit(0, 'A'), unit(0, 'B'), unit(1, null, 10)],
      unitKits: ['Mic Kit 1', 'Mic Kit 1', 'Mic Kit 1'],
      rowIndexes: [2, 3, 4],
    };

    it('saves each purchase through create_purchase_transaction_v2, never v1', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: { id: 'h1', line_ids: ['l1', 'l2'], unit_ids: ['u1', 'u2', 'u3'] }, error: null });
      (getKitOptions as any).mockResolvedValue([{ id: 'kit-1', name: 'Mic Kit 1' }]);

      const result = await importPurchases('org-1', { purchases: [micPurchase] });

      expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('create_purchase_transaction_v2', { p_header: header, p_items: micPurchase.items, p_units: micPurchase.units });
      expect(mockSupabase.rpc).not.toHaveBeenCalledWith('create_purchase_transaction_v1', expect.anything());
      expect(result.results).toEqual([{ rowIndexes: [2, 3, 4], status: 'success' }]);
      expect(result.successCount).toBe(3);
      expect(result.errors).toEqual([]);
    });

    it('adds each unit, and the lot with its quantity, to a kit found by name as its own line', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: { id: 'h1', line_ids: ['l1', 'l2'], unit_ids: ['u1', 'u2', 'u3'] }, error: null });
      (getKitOptions as any).mockResolvedValue([{ id: 'kit-1', name: ' mic  kit 1' }]);

      await importPurchases('org-1', { purchases: [micPurchase] });

      expect(createKit).not.toHaveBeenCalled();
      expect(addKitAssetLines).toHaveBeenCalledWith([
        { kit_id: 'kit-1', asset_id: 'u1', quantity: 1 },
        { kit_id: 'kit-1', asset_id: 'u2', quantity: 1 },
        { kit_id: 'kit-1', asset_id: 'u3', quantity: 10 },
      ]);
    });

    it('creates a kit it can’t find, once for the whole import', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: { id: 'h1', line_ids: ['l1', 'l2'], unit_ids: ['u1', 'u2', 'u3'] }, error: null })
        .mockResolvedValueOnce({ data: { id: 'h2', line_ids: ['l3', 'l4'], unit_ids: ['u4', 'u5', 'u6'] }, error: null });
      (getKitOptions as any).mockResolvedValue([]);
      (createKit as any).mockResolvedValue({ id: 'kit-new', name: 'Mic Kit 1' });

      await importPurchases('org-1', { purchases: [micPurchase, { ...micPurchase, rowIndexes: [5, 6, 7] }] });

      expect(createKit).toHaveBeenCalledTimes(1);
      expect(createKit).toHaveBeenCalledWith({ organization_id: 'org-1', name: 'Mic Kit 1', category: 'Imported', components: [] });
      expect(addKitAssetLines).toHaveBeenLastCalledWith([
        { kit_id: 'kit-new', asset_id: 'u4', quantity: 1 },
        { kit_id: 'kit-new', asset_id: 'u5', quantity: 1 },
        { kit_id: 'kit-new', asset_id: 'u6', quantity: 10 },
      ]);
    });

    it('marks only the failed purchase’s rows failed, and goes on with the next', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: null, error: { message: 'The 2024 tax year is locked (filed), so no purchases can be added to it.' } })
        .mockResolvedValueOnce({ data: { id: 'h2', line_ids: ['l1'], unit_ids: [] }, error: null });

      const expense = { label: 'Purchase on 2025-11-04 from Amazon', header, items: [lineOf('Tape', 1)], units: [], unitKits: [], rowIndexes: [5, 6] };
      const result = await importPurchases('org-1', { purchases: [micPurchase, expense] });

      expect(result.results).toEqual([
        { rowIndexes: [2, 3, 4], status: 'failed', error: 'The 2024 tax year is locked (filed), so no purchases can be added to it.' },
        { rowIndexes: [5, 6], status: 'success' },
      ]);
      expect(result.successCount).toBe(2);
      expect(result.errors).toEqual(['Purchase on 2025-11-03 from Sweetwater: The 2024 tax year is locked (filed), so no purchases can be added to it.']);
    });

    it('reports a purchase that saved but whose kit lines didn’t', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: { id: 'h1', line_ids: ['l1', 'l2'], unit_ids: ['u1', 'u2', 'u3'] }, error: null });
      (getKitOptions as any).mockResolvedValue([{ id: 'kit-1', name: 'Mic Kit 1' }]);
      (addKitAssetLines as any).mockRejectedValueOnce(new Error('permission denied'));

      const result = await importPurchases('org-1', { purchases: [micPurchase] });

      const warning = 'Purchase on 2025-11-03 from Sweetwater was saved, but its equipment wasn’t added to kit Mic Kit 1 (permission denied). Add it in the kit editor.';
      expect(result.results).toEqual([{ rowIndexes: [2, 3, 4], status: 'success', warning }]);
      expect(result.errors).toEqual([warning]);
    });
  });

  describe('trackPurchaseLineAsEquipment (#183, #226 item 12)', () => {
    it('makes one lot of the line’s quantity through add_purchase_line_units, not the old single-record function', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({
        data: { id: 'line-1', organization_id: 'org-1', quantity: 3, description: 'XLR Cable 25 ft', category: 'Cables', asset_id: null }, error: null,
      }));
      mockSupabase.rpc.mockResolvedValue({ data: ['lot-1'], error: null });

      expect(await trackPurchaseLineAsEquipment('line-1')).toBe('lot-1');
      expect(mockSupabase.rpc).toHaveBeenCalledWith('add_purchase_line_units', {
        p_line_id: 'line-1',
        p_units: [{
          organization_id: 'org-1', manufacturer_model: 'XLR Cable 25 ft', category: 'Cables', description: 'XLR Cable 25 ft',
          serial_number: null, tag_number: null, quantity: 3,
        }],
      });
      expect(mockSupabase.rpc).not.toHaveBeenCalledWith('track_purchase_line_as_equipment', expect.anything());
    });

    it('refuses a line that is already tracked', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({
        data: { id: 'line-1', organization_id: 'org-1', quantity: 1, description: 'Mixer', category: 'Audio', asset_id: 'a-1' }, error: null,
      }));
      await expect(trackPurchaseLineAsEquipment('line-1')).rejects.toThrow('This line is already tracked as equipment');
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe('deletePurchase', () => {
    it('deletes a purchase and returns success', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: [{ id: 'p1' }], error: null }));
      const result = await deletePurchase('p1');
      expect(result).toEqual({ success: true });
    });

    it('throws when no row was deleted (RLS denied)', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: [], error: null }));
      await expect(deletePurchase('p1')).rejects.toThrow(/permission|not found/i);
    });
  });

  // B2: what a delete takes with it, for the confirm.
  describe('getLinkedGigExpenses', () => {
    it('counts the gig expenses linked to the purchase and its lines, their gigs and amount', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: [
        { gig_id: 'g1', amount: 40, amount_settled: 40 },
        { gig_id: 'g1', amount: 20.5, amount_settled: null },
        { gig_id: 'g2', amount: 10, amount_settled: 12 },
      ], error: null }));
      const r = await getLinkedGigExpenses(['h1', 'l1', 'l2']);
      expect(mockSupabase.from).toHaveBeenCalledWith('gig_financials');
      expect(mockSupabase.in).toHaveBeenCalledWith('purchase_id', ['h1', 'l1', 'l2']);
      expect(r).toEqual({ entries: 3, gigs: 2, amount: 72.5 });
    });

    it('reads nothing for no purchases', async () => {
      expect(await getLinkedGigExpenses([])).toEqual({ entries: 0, gigs: 0, amount: 0 });
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  describe('computeAssetFieldChanges', () => {
    const asset = {
      manufacturer_model: 'SM58',
      description: 'SM58',
      category: 'Audio',
      quantity: 1,
      item_price: 100,
      item_cost: 105,
      vendor: 'Sweetwater',
      acquisition_date: '2024-01-01',
    };

    it('returns no changes when the line matches the asset', () => {
      const changes = computeAssetFieldChanges(
        { description: 'SM58', category: 'Audio', quantity: 1, item_price: 100, item_cost: 105, vendor: 'Sweetwater', purchase_date: '2024-01-01' },
        asset
      );
      expect(changes).toEqual([]);
    });

    it('detects a quantity change (the bundle-of-2 case)', () => {
      const changes = computeAssetFieldChanges({ quantity: 2 }, asset);
      expect(changes).toEqual([{ field: 'quantity', label: 'Quantity', from: 1, to: 2 }]);
    });

    it('maps description to both manufacturer_model and description', () => {
      const changes = computeAssetFieldChanges({ description: 'SM58 Beta' }, asset);
      expect(changes.map(c => c.field)).toEqual(['manufacturer_model', 'description']);
      expect(changes.every(c => c.to === 'SM58 Beta')).toBe(true);
    });

    it('maps purchase_date to acquisition_date', () => {
      const changes = computeAssetFieldChanges({ purchase_date: '2024-06-01' }, asset);
      expect(changes).toEqual([{ field: 'acquisition_date', label: 'Acquisition Date', from: '2024-01-01', to: '2024-06-01' }]);
    });

    it('treats empty string and null as equal (no spurious change)', () => {
      const changes = computeAssetFieldChanges({ category: '' }, { ...asset, category: null });
      expect(changes).toEqual([]);
    });

    it('ignores fields not present on the line snapshot', () => {
      const changes = computeAssetFieldChanges({ item_price: 100 }, asset);
      expect(changes).toEqual([]);
    });
  });
});

describe('purchase → gig ledger lifecycle', () => {
  const mockedGetByPurchase = getGigFinancialsByPurchaseId as unknown as ReturnType<typeof vi.fn>;
  const mockedCreate = createGigFinancial as unknown as ReturnType<typeof vi.fn>;
  const mockedUpdate = updateGigFinancial as unknown as ReturnType<typeof vi.fn>;
  const mockedDelete = deleteGigFinancial as unknown as ReturnType<typeof vi.fn>;

  const line = (over: Partial<any> = {}) => ({
    id: 'line-1',
    row_type: 'item',
    line_cost: 200,
    item_cost: null,
    line_amount: null,
    item_price: null,
    quantity: null,
    purchase_date: '2026-02-01',
    description: 'Van rental',
    vendor: 'U-Haul',
    category: 'Travel',
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('purchaseLineLedgerAmount', () => {
    it('uses line_cost (burdened total) first — even when a price is also present', () => {
      expect(purchaseLineLedgerAmount({
        line_cost: 66.73, item_cost: 66.73, line_amount: 60, item_price: 60, quantity: 1,
      })).toBe(66.73);
    });
    it('falls back to item_cost × quantity when line_cost is null', () => {
      expect(purchaseLineLedgerAmount({
        line_cost: null, item_cost: 25, line_amount: null, item_price: null, quantity: 4,
      })).toBe(100);
    });
    it('records the pre-fee price only when no cost is stored', () => {
      expect(purchaseLineLedgerAmount({
        line_cost: null, item_cost: null, line_amount: 200, item_price: 5, quantity: 3,
      })).toBe(200);
      expect(purchaseLineLedgerAmount({
        line_cost: null, item_cost: null, line_amount: null, item_price: 5, quantity: 3,
      })).toBe(15);
    });
    it('does not return $0 for a scanned "cost" expense line (regression)', () => {
      // line_amount / item_price are null on imported/scanned expenses; the value
      // lives in line_cost. The old logic recorded $0 here.
      expect(purchaseLineLedgerAmount({
        line_cost: 66.73, item_cost: null, line_amount: null, item_price: null, quantity: 1,
      })).toBe(66.73);
    });
    it('treats a missing quantity as 1', () => {
      expect(purchaseLineLedgerAmount({
        line_cost: null, item_cost: null, line_amount: null, item_price: 7, quantity: null,
      })).toBe(7);
    });
    it('is 0-safe when the line carries no amount at all', () => {
      expect(purchaseLineLedgerAmount({
        line_cost: null, item_cost: null, line_amount: null, item_price: null, quantity: null,
      })).toBe(0);
    });
  });

  describe('buildPurchaseLineLedgerPayload', () => {
    it('builds a paid money-out payload linked to the purchase line', () => {
      const payload = buildPurchaseLineLedgerPayload(line(), 'gig-1', 'org-1');
      expect(payload).toMatchObject({
        gig_id: 'gig-1',
        organization_id: 'org-1',
        date: '2026-02-01',
        amount: 200,
        direction: 'out',
        stage: 'paid',
        description: 'Van rental',
        purchase_id: 'line-1',
      });
      expect(payload.paid_at).toBeTruthy();
    });
  });

  describe('buildPurchaseLineLedgerPayload fallback date (#93)', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('uses today in the given time zone when the line has no purchase date', () => {
      // 8 PM Pacific on March 14 is already March 15 in UTC.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-03-15T03:00:00.000Z'));
      const payload = buildPurchaseLineLedgerPayload(line({ purchase_date: null }), 'gig-1', 'org-1', 'America/Los_Angeles');
      expect(payload.date).toBe('2026-03-14');
    });

    it('keeps the purchase date when there is one', () => {
      const payload = buildPurchaseLineLedgerPayload(line(), 'gig-1', 'org-1', 'Asia/Tokyo');
      expect(payload.date).toBe('2026-02-01');
    });
  });

  describe('createLedgerEntryForPurchaseLine fallback date (#93)', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('looks up the gig\'s time zone for a line with no purchase date', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-03-15T03:00:00.000Z'));
      const gigQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { timezone: 'America/Los_Angeles' }, error: null }),
      };
      (createClient as any).mockReturnValue({ from: vi.fn().mockReturnValue(gigQuery) });
      mockedGetByPurchase.mockResolvedValue([]);
      mockedCreate.mockResolvedValue({ id: 'fin-1' });

      await createLedgerEntryForPurchaseLine(line({ purchase_date: null }), 'gig-1', 'org-1');

      expect(gigQuery.eq).toHaveBeenCalledWith('id', 'gig-1');
      expect(mockedCreate.mock.calls[0][0].date).toBe('2026-03-14');
    });
  });

  describe('createLedgerEntryForPurchaseLine — dedup guard', () => {
    it('creates a ledger row when the line has none', async () => {
      mockedGetByPurchase.mockResolvedValue([]);
      mockedCreate.mockResolvedValue({ id: 'fin-1', gig_id: 'gig-1', purchase_id: 'line-1', amount: 200 });

      const res = await createLedgerEntryForPurchaseLine(line(), 'gig-1', 'org-1');

      expect(mockedCreate).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ created: true, financial: { id: 'fin-1', gig_id: 'gig-1', purchase_id: 'line-1', amount: 200 } });
    });

    it('does NOT create a second row when one already exists (double-count guard)', async () => {
      mockedGetByPurchase.mockResolvedValue([{ id: 'fin-1', gig_id: 'gig-1', purchase_id: 'line-1', amount: 200 }]);

      const res = await createLedgerEntryForPurchaseLine(line(), 'gig-1', 'org-1');

      expect(mockedCreate).not.toHaveBeenCalled();
      expect(res.created).toBe(false);
      expect(res.financial.id).toBe('fin-1');
    });

    it('realigns an existing row that sits on a different gig instead of creating a new one', async () => {
      mockedGetByPurchase.mockResolvedValue([{ id: 'fin-1', gig_id: 'gig-OLD', purchase_id: 'line-1', amount: 200 }]);
      mockedUpdate.mockResolvedValue({ id: 'fin-1', gig_id: 'gig-1', purchase_id: 'line-1', amount: 200 });

      const res = await createLedgerEntryForPurchaseLine(line(), 'gig-1', 'org-1');

      expect(mockedCreate).not.toHaveBeenCalled();
      expect(mockedUpdate).toHaveBeenCalledWith('fin-1', { gig_id: 'gig-1' });
      expect(res.created).toBe(false);
      expect(res.financial.gig_id).toBe('gig-1');
    });
  });

  describe('reconcileLedgerForLineGigChange', () => {
    it('is a noop for depreciated lines', async () => {
      const res = await reconcileLedgerForLineGigChange({
        item: line({ row_type: 'line', tax_treatment: 'depreciate' }), previousGigId: null, newGigId: 'gig-1', organizationId: 'org-1',
      });
      expect(res).toEqual({ action: 'noop' });
      expect(mockedGetByPurchase).not.toHaveBeenCalled();
    });

    it('reports needs-entry when a first gig link has no ledger row yet', async () => {
      mockedGetByPurchase.mockResolvedValue([]);
      const res = await reconcileLedgerForLineGigChange({
        item: line(), previousGigId: null, newGigId: 'gig-1', organizationId: 'org-1',
      });
      expect(res).toEqual({ action: 'needs-entry', gigId: 'gig-1' });
    });

    it('reports exists (no duplicate) when a ledger row already covers the target gig', async () => {
      mockedGetByPurchase.mockResolvedValue([{ id: 'fin-1', gig_id: 'gig-1', amount: 200 }]);
      const res = await reconcileLedgerForLineGigChange({
        item: line(), previousGigId: null, newGigId: 'gig-1', organizationId: 'org-1',
      });
      expect(res).toEqual({ action: 'exists', financialIds: ['fin-1'] });
      expect(mockedCreate).not.toHaveBeenCalled();
    });

    it('MOVES the stranded ledger row when a line is reassigned from gig A to gig B', async () => {
      mockedGetByPurchase.mockResolvedValue([{ id: 'fin-1', gig_id: 'gig-A', amount: 200 }]);
      mockedUpdate.mockResolvedValue({ id: 'fin-1', gig_id: 'gig-B' });

      const res = await reconcileLedgerForLineGigChange({
        item: line(), previousGigId: 'gig-A', newGigId: 'gig-B', organizationId: 'org-1',
      });

      expect(mockedUpdate).toHaveBeenCalledWith('fin-1', { gig_id: 'gig-B' });
      expect(res).toEqual({ action: 'moved', financialIds: ['fin-1'], toGigId: 'gig-B' });
    });

    it('moves every stranded row when the historical double-count bug left more than one', async () => {
      mockedGetByPurchase.mockResolvedValue([
        { id: 'fin-1', gig_id: 'gig-A', amount: 200 },
        { id: 'fin-2', gig_id: 'gig-A', amount: 200 },
      ]);
      mockedUpdate.mockResolvedValue({});

      const res = await reconcileLedgerForLineGigChange({
        item: line(), previousGigId: 'gig-A', newGigId: 'gig-B', organizationId: 'org-1',
      });

      expect(mockedUpdate).toHaveBeenCalledTimes(2);
      expect(res).toMatchObject({ action: 'moved', toGigId: 'gig-B' });
      expect((res as any).financialIds).toEqual(['fin-1', 'fin-2']);
    });

    it('asks the caller to confirm removal when a line is cleared of its gig', async () => {
      mockedGetByPurchase.mockResolvedValue([
        { id: 'fin-1', gig_id: 'gig-A', amount: 120 },
        { id: 'fin-2', gig_id: 'gig-A', amount: 80 },
      ]);

      const res = await reconcileLedgerForLineGigChange({
        item: line(), previousGigId: 'gig-A', newGigId: null, organizationId: 'org-1',
      });

      expect(res).toEqual({
        action: 'confirm-remove',
        financialIds: ['fin-1', 'fin-2'],
        fromGigId: 'gig-A',
        amount: 200,
      });
      expect(mockedDelete).not.toHaveBeenCalled();
    });

    it('is a noop when clearing a line that never had a ledger row', async () => {
      mockedGetByPurchase.mockResolvedValue([]);
      const res = await reconcileLedgerForLineGigChange({
        item: line(), previousGigId: 'gig-A', newGigId: null, organizationId: 'org-1',
      });
      expect(res).toEqual({ action: 'noop' });
    });
  });

  describe('removeLedgerEntriesForPurchaseLine', () => {
    it('deletes each linked ledger entry', async () => {
      mockedDelete.mockResolvedValue({ success: true });
      const res = await removeLedgerEntriesForPurchaseLine(['fin-1', 'fin-2']);
      expect(mockedDelete).toHaveBeenCalledTimes(2);
      expect(mockedDelete).toHaveBeenNthCalledWith(1, 'fin-1');
      expect(mockedDelete).toHaveBeenNthCalledWith(2, 'fin-2');
      expect(res).toEqual({ removed: 2 });
    });
  });
});

// #133: gig links follow the tax treatment, not the row type.
describe('gig links and tax treatment (#133)', () => {
  const mockSupabase: any = { from: vi.fn(() => mockSupabase), select: vi.fn(() => mockSupabase), eq: vi.fn(() => mockSupabase), update: vi.fn(() => mockSupabase), single: vi.fn(() => mockSupabase), then: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    (createClient as any).mockReturnValue(mockSupabase);
    (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });
  });

  it('an expensed equipment line gets a gig ledger entry; a depreciated one never does', async () => {
    vi.mocked(getGigFinancialsByPurchaseId).mockResolvedValue([]);
    const base = { id: 'l1', line_cost: 40, item_cost: 40, line_amount: 40, item_price: 40, quantity: 1, purchase_date: '2026-03-01', description: 'Stand', vendor: 'V', category: null } as any;
    expect(await reconcileLedgerForLineGigChange({ item: { ...base, row_type: 'asset', tax_treatment: 'expense' }, previousGigId: null, newGigId: 'g1', organizationId: 'o' }))
      .toEqual({ action: 'needs-entry', gigId: 'g1' });
    expect(await reconcileLedgerForLineGigChange({ item: { ...base, row_type: 'asset', tax_treatment: 'depreciate' }, previousGigId: null, newGigId: 'g1', organizationId: 'o' }))
      .toEqual({ action: 'noop' });
  });
});

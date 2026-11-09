import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderHookWithQuery as renderHook } from '../../financials/renderHookWithQuery';
import { usePurchaseForEdit, useReviewMutations, useReviewReferenceData } from './useReviewScannedData';
import { queryKeys } from '../../../lib/queryKeys';
import { getPurchaseWithDetails, savePurchaseEdit } from '../../../services/purchase.service';
import { getGigFinancials } from '../../../services/gig.service';
import { getAttachmentUrl } from '../../../services/attachment.service';

vi.mock('../../../services/purchase.service', () => ({
  createPurchaseWithUnits: vi.fn(async () => ({ id: 'p-new', line_ids: [], unit_ids: [] })),
  getPurchaseWithDetails: vi.fn(),
  savePurchaseEdit: vi.fn(async () => {}),
}));
vi.mock('../../../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn(async () => new Set([2025])) }));
vi.mock('../../../services/gig.service', () => ({ getGigFinancials: vi.fn(async () => []) }));
vi.mock('../../../services/attachment.service', () => ({ getAttachmentUrl: vi.fn(async () => 'https://files.test/doc.pdf') }));
vi.mock('../../../services/equipmentItem.service', () => ({ getItems: vi.fn(async () => [{ id: 'it1', manufacturer_model: 'M', category: 'Audio' }]) }));
vi.mock('../../../services/purchaseCategory.service', () => ({
  getExpenseCategories: vi.fn(async () => [{ name: 'Supplies', schedule_c_line: '22' }]),
  getEquipmentCategories: vi.fn(async () => ['Audio']),
  getEquipmentCategoryPeriods: vi.fn(async () => ({ audio: 7 })),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const details = (vendor: string) => ({
  id: 'h1', vendor, gig_id: null, items: [{ id: 'l1', gig_id: 'g1' }, { id: 'l2', gig_id: 'g1' }],
  attachments: [{ file_path: 'p/doc.pdf', file_name: 'doc.pdf' }],
});

describe('usePurchaseForEdit (A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPurchaseWithDetails).mockResolvedValue(details('Stored') as any);
  });

  it('reads the purchase, its gig ledger rows by line (each gig once) and its document', async () => {
    vi.mocked(getGigFinancials).mockResolvedValueOnce([{ id: 'f1', purchase_id: 'l1' }, { id: 'f2', purchase_id: null }] as any);
    const { result } = renderHook(() => usePurchaseForEdit('h1', 'org-1', true));
    await waitFor(() => expect(result.current.fresh).not.toBeNull());
    expect(getGigFinancials).toHaveBeenCalledTimes(1);
    expect(getGigFinancials).toHaveBeenCalledWith('g1', 'org-1');
    expect(result.current.fresh!.ledgerByPurchaseId).toEqual({ l1: { id: 'f1', purchase_id: 'l1' } });
    expect(result.current.fresh!.existingDoc).toEqual({ url: 'https://files.test/doc.pdf', kind: 'pdf', name: 'doc.pdf' });
  });

  it('a failed document link or ledger read still opens the purchase', async () => {
    vi.mocked(getGigFinancials).mockRejectedValueOnce(new Error('no'));
    vi.mocked(getAttachmentUrl).mockRejectedValueOnce(new Error('no'));
    const { result } = renderHook(() => usePurchaseForEdit('h1', 'org-1', true));
    await waitFor(() => expect(result.current.fresh).not.toBeNull());
    expect(result.current.fresh!.existingDoc).toBeNull();
    expect(result.current.fresh!.ledgerByPurchaseId).toEqual({});
  });

  it('reads nothing while closed; opened again, it gives only the purchase as read now, never the earlier copy', async () => {
    const { result, rerender } = renderHook((open: boolean) => usePurchaseForEdit('h1', 'org-1', open), { initialProps: true });
    await waitFor(() => expect(result.current.fresh?.details.vendor).toBe('Stored'));
    rerender(false);
    expect(getPurchaseWithDetails).toHaveBeenCalledTimes(1);
    let resolve!: (v: any) => void;
    vi.mocked(getPurchaseWithDetails).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    rerender(true);
    expect(result.current.fresh).toBeNull();
    resolve(details('Saved since'));
    await waitFor(() => expect(result.current.fresh?.details.vendor).toBe('Saved since'));
  });
});

describe('usePurchaseForEdit: a form\'s query (A10, #402)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPurchaseWithDetails).mockResolvedValue(details('Stored') as any);
  });

  it('keeps no copy once the editor is gone (gcTime 0), so an open never starts from a cached one', async () => {
    const { result, unmount, queryClient } = renderHook(() => usePurchaseForEdit('h1', 'org-1', true));
    await waitFor(() => expect(result.current.fresh).not.toBeNull());
    unmount();
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.purchaseForEdit('h1', 'org-1'))).toBeUndefined());
  });

  it('says when each load landed, and refetch reads the purchase again', async () => {
    const { result } = renderHook(() => usePurchaseForEdit('h1', 'org-1', true));
    await waitFor(() => expect(result.current.fresh).not.toBeNull());
    const first = result.current.dataUpdatedAt;
    expect(first).toBeGreaterThan(0);
    vi.mocked(getPurchaseWithDetails).mockResolvedValue(details('Saved since') as any);
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); await result.current.refetch(); });
    await waitFor(() => expect(result.current.fresh?.details.vendor).toBe('Saved since'));
    expect(result.current.dataUpdatedAt).toBeGreaterThan(first);
  });
});

describe('useReviewMutations (A10)', () => {
  beforeEach(() => vi.clearAllMocks());
  const invalidated = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0].queryKey);

  it('a new purchase on a gig refreshes that gig\'s money, the reports, equipment and the dashboard, not the Purchases report', async () => {
    const { result, queryClient } = renderHook(() => useReviewMutations('org-1'));
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(() => result.current.createPurchase.mutateAsync({ header: {}, items: [], units: [], gigLink: { gigId: 'g1', ledger: [] } }));
    expect(invalidated(spy)).toEqual([['purchase', 'p-new'], ['taxReport', 'org-1'], ['gigs', 'org-1', 'accounting'], ['assets', 'org-1'], ['dashboard', 'org-1'], ['financials', 'g1'], ['gigFinancialsSummary', 'g1'], ['gigProjectedStaff', 'g1']]);
  });

  it('an edit refreshes the purchase as the editor reads it; every gig\'s money when it changed some', async () => {
    const { result, queryClient } = renderHook(() => useReviewMutations('org-1'));
    queryClient.setQueryData(queryKeys.purchaseForEdit('h1', 'org-1'), { details: {}, ledgerByPurchaseId: {}, existingDoc: null });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const plan: any = { equipment: [], header: {}, track_lines: [], updated_items: [], new_items: [], add_units: [], removed_item_ids: [], asset_changes: [], gig_changes: [{ fin_id: 'f1', amount: 1, settle: false }] };
    await act(() => result.current.saveEdit.mutateAsync({ purchaseId: 'h1', plan }));
    expect(savePurchaseEdit).toHaveBeenCalledWith('h1', plan);
    expect(invalidated(spy)).toEqual([['purchase', 'h1'], ['taxReport', 'org-1'], ['gigs', 'org-1', 'accounting'], ['assets', 'org-1'], ['dashboard', 'org-1'], ['financials'], ['gigFinancialsSummary'], ['gigProjectedStaff']]);
    expect(queryClient.getQueryState(queryKeys.purchaseForEdit('h1', 'org-1'))?.isInvalidated).toBe(true);
  });
});

describe('useReviewReferenceData (A10)', () => {
  it('reads the organization\'s lists only while open', async () => {
    const { result, rerender } = renderHook((open: boolean) => useReviewReferenceData('org-1', open), { initialProps: false });
    expect(result.current.equipmentCats).toEqual([]);
    rerender(true);
    await waitFor(() => expect(result.current.itemOptions).toHaveLength(1));
    expect(result.current.lockedYears.has(2025)).toBe(true);
    expect(result.current.expenseCats).toEqual([{ name: 'Supplies', schedule_c_line: '22' }]);
    expect(result.current.equipmentCats).toEqual(['Audio']);
    expect(result.current.categoryPeriods).toEqual({ audio: 7 });
    expect(result.current.itemOptions[0]).toEqual({ id: 'it1', manufacturer_model: 'M', category: 'Audio', type: null, insurance_class: null, description: null });
  });
});

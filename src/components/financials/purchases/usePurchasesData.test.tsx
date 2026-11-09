import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderHookWithQuery as renderHook } from '../renderHookWithQuery';
import { usePurchasesReport, usePurchasesMutations, useLinkedGigExpenses, useGigNames } from './usePurchasesData';
import { queryKeys } from '../../../lib/queryKeys';
import { getPurchases, setPurchaseLineGig, getLinkedGigExpenses, deletePurchase } from '../../../services/purchase.service';
import { getEntityAttachments, uploadAttachment, linkAttachmentToEntity } from '../../../services/attachment.service';
import { getPurchaseIdsWithLedgerEntry, getGigOptionsForOrganization } from '../../../services/gig.service';
import { toast } from 'sonner';

vi.mock('../../../services/purchase.service', () => ({
  getPurchases: vi.fn(),
  trackPurchaseLineAsEquipment: vi.fn(async () => 'a-new'),
  deletePurchase: vi.fn(async () => {}),
  setPurchaseLineGig: vi.fn(async () => ({ action: 'needs-entry' })),
  createLedgerEntryForPurchaseLine: vi.fn(async () => ({ created: true })),
  getLinkedGigExpenses: vi.fn(),
}));
vi.mock('../../../services/attachment.service', () => ({
  getEntityAttachments: vi.fn(async () => []),
  uploadAttachment: vi.fn(),
  linkAttachmentToEntity: vi.fn(async () => {}),
}));
vi.mock('../../../services/gig.service', () => ({
  getGigOptionsForOrganization: vi.fn(async () => []),
  getGigFinancialsByPurchaseId: vi.fn(async () => []),
  getPurchaseIdsWithLedgerEntry: vi.fn(async () => new Set()),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const rows = [
  { id: 'h1', row_type: 'header', vendor: 'V' },
  { id: 'i1', row_type: 'item', parent_id: 'h1', gig_id: 'g1', tax_treatment: 'expense' },
  { id: 'i2', row_type: 'item', parent_id: 'h1', gig_id: null, tax_treatment: 'expense' },
];

describe('usePurchasesReport (A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPurchases).mockResolvedValue(rows as any);
  });

  it('reads the purchases, which gig-linked expense lines are in a ledger, and each purchase\'s first document', async () => {
    vi.mocked(getPurchaseIdsWithLedgerEntry).mockResolvedValueOnce(new Set(['i1']));
    vi.mocked(getEntityAttachments).mockResolvedValueOnce([{ file_path: 'p/h1.pdf', file_name: 'h1.pdf' }] as any);
    const { result, queryClient } = renderHook(() => usePurchasesReport('org-1'));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.report.purchases).toHaveLength(3);
    expect(getPurchaseIdsWithLedgerEntry).toHaveBeenCalledWith(['i1']);
    expect(result.current.report.linesWithLedger.has('i1')).toBe(true);
    expect(result.current.report.headerAttachments.get('h1')).toEqual({ filePath: 'p/h1.pdf', fileName: 'h1.pdf' });
    expect(queryClient.getQueryData(queryKeys.purchasesReport('org-1'))).toBe(result.current.report);
  });

  it('is read again on every visit (staleTime 0), showing the cached report meanwhile', async () => {
    const first = renderHook(() => usePurchasesReport('org-1'));
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    first.unmount();
    const again = renderHook(() => usePurchasesReport('org-1'), { queryClient: first.queryClient });
    expect(again.result.current.isLoading).toBe(false);
    expect(again.result.current.report.purchases).toHaveLength(3);
    await waitFor(() => expect(getPurchases).toHaveBeenCalledTimes(2));
  });

  it('reports a failed read once', async () => {
    vi.mocked(getPurchases).mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(() => usePurchasesReport('org-1'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    rerender();
    rerender();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(result.current.report.purchases).toEqual([]);
  });

  it('names gigs by id', async () => {
    vi.mocked(getGigOptionsForOrganization).mockResolvedValueOnce([{ id: 'g1', title: 'Gig One' }] as any);
    const { result } = renderHook(() => useGigNames('org-1'));
    await waitFor(() => expect(result.current.get('g1')).toBe('Gig One'));
  });

  it('reads the gig expenses a delete would remove only while asked, null until read', async () => {
    let resolve!: (v: any) => void;
    vi.mocked(getLinkedGigExpenses).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { result, rerender } = renderHook((ids: string[] | null) => useLinkedGigExpenses('org-1', ids), { initialProps: null as string[] | null });
    expect(result.current).toBeNull();
    expect(getLinkedGigExpenses).not.toHaveBeenCalled();
    rerender(['h1', 'i1']);
    expect(result.current).toBeNull();
    resolve({ entries: 1, gigs: 1, amount: 5 });
    await waitFor(() => expect(result.current).toEqual({ entries: 1, gigs: 1, amount: 5 }));
    expect(getLinkedGigExpenses).toHaveBeenCalledWith(['h1', 'i1']);
  });
});

describe('usePurchasesMutations (A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPurchases).mockResolvedValue(rows as any);
  });

  const setup = () => {
    const hook = renderHook(() => ({ report: usePurchasesReport('org-1'), m: usePurchasesMutations('org-1') }));
    const invalidate = vi.spyOn(hook.queryClient, 'invalidateQueries');
    return { ...hook, invalidate };
  };
  const invalidated = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0].queryKey);

  it('moving a line to another gig refreshes the report, the tax report, Gig Accounting, the dashboard and both gigs\' money, and the report is read again', async () => {
    const { result, invalidate } = setup();
    await waitFor(() => expect(result.current.report.isLoading).toBe(false));
    await act(() => result.current.m.setLineGig.mutateAsync({ item: rows[1] as any, gigId: 'g2' }));
    expect(setPurchaseLineGig).toHaveBeenCalledWith(rows[1], 'g2', undefined);
    expect(invalidated(invalidate)).toEqual(expect.arrayContaining([
      ['purchases', 'org-1'], ['taxReport', 'org-1'], ['gigs', 'org-1', 'accounting'], ['dashboard', 'org-1'],
      ['financials', 'g1'], ['financials', 'g2'], ['gigFinancialsSummary', 'g1'], ['gigFinancialsSummary', 'g2'],
    ]));
    expect(getPurchases).toHaveBeenCalledTimes(2);
  });

  it('clearing a line\'s gig with its ledger entry asks the one call to remove the entries', async () => {
    const { result } = setup();
    await act(() => result.current.m.setLineGig.mutateAsync({ item: rows[1] as any, gigId: null, removeEntries: true }));
    expect(setPurchaseLineGig).toHaveBeenCalledWith(rows[1], null, { removeEntries: true });
  });

  it('deleting a purchase refreshes every gig\'s money (its expenses go with it)', async () => {
    const { result, invalidate } = setup();
    await act(() => result.current.m.removePurchase.mutateAsync('h1'));
    expect(deletePurchase).toHaveBeenCalledWith('h1');
    expect(invalidated(invalidate)).toEqual(expect.arrayContaining([['purchases', 'org-1'], ['financials'], ['gigFinancialsSummary']]));
  });

  it('a failed write refreshes nothing', async () => {
    vi.mocked(deletePurchase).mockRejectedValueOnce(new Error('no'));
    const { result, invalidate } = setup();
    await act(async () => { await expect(result.current.m.removePurchase.mutateAsync('h1')).rejects.toThrow('no'); });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('attaching a document shows it on the cached report straight away', async () => {
    vi.mocked(uploadAttachment).mockResolvedValueOnce({ id: 'att-1', file_path: 'p/new.pdf', file_name: 'new.pdf' } as any);
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.report.isLoading).toBe(false));
    await act(() => result.current.m.attachDocument.mutateAsync({ headerId: 'h1', file: new File(['x'], 'new.pdf') }));
    expect(linkAttachmentToEntity).toHaveBeenCalledWith('att-1', 'purchase', 'h1');
    expect((queryClient.getQueryData(queryKeys.purchasesReport('org-1')) as any).headerAttachments.get('h1'))
      .toEqual({ filePath: 'p/new.pdf', fileName: 'new.pdf' });
    expect(getPurchases).toHaveBeenCalledTimes(1);
  });
});

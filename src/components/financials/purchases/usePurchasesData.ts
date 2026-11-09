import { useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys, invalidateAfterPurchaseChange, invalidateAfterPurchaseDocumentChange } from '../../../lib/queryKeys';
import type { DbPurchase } from '../../../utils/supabase/types';
import { lineTaxTreatment } from '../../../utils/taxTreatment';
import {
  getPurchases,
  trackPurchaseLineAsEquipment,
  deletePurchase,
  getLinkedGigExpenses,
  setPurchaseLineGig,
  createLedgerEntryForPurchaseLine,
} from '../../../services/purchase.service';
import { getEntityAttachments, uploadAttachment, linkAttachmentToEntity } from '../../../services/attachment.service';
import { getGigOptionsForOrganization, getGigFinancialsByPurchaseId, getPurchaseIdsWithLedgerEntry } from '../../../services/gig.service';

export type HeaderAttachment = { filePath: string; fileName: string };

/** What the Purchases report shows: the purchases, the lines already in a gig ledger, and each purchase's first document. */
export interface PurchasesReport {
  purchases: DbPurchase[];
  /** Expense lines linked to a gig that already have their ledger entry. */
  linesWithLedger: Set<string>;
  headerAttachments: Map<string, HeaderAttachment>;
}

const EMPTY_REPORT: PurchasesReport = { purchases: [], linesWithLedger: new Set(), headerAttachments: new Map() };

export async function loadPurchasesReport(organizationId: string): Promise<PurchasesReport> {
  const purchases = await getPurchases(organizationId);
  const gigLinkedItemIds = purchases
    .filter((p: DbPurchase) => lineTaxTreatment(p) === 'expense' && p.gig_id)
    .map((p: DbPurchase) => p.id);
  const linesWithLedger = await getPurchaseIdsWithLedgerEntry(gigLinkedItemIds);
  const headerAttachments = new Map<string, HeaderAttachment>();
  await Promise.all(purchases.filter((p: DbPurchase) => p.row_type === 'header').map(async (h: DbPurchase) => {
    try {
      const atts = await getEntityAttachments('purchase', h.id);
      if (atts && atts.length > 0) headerAttachments.set(h.id, { filePath: atts[0].file_path, fileName: atts[0].file_name });
    } catch (_) { /* a purchase without a readable document just shows Attach Doc */ }
  }));
  return { purchases, linesWithLedger, headerAttachments };
}

/** The Purchases report (A10). Read again on each visit; a failed read is reported once. */
export function usePurchasesReport(organizationId: string) {
  const query = useQuery({
    queryKey: queryKeys.purchasesReport(organizationId),
    queryFn: () => loadPurchasesReport(organizationId),
    staleTime: 0,
  });
  const { error, errorUpdatedAt } = query;
  useEffect(() => {
    if (!error) return;
    console.error('Error loading purchases:', error);
    toast.error('Failed to load purchases');
  }, [error, errorUpdatedAt]);
  const { refetch } = query;
  const reload = useCallback(() => { void refetch(); }, [refetch]);
  return {
    report: query.data ?? EMPTY_REPORT,
    isLoading: query.isPending,
    isError: query.isError,
    error: error ? ((error as Error).message || 'Failed to load purchases') : null,
    reload,
  };
}

/** Gig titles by id, for the summary view. A failed read leaves the names out. */
export function useGigNames(organizationId: string) {
  const query = useQuery({
    queryKey: queryKeys.gigOptions(organizationId),
    queryFn: () => getGigOptionsForOrganization(organizationId),
    staleTime: 0,
  });
  const gigs = query.data;
  return useMemo(() => new Map((gigs ?? []).map((g) => [g.id, g.title] as const)), [gigs]);
}

/** The gig expenses a delete would remove with it (B2), for its confirm; null until read. */
export function useLinkedGigExpenses(organizationId: string, purchaseIds: string[] | null) {
  const query = useQuery({
    queryKey: queryKeys.purchaseLinkedGigExpenses(organizationId, purchaseIds ?? []),
    queryFn: () => getLinkedGigExpenses(purchaseIds ?? []),
    enabled: !!purchaseIds,
    staleTime: 0,
  });
  const { error } = query;
  useEffect(() => {
    if (error) console.error('Could not read the linked gig expenses:', error);
  }, [error]);
  return purchaseIds && query.isSuccess && !query.isFetching ? query.data : null;
}

/**
 * The report's writes (A10). Each refreshes what it changed (invalidateAfterPurchaseChange);
 * the screen keeps its own toasts, confirms and the 'gig-financials-updated' event.
 */
export function usePurchasesMutations(organizationId: string) {
  const queryClient = useQueryClient();
  const written = (gigIds: (string | null | undefined)[] = [], allGigs = false) =>
    invalidateAfterPurchaseChange(queryClient, { organizationId, gigIds, allGigs });

  const trackAsEquipment = useMutation({
    mutationFn: (itemId: string) => trackPurchaseLineAsEquipment(itemId),
    // Not waited for: the button frees up as soon as the line is tracked, as before.
    onSuccess: () => { void written(); },
  });

  const setLineGig = useMutation({
    mutationFn: (vars: { item: DbPurchase; gigId: string | null; removeEntries?: boolean }) =>
      setPurchaseLineGig(vars.item, vars.gigId, vars.removeEntries ? { removeEntries: true } : undefined),
    onSuccess: (_res, vars) => written([vars.item.gig_id, vars.gigId]),
  });

  const createLedgerEntry = useMutation({
    mutationFn: (vars: { item: DbPurchase; gigId: string }) =>
      createLedgerEntryForPurchaseLine(vars.item, vars.gigId, organizationId),
    onSuccess: (_res, vars) => written([vars.gigId]),
  });

  const removePurchase = useMutation({
    mutationFn: (purchaseId: string) => deletePurchase(purchaseId),
    onSuccess: () => written([], true),
  });

  // The new document shows at once (setQueryData), as it did before the report was cached.
  const attachDocument = useMutation({
    mutationFn: async (vars: { headerId: string; file: File }) => {
      const attachment = await uploadAttachment(organizationId, vars.file);
      await linkAttachmentToEntity(attachment.id, 'purchase', vars.headerId);
      return attachment;
    },
    onSuccess: (attachment, vars) => {
      queryClient.setQueryData<PurchasesReport>(queryKeys.purchasesReport(organizationId), (prev) => {
        if (!prev) return prev;
        const headerAttachments = new Map(prev.headerAttachments);
        headerAttachments.set(vars.headerId, { filePath: attachment.file_path, fileName: attachment.file_name });
        return { ...prev, headerAttachments };
      });
      void invalidateAfterPurchaseDocumentChange(queryClient, vars.headerId);
    },
  });

  return {
    trackAsEquipment,
    setLineGig,
    createLedgerEntry,
    removePurchase,
    attachDocument,
    /** The gig ledger rows made from a line (asked before its gig is cleared). */
    ledgerRowsForLine: (lineId: string) => getGigFinancialsByPurchaseId(lineId),
    /** Reads the report again (after a failed write, or a purchase saved in the editor). */
    refresh: () => queryClient.invalidateQueries({ queryKey: queryKeys.purchasesReport(organizationId) }),
  };
}

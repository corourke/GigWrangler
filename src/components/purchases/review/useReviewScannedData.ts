import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys, invalidateAfterPurchaseEditorSave } from '../../../lib/queryKeys';
import {
  createPurchaseWithUnits,
  getPurchaseWithDetails,
  savePurchaseEdit,
  type PurchaseEditPlan,
} from '../../../services/purchase.service';
import { getLockedTaxYears } from '../../../services/taxYear.service';
import { getGigFinancials } from '../../../services/gig.service';
import { getAttachmentUrl } from '../../../services/attachment.service';
import { getItems } from '../../../services/equipmentItem.service';
import { getExpenseCategories, getEquipmentCategories, getEquipmentCategoryPeriods, type ExpenseCategory } from '../../../services/purchaseCategory.service';
import type { CategoryPeriods } from '../../../utils/recoveryPeriod';
import type { ItemOption } from '../../equipment/form/itemDraft';

const NO_YEARS = new Set<number>();
const NO_EXPENSE_CATS: ExpenseCategory[] = [];
const NO_CATS: string[] = [];
const NO_PERIODS: CategoryPeriods = {};
const NO_ITEMS: ItemOption[] = [];

/**
 * The organization's lists the purchase editor needs (A10): filed years (their purchases keep
 * their tax fields, #133), expense and equipment categories, each category's recovery period
 * (#125) and the items for the equipment pop-up (#183). Read while the editor is open.
 */
export function useReviewReferenceData(organizationId: string, open: boolean) {
  const enabled = open && !!organizationId;
  const lockedYears = useQuery({ queryKey: queryKeys.lockedTaxYears(organizationId), queryFn: () => getLockedTaxYears(organizationId), enabled, staleTime: 0 });
  const expenseCats = useQuery({ queryKey: queryKeys.expenseCategories(organizationId), queryFn: () => getExpenseCategories(organizationId), enabled, staleTime: 0 });
  const equipmentCats = useQuery({ queryKey: queryKeys.equipmentCategories(organizationId), queryFn: () => getEquipmentCategories(organizationId), enabled, staleTime: 0 });
  const periods = useQuery({ queryKey: queryKeys.equipmentCategoryPeriods(organizationId), queryFn: () => getEquipmentCategoryPeriods(organizationId), enabled, staleTime: 0 });
  const items = useQuery({
    queryKey: queryKeys.purchaseItemOptions(organizationId),
    queryFn: async (): Promise<ItemOption[]> => ((await getItems(organizationId)) ?? []).map((i: any) => ({
      id: i.id, manufacturer_model: i.manufacturer_model, category: i.category,
      type: i.type ?? null, insurance_class: i.insurance_class ?? null, description: i.description ?? null,
    })),
    enabled,
    staleTime: 0,
  });
  return {
    lockedYears: lockedYears.data ?? NO_YEARS,
    expenseCats: expenseCats.data ?? NO_EXPENSE_CATS,
    equipmentCats: equipmentCats.data ?? NO_CATS,
    categoryPeriods: periods.data ?? NO_PERIODS,
    itemOptions: items.data ?? NO_ITEMS,
  };
}

export type ExistingDoc = { url: string; kind: 'image' | 'pdf' | 'other'; name: string };

/** A purchase as the editor opens it: its lines and equipment, its gig ledger rows by line, and its document. */
export interface PurchaseForEdit {
  details: any;
  ledgerByPurchaseId: Record<string, any>;
  existingDoc: ExistingDoc | null;
}

export async function loadPurchaseForEdit(purchaseId: string, organizationId: string): Promise<PurchaseForEdit> {
  const details: any = await getPurchaseWithDetails(purchaseId);
  const items: any[] = details.items || [];
  // Gig ledger rows linked by purchase_id, across every distinct linked gig.
  const gigIds = Array.from(new Set([details.gig_id, ...items.map((it) => it.gig_id)].filter(Boolean))) as string[];
  const ledgerByPurchaseId: Record<string, any> = {};
  for (const gid of gigIds) {
    try {
      const rows: any[] = await getGigFinancials(gid, organizationId);
      (rows || []).forEach((r) => { if (r.purchase_id) ledgerByPurchaseId[r.purchase_id] = r; });
    } catch { /* non-fatal */ }
  }
  // The existing attached document, for the preview pane.
  let existingDoc: ExistingDoc | null = null;
  const att: any = (details.attachments || [])[0];
  if (att?.file_path) {
    try {
      const url = await getAttachmentUrl(att.file_path);
      const ext = (att.file_name || '').split('.').pop()?.toLowerCase() || '';
      const kind = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext) ? 'image' : ext === 'pdf' ? 'pdf' : 'other';
      existingDoc = { url, kind, name: att.file_name };
    } catch { /* non-fatal */ }
  }
  return { details, ledgerByPurchaseId, existingDoc };
}

/**
 * The purchase being edited (A10). It seeds an editable form, so it keeps no cached copy
 * (gcTime 0, #402): each open reads it fresh. `fresh` is the purchase as read now, null while a
 * read runs; `dataUpdatedAt` says when each load landed, for seeding the form once per load.
 * A failed read is reported once.
 */
export function usePurchaseForEdit(purchaseId: string | undefined, organizationId: string, open: boolean) {
  const query = useQuery({
    queryKey: queryKeys.purchaseForEdit(purchaseId ?? '', organizationId),
    queryFn: () => loadPurchaseForEdit(purchaseId!, organizationId),
    enabled: open && !!purchaseId,
    staleTime: 0,
    gcTime: 0,
  });
  const { error, errorUpdatedAt, refetch } = query;
  useEffect(() => {
    if (!error) return;
    console.error('Error loading purchase for edit:', error);
    toast.error('Failed to load purchase');
  }, [error, errorUpdatedAt]);
  return {
    fresh: query.isSuccess && !query.isFetching ? query.data : null,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch,
  };
}

type CreateArgs = Parameters<typeof createPurchaseWithUnits>;

/**
 * The editor's saves (A10): a new purchase in one call, and an edit in one call (B6). Each
 * refreshes the purchase, Gig Accounting and the gigs whose money it touched
 * (invalidateAfterPurchaseEditorSave); the screen showing the report reads it again itself.
 */
export function useReviewMutations(organizationId: string) {
  const queryClient = useQueryClient();

  const createPurchase = useMutation({
    mutationFn: (vars: { header: CreateArgs[0]; items: CreateArgs[1]; units: CreateArgs[2]; gigLink: CreateArgs[3] }) =>
      createPurchaseWithUnits(vars.header, vars.items, vars.units, vars.gigLink),
    onSuccess: (result, vars) => {
      void invalidateAfterPurchaseEditorSave(queryClient, { organizationId, purchaseId: result.id, gigIds: [vars.gigLink?.gigId] });
    },
  });

  const saveEdit = useMutation({
    mutationFn: (vars: { purchaseId: string; plan: PurchaseEditPlan }) => savePurchaseEdit(vars.purchaseId, vars.plan),
    onSuccess: (_res, vars) => {
      void invalidateAfterPurchaseEditorSave(queryClient, {
        organizationId, purchaseId: vars.purchaseId, allGigs: vars.plan.gig_changes.length > 0,
      });
    },
  });

  return { createPurchase, saveEdit };
}

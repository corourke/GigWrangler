import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getItem, getItems } from '../../services/equipmentItem.service';
import { getEquipmentCategories, getEquipmentCategoryPeriods } from '../../services/purchaseCategory.service';
import { getLockedTaxYears } from '../../services/taxYear.service';
import type { CategoryPeriods } from '../../utils/recoveryPeriod';
import type { ItemOption } from '../equipment/form/itemDraft';
import {
  getAsset,
  getAssetHistory,
  getAssetInventoryTracking,
  getAssetDepreciatedDate,
  createAsset,
  createAssets,
  updateAsset,
} from '../../services/asset.service';

/**
 * Server-state hooks for AssetScreen (Phase 7, Step 3).
 *
 * In edit mode the asset feeds a form (manual useState + change detection), so
 * like the gig financials section the asset query is NOT invalidated by its own
 * mutations — the form re-syncs only when the query data first arrives. The
 * read-only history/tracking tables are plain display reads.
 */
export function useAssetData(assetId: string | null | undefined) {
  const enabled = !!assetId;

  const assetQuery = useQuery({
    queryKey: queryKeys.asset(assetId ?? 'new'),
    queryFn: () => getAsset(assetId as string),
    enabled,
  });

  const inventoryTrackingQuery = useQuery({
    queryKey: queryKeys.assetInventoryTracking(assetId ?? 'new'),
    queryFn: () => getAssetInventoryTracking(assetId as string),
    enabled,
  });

  const activityQuery = useQuery({
    queryKey: queryKeys.assetActivity(assetId ?? 'new'),
    queryFn: () => getAssetHistory(assetId as string),
    enabled,
  });

  return { assetQuery, inventoryTrackingQuery, activityQuery };
}

/** Create/update mutations; invalidate the org's asset list on success. */
export function useAssetMutations(organizationId: string) {
  const queryClient = useQueryClient();
  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.assets(organizationId) });

  const createAssetMutation = useMutation({
    mutationFn: (data: Parameters<typeof createAsset>[0]) => createAsset(data),
    onSuccess: invalidateList,
  });

  const createAssetsMutation = useMutation({
    mutationFn: (rows: Parameters<typeof createAssets>[0]) => createAssets(rows),
    onSuccess: invalidateList,
  });

  const updateAssetMutation = useMutation({
    mutationFn: (vars: { id: string; data: Parameters<typeof updateAsset>[1] }) =>
      updateAsset(vars.id, vars.data),
    onSuccess: invalidateList,
  });

  return { createAsset: createAssetMutation, createAssets: createAssetsMutation, updateAsset: updateAssetMutation };
}

const toOption = (i: { id: string; manufacturer_model: string; category: string; type?: string | null; insurance_class?: string | null; description?: string | null }): ItemOption => ({
  id: i.id, manufacturer_model: i.manufacturer_model, category: i.category,
  type: i.type ?? null, insurance_class: i.insurance_class ?? null, description: i.description ?? null,
});
const NO_CATEGORIES: string[] = [];
const NO_PERIODS: CategoryPeriods = {};
const NO_ITEMS: ItemOption[] = [];
const NO_YEARS = new Set<number>();

/**
 * What the unit/lot form reads besides the record (A10): the organization's equipment
 * categories and their recovery periods, its items (shared with the purchase review), the item
 * the record belongs to or is added to, and, when editing, when the record was first depreciated
 * and the filed tax years. Failed reads leave these empty, as before.
 */
export function useAssetFormLookups(
  organizationId: string,
  { assetId, itemId }: { assetId?: string | null; itemId?: string | null },
) {
  const categories = useQuery({
    queryKey: queryKeys.equipmentCategories(organizationId),
    queryFn: () => getEquipmentCategories(organizationId),
    staleTime: 0,
  });
  const periods = useQuery({
    queryKey: queryKeys.equipmentCategoryPeriods(organizationId),
    queryFn: () => getEquipmentCategoryPeriods(organizationId),
    staleTime: 0,
  });
  const items = useQuery({
    queryKey: queryKeys.purchaseItemOptions(organizationId),
    queryFn: async (): Promise<ItemOption[]> => ((await getItems(organizationId)) ?? []).map(toOption),
    staleTime: 0,
  });
  const item = useQuery({
    queryKey: queryKeys.itemRecord(itemId ?? 'none', organizationId),
    queryFn: async () => toOption(await getItem(itemId as string)),
    enabled: !!itemId,
    staleTime: 0,
  });
  const depreciatedOn = useQuery({
    queryKey: queryKeys.assetDepreciatedOn(assetId ?? 'new'),
    queryFn: () => getAssetDepreciatedDate(assetId as string),
    enabled: !!assetId,
    staleTime: 0,
  });
  const lockedYears = useQuery({
    queryKey: queryKeys.lockedTaxYears(organizationId),
    queryFn: () => getLockedTaxYears(organizationId),
    enabled: !!assetId,
    staleTime: 0,
  });

  return useMemo(() => ({
    categories: categories.data ?? NO_CATEGORIES,
    categoryPeriods: periods.data ?? NO_PERIODS,
    items: items.data ?? NO_ITEMS,
    item: itemId ? item.data ?? null : null,
    depreciatedOn: assetId ? depreciatedOn.data ?? null : null,
    lockedYears: lockedYears.data ?? NO_YEARS,
  }), [categories.data, periods.data, items.data, itemId, item.data, assetId, depreciatedOn.data, lockedYears.data]);
}

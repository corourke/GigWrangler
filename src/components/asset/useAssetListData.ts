import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, equipmentInvalidation, invalidateKeys } from '../../lib/queryKeys';
import { getItems, getContainerPieces, type EquipmentItemWithRecords } from '../../services/equipmentItem.service';
import { deleteAsset, duplicateAsset, updateAsset } from '../../services/asset.service';
import { getAssetTrackingSummary } from '../../services/inventoryManagement.service';
import type { ContainerPieces } from '../../utils/equipmentItems';
import type { DbAsset } from '../../utils/supabase/types';

export interface EquipmentItemsData {
  items: EquipmentItemWithRecords[];
  containerPieces: ContainerPieces;
}

export type AssetTrackingSummary = Map<string, { status: string; location?: string | null; gigTitle?: string | null }>;

const mapRecords = (data: EquipmentItemsData | undefined, fn: (records: DbAsset[]) => DbAsset[]) =>
  data && { ...data, items: data.items.map((i) => ({ ...i, records: fn(i.records) })) };

/**
 * Server state for the Items list (A10): the organization's items with their units and lots
 * (and the pieces in container kits), the tracking summary, and the writes made from the list.
 */
export function useAssetListData(organizationId: string) {
  const queryClient = useQueryClient();
  const listKey = queryKeys.equipmentItems(organizationId);

  const itemsQuery = useQuery<EquipmentItemsData>({
    queryKey: listKey,
    queryFn: async () => {
      const items = await getItems(organizationId);
      const containerPieces = await getContainerPieces(organizationId, items);
      return { items, containerPieces };
    },
    staleTime: 0,
  });

  const trackingQuery = useQuery<AssetTrackingSummary>({
    queryKey: queryKeys.assetTrackingSummary(organizationId),
    queryFn: () => getAssetTrackingSummary(organizationId),
    staleTime: 0,
  });

  const invalidate = (assetId?: string) =>
    invalidateKeys(queryClient, equipmentInvalidation.asset(organizationId, assetId));

  const updateAssetMutation = useMutation({
    mutationFn: (vars: { id: string; updates: Partial<DbAsset> }) => updateAsset(vars.id, vars.updates),
    onSuccess: (_data, { id, updates }) => {
      queryClient.setQueryData<EquipmentItemsData>(listKey, (prev) =>
        mapRecords(prev, (records) => records.map((a) => (a.id === id ? { ...a, ...updates } : a))));
      // As before A10, the list isn't reloaded under an inline edit; it is marked stale.
      return invalidateKeys(queryClient, equipmentInvalidation.asset(organizationId, id), { markOnly: [listKey] });
    },
    onError: (_err, { id }) => invalidate(id),
  });

  // Optimistic: the record leaves the list at once and comes back if the delete fails.
  const deleteAssetMutation = useMutation({
    mutationFn: (assetId: string) => deleteAsset(assetId),
    onMutate: async (assetId) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<EquipmentItemsData>(listKey);
      queryClient.setQueryData<EquipmentItemsData>(listKey, (prev) =>
        mapRecords(prev, (records) => records.filter((a) => a.id !== assetId)));
      return { previous };
    },
    onError: (_err, _assetId, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous);
    },
    onSettled: (_data, _err, assetId) => invalidate(assetId),
  });

  const duplicateAssetMutation = useMutation({
    mutationFn: (assetId: string) => duplicateAsset(assetId),
    onSuccess: (_data, assetId) => invalidate(assetId),
  });

  const error = itemsQuery.error ?? trackingQuery.error;

  return {
    items: itemsQuery.data?.items,
    containerPieces: itemsQuery.data?.containerPieces,
    trackingSummary: trackingQuery.data,
    isLoading: itemsQuery.isPending || trackingQuery.isPending,
    error: error ? (error as Error).message || 'Failed to load equipment' : null,
    /** Reload the list (Try Again, and after an invoice scan saves new records). */
    refresh: () => Promise.all([itemsQuery.refetch(), trackingQuery.refetch()]),
    /** Refresh every cache a new or changed record touches. */
    invalidate,
    updateAsset: updateAssetMutation,
    deleteAsset: deleteAssetMutation,
    duplicateAsset: duplicateAssetMutation,
  };
}

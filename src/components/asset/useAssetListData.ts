import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterAssetChange } from '../../lib/queryKeys';
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

const NO_ITEMS: EquipmentItemWithRecords[] = [];
const NO_PIECES: ContainerPieces = { all: new Map(), active: new Map() };
const NO_TRACKING: AssetTrackingSummary = new Map();

/** The organization's items, then the pieces in container kits, as one load (as before A10). */
async function loadItems(organizationId: string): Promise<EquipmentItemsData> {
  const items = await getItems(organizationId);
  const containerPieces = await getContainerPieces(organizationId, items);
  return { items, containerPieces };
}

/**
 * The Items list's data (A10): the organization's items with their units and lots (and the
 * pieces in container kits), the tracking summary, and the writes made from the list. A revisit
 * shows the cached list at once and refreshes it (staleTime 0); keyed by organization, so a late
 * answer for another organization never shows.
 */
export function useAssetListData(organizationId: string) {
  const queryClient = useQueryClient();
  const listKey = useMemo(() => queryKeys.equipmentItems(organizationId), [organizationId]);

  const list = useQuery({ queryKey: listKey, queryFn: () => loadItems(organizationId), staleTime: 0 });
  const tracking = useQuery<AssetTrackingSummary>({
    queryKey: queryKeys.assetTrackingSummary(organizationId),
    queryFn: () => getAssetTrackingSummary(organizationId),
    staleTime: 0,
  });

  /** Change each item's records in the cached list, for optimistic edits. */
  const setRecords = useCallback(
    (fn: (records: DbAsset[]) => DbAsset[]) =>
      queryClient.setQueryData<EquipmentItemsData>(listKey, (old) =>
        old && { ...old, items: old.items.map((i) => ({ ...i, records: fn(i.records) })) }),
    [queryClient, listKey],
  );

  const afterAssetChange = useCallback(
    (assetId?: string) => invalidateAfterAssetChange(queryClient, { organizationId, assetId }),
    [queryClient, organizationId],
  );

  const updateAssetMutation = useMutation({
    mutationFn: (vars: { id: string; updates: Partial<DbAsset> }) => updateAsset(vars.id, vars.updates),
    onSuccess: (_data, { id, updates }) => {
      setRecords((records) => records.map((a) => (a.id === id ? { ...a, ...updates } : a)));
      // As before A10, the list isn't reloaded under an inline edit; it is marked stale.
      return invalidateAfterAssetChange(queryClient, { organizationId, assetId: id }, { refetchList: false });
    },
    onError: (_err, { id }) => afterAssetChange(id),
  });

  // Optimistic: the record leaves the list at once and comes back if the delete fails.
  const deleteAssetMutation = useMutation({
    mutationFn: (assetId: string) => deleteAsset(assetId),
    onMutate: async (assetId) => {
      await queryClient.cancelQueries({ queryKey: listKey, exact: true });
      const previous = queryClient.getQueryData<EquipmentItemsData>(listKey);
      setRecords((records) => records.filter((a) => a.id !== assetId));
      return { previous };
    },
    onError: (_err, _assetId, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous);
    },
    onSettled: (_data, _err, assetId) => afterAssetChange(assetId),
  });

  const duplicateAssetMutation = useMutation({
    mutationFn: (assetId: string) => duplicateAsset(assetId),
    onSuccess: (_data, assetId) => afterAssetChange(assetId),
  });

  const { refetch: refetchList } = list;
  const { refetch: refetchTracking } = tracking;
  /** Load the list again (Try Again). */
  const reload = useCallback(() => { void refetchList(); void refetchTracking(); }, [refetchList, refetchTracking]);

  const loadError = list.error ?? tracking.error;
  const error = loadError ? ((loadError as Error).message || 'Failed to load equipment') : null;

  return useMemo(() => ({
    items: list.data?.items ?? NO_ITEMS,
    containerPieces: list.data?.containerPieces ?? NO_PIECES,
    trackingSummary: tracking.data ?? NO_TRACKING,
    isLoading: list.isPending || tracking.isPending,
    error,
    reload,
    afterAssetChange,
    setRecords,
    updateAsset: updateAssetMutation.mutateAsync,
    deleteAsset: deleteAssetMutation.mutateAsync,
    duplicateAsset: duplicateAssetMutation.mutateAsync,
  }), [list.data, list.isPending, tracking.data, tracking.isPending, error, reload, afterAssetChange, setRecords,
    updateAssetMutation.mutateAsync, deleteAssetMutation.mutateAsync, duplicateAssetMutation.mutateAsync]);
}

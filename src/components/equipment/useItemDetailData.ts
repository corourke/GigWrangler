import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterItemChange } from '../../lib/queryKeys';
import {
  getItem,
  getContainerPieces,
  getItemKitLines,
  updateItem,
  type EquipmentItemWithRecords,
  type ItemFields,
  type ItemKitLine,
} from '../../services/equipmentItem.service';
import { getAssetTrackingSummary, getItemWhereabouts, type ItemWhereabout } from '../../services/inventoryManagement.service';
import type { AssetTrackingSummary } from '../asset/useAssetListData';

export interface ItemPageData {
  item: EquipmentItemWithRecords;
  /** Pieces in container kits: all of them, and the Active ones. */
  inContainers: [number, number];
  kitLines: ItemKitLine[];
  places: ItemWhereabout[];
}

const NO_TRACKING: AssetTrackingSummary = new Map();
const NO_LINES: ItemKitLine[] = [];
const NO_PLACES: ItemWhereabout[] = [];
const NONE_IN_CONTAINERS: [number, number] = [0, 0];

/** The item, then what is read from its units and lots, as one load. */
async function loadItemPage(itemId: string, organizationId: string): Promise<ItemPageData> {
  const item = await getItem(itemId);
  const recordIds = item.records.map((r) => r.id);
  const [containers, kitLines, places] = await Promise.all([
    getContainerPieces(organizationId, [item]),
    getItemKitLines(item.id, recordIds),
    getItemWhereabouts(organizationId, item.records),
  ]);
  return { item, inContainers: [containers.all.get(item.id) ?? 0, containers.active.get(item.id) ?? 0], kitLines, places };
}

/**
 * An item page's data (A10): the item and what is read from its units and lots, the
 * organization's tracking summary, and saving the item's shared fields. Keyed by the item, so a
 * late answer for another item never shows.
 */
export function useItemDetailData(itemId: string, organizationId: string) {
  const queryClient = useQueryClient();
  const pageKey = useMemo(() => queryKeys.equipmentItem(itemId, organizationId), [itemId, organizationId]);

  const page = useQuery({ queryKey: pageKey, queryFn: () => loadItemPage(itemId, organizationId), staleTime: 0 });
  const tracking = useQuery<AssetTrackingSummary>({
    queryKey: queryKeys.assetTrackingSummary(organizationId),
    queryFn: () => getAssetTrackingSummary(organizationId),
    staleTime: 0,
  });

  /** Change the cached item, for edits shown before the reload. */
  const setItem = useCallback(
    (fn: (item: EquipmentItemWithRecords) => EquipmentItemWithRecords) =>
      queryClient.setQueryData<ItemPageData>(pageKey, (old) => old && { ...old, item: fn(old.item) }),
    [queryClient, pageKey],
  );
  const afterItemChange = useCallback(
    () => invalidateAfterItemChange(queryClient, { organizationId, itemId }),
    [queryClient, organizationId, itemId],
  );

  // Autosaved edits: written into this page's cache, which is only marked stale (as before A10,
  // the page isn't reloaded under an edit); everything else showing the item refreshes.
  const updateItemMutation = useMutation({
    mutationFn: (fields: Required<ItemFields>) => updateItem(itemId, fields),
    onSuccess: (_data, fields) => {
      setItem((item) => ({ ...item, ...fields }));
      return invalidateAfterItemChange(queryClient, { organizationId, itemId }, { refetchItemPage: false });
    },
  });

  const { refetch: refetchPage } = page;
  const { refetch: refetchTracking } = tracking;
  /** Load the page again (Retry). */
  const reload = useCallback(() => { void refetchPage(); void refetchTracking(); }, [refetchPage, refetchTracking]);

  const loadError = page.error ?? tracking.error;
  const error = loadError ? ((loadError as Error).message || 'Failed to load this item') : null;

  return useMemo(() => ({
    item: page.data?.item ?? null,
    inContainers: page.data?.inContainers ?? NONE_IN_CONTAINERS,
    kitLines: page.data?.kitLines ?? NO_LINES,
    places: page.data?.places ?? NO_PLACES,
    tracking: tracking.data ?? NO_TRACKING,
    isLoading: page.isPending || tracking.isPending,
    error,
    reload,
    afterItemChange,
    setItem,
    updateItem: updateItemMutation.mutateAsync,
  }), [page.data, page.isPending, tracking.data, tracking.isPending, error, reload, afterItemChange, setItem,
    updateItemMutation.mutateAsync]);
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, equipmentInvalidation, invalidateKeys } from '../../lib/queryKeys';
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

/**
 * Server state for an item page (A10): the item and what is read from its units and lots, the
 * organization's tracking summary, and saving the item's shared fields.
 */
export function useItemDetailData(itemId: string, organizationId: string) {
  const queryClient = useQueryClient();
  const pageKey = queryKeys.equipmentItem(itemId, organizationId);

  const pageQuery = useQuery<ItemPageData>({
    queryKey: pageKey,
    queryFn: async () => {
      const item = await getItem(itemId);
      const recordIds = item.records.map((r) => r.id);
      const [containers, kitLines, places] = await Promise.all([
        getContainerPieces(organizationId, [item]),
        getItemKitLines(item.id, recordIds),
        getItemWhereabouts(organizationId, item.records),
      ]);
      return {
        item,
        inContainers: [containers.all.get(item.id) ?? 0, containers.active.get(item.id) ?? 0],
        kitLines,
        places,
      };
    },
    staleTime: 0,
  });

  const trackingQuery = useQuery<AssetTrackingSummary>({
    queryKey: queryKeys.assetTrackingSummary(organizationId),
    queryFn: () => getAssetTrackingSummary(organizationId),
    staleTime: 0,
  });

  // Autosaved edits: written into this page's cache (the open form isn't refetched under it),
  // and the other caches the item's fields show in are invalidated.
  const updateItemMutation = useMutation({
    mutationFn: (fields: Required<ItemFields>) => updateItem(itemId, fields),
    onSuccess: (_data, fields) => {
      queryClient.setQueryData<ItemPageData>(pageKey, (prev) => (prev ? { ...prev, item: { ...prev.item, ...fields } } : prev));
      return invalidateKeys(queryClient, equipmentInvalidation.item(organizationId));
    },
  });

  const error = pageQuery.error ?? trackingQuery.error;

  return {
    data: pageQuery.data,
    tracking: trackingQuery.data,
    error: error ? (error as Error).message || 'Failed to load this item' : null,
    retry: () => Promise.all([pageQuery.refetch(), trackingQuery.refetch()]),
    updateItem: updateItemMutation,
  };
}

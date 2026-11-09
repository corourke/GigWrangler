import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, equipmentInvalidation, invalidateKeys } from '../../lib/queryKeys';
import {
  getKit,
  deleteKit,
  duplicateKit,
  getKitFlattenedContents,
  getKitFlattenedItems,
  getKitComponentTree,
  type KitComponentTreeNode,
} from '../../services/kit.service';
import { getEntityActivity } from '../../services/activityLog.service';
import type { ActivityLogEntry } from '../../utils/supabase/types';

export interface FlattenedAssetRow {
  asset_id: string;
  total_quantity: number;
  asset: any;
}

/** An "any" line, flattened through nested kits (#184). */
export type FlattenedItemRow = Awaited<ReturnType<typeof getKitFlattenedItems>>[number];

export interface KitPageData {
  kit: any;
  flattenedAssets: FlattenedAssetRow[];
  flattenedItems: FlattenedItemRow[];
  tree: KitComponentTreeNode[];
}

const NO_ACTIVITY: ActivityLogEntry[] = [];

/**
 * Server state for a kit page (A10): the kit, its flattened contents and structure, its activity,
 * and the writes made from the page.
 */
export function useKitDetailData(kitId: string, organizationId: string) {
  const queryClient = useQueryClient();

  const detailQuery = useQuery<KitPageData>({
    queryKey: queryKeys.kitDetail(kitId),
    queryFn: async () => {
      const [kit, flattened, tree, items] = await Promise.all([
        getKit(kitId),
        getKitFlattenedContents(kitId),
        getKitComponentTree(kitId),
        getKitFlattenedItems(kitId),
      ]);
      return { kit, flattenedAssets: flattened as FlattenedAssetRow[], flattenedItems: items ?? [], tree };
    },
    staleTime: 0,
  });

  // Activity is secondary: a failure leaves it empty and the page still shows the kit.
  const activityQuery = useQuery<ActivityLogEntry[]>({
    queryKey: queryKeys.kitActivity(kitId),
    queryFn: () => getEntityActivity('kit', kitId),
    staleTime: 0,
  });

  const invalidate = () => invalidateKeys(queryClient, equipmentInvalidation.kit(organizationId, kitId));

  const duplicateKitMutation = useMutation({
    mutationFn: () => duplicateKit(kitId),
    onSuccess: invalidate,
  });

  const deleteKitMutation = useMutation({
    mutationFn: () => deleteKit(kitId),
    onSuccess: invalidate,
  });

  return {
    detailQuery,
    activity: activityQuery.data ?? NO_ACTIVITY,
    activityLoading: activityQuery.isPending,
    duplicateKit: duplicateKitMutation,
    deleteKit: deleteKitMutation,
  };
}

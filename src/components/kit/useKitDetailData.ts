import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterKitChange } from '../../lib/queryKeys';
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

/** The kit, its flattened contents and its structure, as one load (as before A10). */
async function loadKitPage(kitId: string): Promise<KitPageData> {
  const [kit, flattened, tree, items] = await Promise.all([
    getKit(kitId),
    getKitFlattenedContents(kitId),
    getKitComponentTree(kitId),
    getKitFlattenedItems(kitId),
  ]);
  return { kit, flattenedAssets: flattened as FlattenedAssetRow[], flattenedItems: items ?? [], tree };
}

/**
 * A kit page's data (A10): the kit, its flattened contents and structure, its activity, and the
 * writes made from the page. Keyed by the kit, so a late answer for another kit never shows (B12).
 */
export function useKitDetailData(kitId: string, organizationId: string) {
  const queryClient = useQueryClient();

  const page = useQuery({ queryKey: queryKeys.kitDetail(kitId), queryFn: () => loadKitPage(kitId), staleTime: 0 });

  // Activity is secondary: a failure leaves it empty and the page still shows the kit.
  const activity = useQuery<ActivityLogEntry[]>({
    queryKey: queryKeys.kitActivity(kitId),
    queryFn: () => getEntityActivity('kit', kitId),
    staleTime: 0,
  });

  const afterKitChange = useCallback(
    () => invalidateAfterKitChange(queryClient, { organizationId, kitId }),
    [queryClient, organizationId, kitId],
  );
  const duplicateKitMutation = useMutation({ mutationFn: () => duplicateKit(kitId), onSuccess: afterKitChange });
  const deleteKitMutation = useMutation({ mutationFn: () => deleteKit(kitId), onSuccess: afterKitChange });

  const { refetch } = page;
  /** Load the kit again (Retry). */
  const reload = useCallback(() => { void refetch(); }, [refetch]);
  const error = page.error ? ((page.error as Error).message || 'Failed to load this kit.') : null;

  return useMemo(() => ({
    page: page.data ?? null,
    isLoading: page.isPending,
    error,
    reload,
    activity: activity.data ?? NO_ACTIVITY,
    activityLoading: activity.isPending,
    afterKitChange,
    duplicateKit: duplicateKitMutation.mutateAsync,
    deleteKit: deleteKitMutation.mutateAsync,
  }), [page.data, page.isPending, error, reload, activity.data, activity.isPending, afterKitChange,
    duplicateKitMutation.mutateAsync, deleteKitMutation.mutateAsync]);
}

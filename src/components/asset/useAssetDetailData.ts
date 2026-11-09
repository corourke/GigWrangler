import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterAssetChange } from '../../lib/queryKeys';
import {
  getAsset,
  getAssetHistory,
  getAssetInventoryTracking,
  deleteAsset,
  duplicateAsset,
} from '../../services/asset.service';
import { undoWriteOff } from '../../services/writeOff.service';
import { getLockedTaxYears } from '../../services/taxYear.service';
import type { ActivityLogEntry, DbInventoryTracking } from '../../utils/supabase/types';

const NO_ACTIVITY: ActivityLogEntry[] = [];
const NO_TRACKING: DbInventoryTracking[] = [];
const NO_YEARS = new Set<number>();

/**
 * A unit or lot page's data (A10): the record, its activity and scan history, the organization's
 * filed tax years (read only for a Missing record the role may bring back, #242), and the writes
 * made from the page. Keyed by the record, so a late answer for another record never shows (B12).
 */
export function useAssetDetailData(
  assetId: string,
  organizationId: string,
  { canUndoWriteOff }: { canUndoWriteOff: boolean },
) {
  const queryClient = useQueryClient();

  const assetQuery = useQuery({ queryKey: queryKeys.asset(assetId), queryFn: () => getAsset(assetId), staleTime: 0 });
  const asset: any = assetQuery.data ?? null;

  // History is secondary: a failure leaves it empty and the page still shows the record.
  const activity = useQuery<ActivityLogEntry[]>({
    queryKey: queryKeys.assetActivity(assetId),
    queryFn: () => getAssetHistory(assetId),
    staleTime: 0,
  });
  const scans = useQuery<DbInventoryTracking[]>({
    queryKey: queryKeys.assetInventoryTracking(assetId),
    queryFn: () => getAssetInventoryTracking(assetId),
    staleTime: 0,
  });

  const lockedYears = useQuery<Set<number>>({
    queryKey: queryKeys.lockedTaxYears(organizationId),
    queryFn: () => getLockedTaxYears(organizationId),
    enabled: canUndoWriteOff && asset?.status === 'Missing',
    staleTime: 0,
  });

  const afterAssetChange = useCallback(
    () => invalidateAfterAssetChange(queryClient, { organizationId, assetId }),
    [queryClient, organizationId, assetId],
  );

  const undoWriteOffMutation = useMutation({ mutationFn: () => undoWriteOff(assetId), onSuccess: afterAssetChange });
  const duplicateAssetMutation = useMutation({ mutationFn: () => duplicateAsset(assetId), onSuccess: afterAssetChange });
  const deleteAssetMutation = useMutation({ mutationFn: () => deleteAsset(assetId), onSuccess: afterAssetChange });

  const { refetch } = assetQuery;
  /** Load the record again (Retry). */
  const reload = useCallback(() => { void refetch(); }, [refetch]);

  const error = assetQuery.error ? ((assetQuery.error as Error).message || 'Failed to load this asset.') : null;

  return useMemo(() => ({
    asset,
    isLoading: assetQuery.isPending,
    error,
    reload,
    activity: activity.data ?? NO_ACTIVITY,
    inventoryTracking: scans.data ?? NO_TRACKING,
    isLoadingHistory: activity.isPending || scans.isPending,
    lockedYears: lockedYears.data ?? NO_YEARS,
    afterAssetChange,
    undoWriteOff: undoWriteOffMutation.mutateAsync,
    duplicateAsset: duplicateAssetMutation.mutateAsync,
    deleteAsset: deleteAssetMutation.mutateAsync,
  }), [asset, assetQuery.isPending, error, reload, activity.data, activity.isPending, scans.data, scans.isPending,
    lockedYears.data, afterAssetChange, undoWriteOffMutation.mutateAsync, duplicateAssetMutation.mutateAsync,
    deleteAssetMutation.mutateAsync]);
}

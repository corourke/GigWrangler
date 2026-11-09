import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, equipmentInvalidation, invalidateKeys } from '../../lib/queryKeys';
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

const EMPTY_ACTIVITY: ActivityLogEntry[] = [];
const EMPTY_TRACKING: DbInventoryTracking[] = [];
const NO_YEARS = new Set<number>();

/**
 * Server state for a unit or lot page (A10): the record, its activity and scan history, the
 * organization's filed tax years (read only for a Missing record the role may bring back, #242),
 * and the writes made from the page.
 */
export function useAssetDetailData(
  assetId: string,
  organizationId: string,
  options: { canUndoWriteOff: boolean },
) {
  const queryClient = useQueryClient();

  const assetQuery = useQuery({
    queryKey: queryKeys.asset(assetId),
    queryFn: () => getAsset(assetId),
    staleTime: 0,
  });

  // History is secondary: a failure leaves it empty and the page still shows the record.
  const activityQuery = useQuery<ActivityLogEntry[]>({
    queryKey: queryKeys.assetActivity(assetId),
    queryFn: () => getAssetHistory(assetId),
    staleTime: 0,
  });

  const trackingQuery = useQuery<DbInventoryTracking[]>({
    queryKey: queryKeys.assetInventoryTracking(assetId),
    queryFn: () => getAssetInventoryTracking(assetId),
    staleTime: 0,
  });

  const lockedYearsQuery = useQuery<Set<number>>({
    queryKey: queryKeys.lockedTaxYears(organizationId),
    queryFn: () => getLockedTaxYears(organizationId),
    enabled: options.canUndoWriteOff && (assetQuery.data as { status?: string } | undefined)?.status === 'Missing',
    staleTime: 0,
  });

  const invalidate = () => invalidateKeys(queryClient, equipmentInvalidation.asset(organizationId, assetId));

  const undoWriteOffMutation = useMutation({
    mutationFn: () => undoWriteOff(assetId),
    onSuccess: invalidate,
  });

  const duplicateAssetMutation = useMutation({
    mutationFn: () => duplicateAsset(assetId),
    onSuccess: invalidate,
  });

  const deleteAssetMutation = useMutation({
    mutationFn: () => deleteAsset(assetId),
    onSuccess: invalidate,
  });

  return {
    assetQuery,
    activity: activityQuery.data ?? EMPTY_ACTIVITY,
    inventoryTracking: trackingQuery.data ?? EMPTY_TRACKING,
    isLoadingHistory: activityQuery.isPending || trackingQuery.isPending,
    lockedYears: lockedYearsQuery.data ?? NO_YEARS,
    undoWriteOff: undoWriteOffMutation,
    duplicateAsset: duplicateAssetMutation,
    deleteAsset: deleteAssetMutation,
  };
}

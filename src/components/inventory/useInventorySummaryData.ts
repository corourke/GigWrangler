import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterTrackingChange } from '../../lib/queryKeys';
import {
  getActiveGigsWithTracking,
  getInventoryConflictFlags,
  type GigWithTracking,
} from '../../services/inventoryManagement.service';

const NO_GIGS: GigWithTracking[] = [];
const NO_CONFLICTS = new Set<string>();

/**
 * Equipment › Out on gigs' data (A10): the active gigs with their kits' scans, and the kits
 * booked twice. It shares these caches with Locations and the reports. Keyed by organization, so
 * a late answer for another organization never shows (B12). A failed read shows no gigs, as
 * before.
 */
export function useInventorySummaryData(organizationId: string) {
  const queryClient = useQueryClient();

  const gigs = useQuery<GigWithTracking[]>({
    queryKey: queryKeys.activeGigsWithTracking(organizationId),
    queryFn: () => getActiveGigsWithTracking(organizationId),
    staleTime: 0,
  });
  const conflicts = useQuery<Set<string>>({
    queryKey: queryKeys.inventoryConflictFlags(organizationId),
    queryFn: () => getInventoryConflictFlags(organizationId),
    staleTime: 0,
  });

  const afterTrackingChange = useCallback(
    () => invalidateAfterTrackingChange(queryClient, { organizationId }),
    [queryClient, organizationId],
  );
  const { refetch: refetchGigs } = gigs;
  const { refetch: refetchConflicts } = conflicts;
  const reload = useCallback(() => { void refetchGigs(); void refetchConflicts(); }, [refetchGigs, refetchConflicts]);

  const failed = gigs.isError || conflicts.isError;
  return useMemo(() => ({
    gigs: failed ? NO_GIGS : gigs.data ?? NO_GIGS,
    conflictKitIds: failed ? NO_CONFLICTS : conflicts.data ?? NO_CONFLICTS,
    isLoading: (gigs.isPending && !gigs.isError) || (conflicts.isPending && !conflicts.isError),
    error: null as string | null,
    reload,
    afterTrackingChange,
  }), [failed, gigs.data, gigs.isPending, gigs.isError, conflicts.data, conflicts.isPending, conflicts.isError, reload,
    afterTrackingChange]);
}

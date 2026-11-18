import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getGigExportAggregates, getGigsForOrganization } from '../../services/gig.service';
import { checkAllConflictsForGigs, type Conflict } from '../../services/conflictDetection.service';
import { queryKeys, invalidateAfterGigListChange } from '../../lib/queryKeys';
import type { GigExportAggregates } from '../../services/gig.service';
import type { Gig } from '../../utils/supabase/types';

const NO_GIGS: Gig[] = [];
const NO_CONFLICTS: Conflict[] = [];
const NO_AGGREGATES = new Map<string, GigExportAggregates>();

/** Conflicts are checked for gigs that ended within this many days, and for later ones (#453). */
export const CONFLICT_LOOKBACK_DAYS = 7;

/** The gigs the conflicts check covers: not ended more than 7 days ago. Older gigs show no flag. */
export function gigsForConflictCheck<T extends { end: string }>(gigs: readonly T[], now: number = Date.now()): T[] {
  const cutoff = now - CONFLICT_LOOKBACK_DAYS * 86_400_000;
  return gigs.filter((g) => new Date(g.end).getTime() >= cutoff);
}

/**
 * The gig list's data (A10, #453): the organization's gigs show as soon as they load; the conflicts
 * among the recent and upcoming ones load after, and the per-gig money totals for the optional
 * columns and the export. A revisit shows the cached list at once and refreshes it (staleTime 0).
 * The setters change the cached data in place, for optimistic edits.
 */
export function useGigListData(organizationId: string) {
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: queryKeys.gigList(organizationId),
    queryFn: async () => ((await getGigsForOrganization(organizationId)) || []) as Gig[],
    staleTime: 0,
  });

  // After the list, and again when the list is refetched. A failed check leaves the list as it is.
  const conflictsQuery = useQuery({
    queryKey: queryKeys.gigListConflicts(organizationId),
    queryFn: async () => {
      const covered = gigsForConflictCheck(queryClient.getQueryData<Gig[]>(queryKeys.gigList(organizationId)) ?? NO_GIGS);
      return covered.length > 0 ? await checkAllConflictsForGigs(covered, organizationId) : NO_CONFLICTS;
    },
    enabled: list.isSuccess && !list.isFetching,
    staleTime: 0,
  });

  // Non-fatal: if this fails, the optional financial columns and the export show zeros.
  const aggregates = useQuery({
    queryKey: queryKeys.gigAggregates(organizationId),
    queryFn: () =>
      getGigExportAggregates(organizationId).catch((err) => {
        console.error('Error loading gig financial aggregates:', err);
        return new Map<string, GigExportAggregates>();
      }),
    staleTime: 0,
  });

  const setGigs = useCallback(
    (fn: (gigs: Gig[]) => Gig[]) =>
      queryClient.setQueryData<Gig[]>(queryKeys.gigList(organizationId), (old) => fn(old ?? NO_GIGS)),
    [queryClient, organizationId],
  );
  const setConflicts = useCallback(
    (fn: (c: Conflict[]) => Conflict[]) =>
      queryClient.setQueryData<Conflict[]>(queryKeys.gigListConflicts(organizationId), (old) => fn(old ?? NO_CONFLICTS)),
    [queryClient, organizationId],
  );

  const { refetch } = list;
  const { refetch: refetchConflicts } = conflictsQuery;
  const reload = useCallback(() => { void refetch().then(() => refetchConflicts()); }, [refetch, refetchConflicts]);
  const afterListChange = useCallback(() => invalidateAfterGigListChange(queryClient, organizationId), [queryClient, organizationId]);

  const error = list.error ? ((list.error as Error).message || 'Failed to load gigs') : null;
  useEffect(() => {
    if (list.error) console.error('Error loading gigs:', list.error);
  }, [list.error]);
  useEffect(() => {
    if (conflictsQuery.error) console.error('Error checking conflicts:', conflictsQuery.error);
  }, [conflictsQuery.error]);

  return useMemo(() => ({
    gigs: list.data ?? NO_GIGS,
    conflicts: conflictsQuery.data ?? NO_CONFLICTS,
    /** True until the first conflicts check has finished (the list is already showing). */
    conflictsLoading: !list.isError && conflictsQuery.isPending,
    financialsByGigId: aggregates.data ?? NO_AGGREGATES,
    isLoading: list.isPending,
    error,
    reload,
    afterListChange,
    setGigs,
    setConflicts,
  }), [list.data, list.isPending, list.isError, conflictsQuery.data, conflictsQuery.isPending, aggregates.data, error, reload, afterListChange, setGigs, setConflicts]);
}

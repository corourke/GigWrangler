import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getGigExportAggregates, getGigsForOrganization } from '../../services/gig.service';
import { checkAllConflictsForGigs, type Conflict } from '../../services/conflictDetection.service';
import { queryKeys, invalidateAfterGigListChange } from '../../lib/queryKeys';
import type { GigExportAggregates } from '../../services/gig.service';
import type { Gig } from '../../utils/supabase/types';

export interface GigListData {
  gigs: Gig[];
  conflicts: Conflict[];
}

const EMPTY: GigListData = { gigs: [], conflicts: [] };
const NO_AGGREGATES = new Map<string, GigExportAggregates>();

/** The organization's gigs, then the conflicts among them, as one load (as before A10). */
async function loadGigList(organizationId: string): Promise<GigListData> {
  const gigs = (await getGigsForOrganization(organizationId)) || [];
  const conflicts = gigs.length > 0 ? await checkAllConflictsForGigs(gigs, organizationId) : [];
  return { gigs, conflicts };
}

/**
 * The gig list's data (A10): the organization's gigs with their conflicts, and the per-gig money
 * totals for the optional columns and the export. A revisit shows the cached list at once and
 * refreshes it (staleTime 0). The setters change the cached list in place, for optimistic edits.
 */
export function useGigListData(organizationId: string) {
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: queryKeys.gigList(organizationId),
    queryFn: () => loadGigList(organizationId),
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

  const update = useCallback(
    (fn: (data: GigListData) => GigListData) =>
      queryClient.setQueryData<GigListData>(queryKeys.gigList(organizationId), (old) => fn(old ?? EMPTY)),
    [queryClient, organizationId],
  );
  const setGigs = useCallback((fn: (gigs: Gig[]) => Gig[]) => update((d) => ({ ...d, gigs: fn(d.gigs) })), [update]);
  const setConflicts = useCallback((fn: (c: Conflict[]) => Conflict[]) => update((d) => ({ ...d, conflicts: fn(d.conflicts) })), [update]);

  const { refetch } = list;
  const reload = useCallback(() => { void refetch(); }, [refetch]);
  const afterListChange = useCallback(() => invalidateAfterGigListChange(queryClient, organizationId), [queryClient, organizationId]);

  const error = list.error ? ((list.error as Error).message || 'Failed to load gigs') : null;
  useEffect(() => {
    if (list.error) console.error('Error loading gigs:', list.error);
  }, [list.error]);

  return useMemo(() => ({
    gigs: list.data?.gigs ?? EMPTY.gigs,
    conflicts: list.data?.conflicts ?? EMPTY.conflicts,
    financialsByGigId: aggregates.data ?? NO_AGGREGATES,
    isLoading: list.isPending,
    error,
    reload,
    afterListChange,
    setGigs,
    setConflicts,
  }), [list.data, list.isPending, aggregates.data, error, reload, afterListChange, setGigs, setConflicts]);
}

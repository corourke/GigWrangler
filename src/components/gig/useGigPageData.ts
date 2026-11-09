import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { countChildGigs, getGig } from '../../services/gig.service';
import { getGigActivity } from '../../services/activityLog.service';
import { checkAllConflicts, type Conflict } from '../../services/conflictDetection.service';
import { queryKeys, invalidateAfterGigChange, invalidateAfterGigListChange } from '../../lib/queryKeys';
import { isGigAllDay } from '../../utils/dateUtils';
import type { ActivityLogEntry, Gig } from '../../utils/supabase/types';

const NO_CONFLICTS: Conflict[] = [];
const NO_ACTIVITY: ActivityLogEntry[] = [];

/**
 * The gig page's data (A10): the gig, how many child gigs it has, its conflicts as this
 * organization sees them, and its history (loaded only while the History tab is open). Each is
 * keyed by the gig, so a late answer for another gig never shows (B12). A revisit shows the
 * cached gig at once and refreshes it (staleTime 0).
 */
export function useGigPageData(gigId: string, organizationId: string, historyOpen: boolean) {
  const queryClient = useQueryClient();

  const gigQuery = useQuery({ queryKey: queryKeys.gig(gigId), queryFn: () => getGig(gigId) as Promise<Gig>, staleTime: 0 });
  const gig = gigQuery.data ?? null;

  // A parent gig can't be deleted (#175); a failed count reads as none, as before.
  const childCount = useQuery({
    queryKey: queryKeys.gigChildCount(gigId),
    queryFn: () => countChildGigs(gigId).catch(() => 0),
    staleTime: 0,
  });

  const when = gig
    ? { start: gig.start, end: gig.end, timezone: gig.timezone, allDay: isGigAllDay(gig) }
    : { start: '', end: '', timezone: undefined, allDay: false };
  const conflicts = useQuery({
    queryKey: queryKeys.gigConflicts(gigId, organizationId, when),
    queryFn: () =>
      checkAllConflicts(gigId, when.start, when.end, when.timezone, organizationId, when.allDay)
        .then((r) => r.conflicts)
        .catch(() => NO_CONFLICTS),
    enabled: !!gig,
    staleTime: 0,
  });

  const activity = useQuery({
    queryKey: queryKeys.gigActivity(gigId),
    queryFn: () => getGigActivity(gigId).catch(() => NO_ACTIVITY),
    enabled: historyOpen,
    staleTime: 0,
  });

  /** Load the gig again (Retry). */
  const { refetch } = gigQuery;
  const reload = useCallback(() => { void refetch(); }, [refetch]);
  /** After a change to this gig: it, its organization's list and the dashboard refresh. */
  const afterGigChange = useCallback(
    () => invalidateAfterGigChange(queryClient, { gigId, organizationId }),
    [queryClient, gigId, organizationId],
  );
  /** After the gig was duplicated, deleted or left: the list and the dashboard refresh. */
  const afterListChange = useCallback(
    () => invalidateAfterGigListChange(queryClient, organizationId),
    [queryClient, organizationId],
  );

  const loadError = gigQuery.error ? ((gigQuery.error as Error).message || 'Failed to load this gig.') : null;

  return useMemo(() => ({
    gig,
    loadError,
    childGigCount: childCount.data ?? 0,
    conflicts: conflicts.data ?? NO_CONFLICTS,
    activity: activity.data ?? NO_ACTIVITY,
    activityLoading: historyOpen && activity.isPending,
    reload,
    afterGigChange,
    afterListChange,
  }), [gig, loadError, childCount.data, conflicts.data, activity.data, activity.isPending, historyOpen, reload, afterGigChange, afterListChange]);
}

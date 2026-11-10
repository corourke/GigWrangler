import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import {
  loadDayOfShowSheet,
  loadTodayCandidates,
  shouldSaveAhead,
  type DayOfShowGig,
  type DayOfShowSheet,
} from '../../services/mobile/dayOfShow.service';
import type { UserRole } from '../../utils/supabase/types';

import { hasTodayTab } from './todayTab';

export { hasTodayTab };

/** The gigs the Today tab chooses from: the device copy first, then the server's. */
export function useTodayGigs({ userId, orgId, role }: { userId?: string; orgId?: string; role?: UserRole | null }) {
  const queryClient = useQueryClient();
  const key = queryKeys.todayGigs(userId ?? '', orgId ?? '');
  return useQuery<DayOfShowGig[]>({
    queryKey: key,
    queryFn: () =>
      loadTodayCandidates({ role, orgId: orgId as string }, (cached) => {
        if (!queryClient.getQueryData(key)) queryClient.setQueryData(key, cached);
      }),
    enabled: !!userId && !!orgId && hasTodayTab(role),
    // Mounted with every phone screen (to save sheets ahead), so not refetched on each one.
    staleTime: 5 * 60 * 1000,
    networkMode: 'always',
  });
}

/** One gig's sheet: the saved copy first, then a fresh one (saved on the phone each time it opens). */
export function useDayOfShowSheet(gigId: string | null | undefined) {
  const queryClient = useQueryClient();
  const key = queryKeys.dayOfShow(gigId ?? '');
  return useQuery<DayOfShowSheet | null>({
    queryKey: key,
    queryFn: () => loadDayOfShowSheet(gigId as string, (cached) => queryClient.setQueryData(key, cached)),
    enabled: !!gigId,
    staleTime: 0,
    networkMode: 'always',
  });
}

/**
 * Saves the sheet of each gig on today or starting within 24 hours, once the app has its gig list
 * and is online, so it is there at a venue with no signal even if Today was never opened.
 */
export function useSaveTodaySheetsAhead(args: { userId?: string; orgId?: string; role?: UserRole | null }) {
  const queryClient = useQueryClient();
  const { data } = useTodayGigs(args);
  useEffect(() => {
    if (!data || typeof navigator === 'undefined' || !navigator.onLine) return;
    const now = new Date();
    for (const gig of data) {
      if (!shouldSaveAhead(gig, now)) continue;
      const key = queryKeys.dayOfShow(gig.id);
      void queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => loadDayOfShowSheet(gig.id, () => {}),
        staleTime: 5 * 60 * 1000,
      });
    }
  }, [data, queryClient]);
}

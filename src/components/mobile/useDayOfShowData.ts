import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../contexts/AuthContext';
import {
  forgetDayOfShowSheet,
  keepDayOfShowSheet,
  loadDayOfShowSheet,
  loadTodayCandidates,
  shouldSaveAhead,
  type DayOfShowDocument,
  type DayOfShowGig,
  type DayOfShowSheet,
} from '../../services/mobile/dayOfShow.service';
import {
  listSavedDocuments,
  saveDayOfShowDocument,
  saveGigDocumentsAhead,
} from '../../services/mobile/dayOfShowFiles.service';
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
 * Which of the sheet's documents are saved on the phone. Online, first saves its PDFs and images
 * (within the limits). `save` saves one more when the person asks.
 */
export function useDayOfShowDocuments(sheet: DayOfShowSheet | null | undefined) {
  const queryClient = useQueryClient();
  const gigId = sheet?.gig_id ?? '';
  const key = queryKeys.dayOfShowFiles(gigId);
  const savedQuery = useQuery({
    queryKey: [...key, sheet?.saved_at ?? 0],
    queryFn: async () => {
      if (sheet && navigator.onLine) await saveGigDocumentsAhead(sheet).catch(() => {});
      return listSavedDocuments(gigId);
    },
    enabled: !!sheet,
    networkMode: 'always',
  });
  const save = useMutation({
    mutationFn: (doc: DayOfShowDocument) => saveDayOfShowDocument(gigId, doc, { manual: true }),
    networkMode: 'always',
    onSuccess: (result) => {
      if (result.saved) return queryClient.invalidateQueries({ queryKey: key });
    },
  });
  return { saved: savedQuery.data ?? {}, savedQuery, save };
}

/**
 * Saves the sheet (and its PDFs and images) of each gig on today or starting within 24 hours, once the app has its gig list
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
        queryFn: async () => {
          const sheet = await loadDayOfShowSheet(gig.id, () => {});
          // Its PDFs and images too, in the background.
          if (sheet) void saveGigDocumentsAhead(sheet).catch(() => {});
          return sheet;
        },
        staleTime: 5 * 60 * 1000,
      });
    }
  }, [data, queryClient]);
}

/** Save on this phone, and Remove (#445). */
export function useKeepDayOfShowSheet(gigId: string) {
  const queryClient = useQueryClient();
  const userId = useAuth().user?.id ?? '';
  const sheetKey = queryKeys.dayOfShow(gigId);
  const keep = useMutation({
    mutationFn: () => keepDayOfShowSheet(gigId),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: sheetKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.savedDaySheets(userId) }),
      ]),
  });
  const forget = useMutation({
    mutationFn: () => forgetDayOfShowSheet(gigId),
    networkMode: 'always',
    onSuccess: () => {
      // Shown as not saved straight away (a refetch online would only save it again for a while).
      const current = queryClient.getQueryData<DayOfShowSheet | null>(sheetKey);
      if (current) queryClient.setQueryData(sheetKey, { ...current, kept: false });
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dayOfShowFiles(gigId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.savedDaySheets(userId) }),
      ]);
    },
  });
  return { keep, forget };
}

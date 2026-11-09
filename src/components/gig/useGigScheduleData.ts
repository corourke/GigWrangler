import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getGigScheduleEntries } from '../../services/gigSchedule.service';
import { getGigParticipants } from '../../services/gig.service';
import type { GigScheduleEntry } from '../../utils/supabase/types';

/**
 * The schedule editor's data (A10): the gig's schedule rows, read fresh each time the editor
 * opens (they seed an autosaving editor, so never from a cached copy), and its participants, for
 * the acts a row can name. Keyed by the gig. entriesLoadedAt changes once per load; the editor
 * seeds its rows from it.
 */
export function useGigScheduleData(gigId: string) {
  const entries = useQuery<GigScheduleEntry[]>({
    queryKey: queryKeys.gigScheduleEntries(gigId),
    queryFn: () => getGigScheduleEntries(gigId),
    staleTime: 0,
    gcTime: 0,
  });
  // Secondary: a failed read keeps the acts the editor was given.
  const participants = useQuery<any[]>({
    queryKey: queryKeys.gigParticipantList(gigId),
    queryFn: () => getGigParticipants(gigId),
    staleTime: 0,
  });
  const { refetch } = entries;
  const reload = useCallback(() => { void refetch(); }, [refetch]);

  return useMemo(() => ({
    entries: entries.data ?? null,
    entriesLoadedAt: entries.dataUpdatedAt,
    participants: participants.data ?? null,
    isLoading: entries.isPending && !entries.isError,
    error: entries.error ? ((entries.error as Error).message || 'Failed to load schedule') : null,
    reload,
  }), [entries.data, entries.dataUpdatedAt, participants.data, entries.isPending, entries.isError, entries.error, reload]);
}

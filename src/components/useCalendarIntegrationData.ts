import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, orgSettingsInvalidations } from '../lib/queryKeys';
import {
  disconnectGoogleCalendar,
  getSyncLogs,
  getSyncStatusSummary,
  getUserCalendars,
  getUserGoogleCalendarSettings,
  updateUserGoogleCalendarSettings,
} from '../services/googleCalendar.service';
import type { GigSyncStatus, UserGoogleCalendarSettings } from '../utils/supabase/types';

export type SyncLogEntry = GigSyncStatus & { gig_title?: string; gig_start?: string };

/** Google says the connection is gone (expired or revoked): the screen asks to reconnect. */
export const isReconnectError = (error: unknown): boolean => {
  const message = (error as { message?: string } | null)?.message;
  return !!message && (message.includes('expired') || message.includes('revoked') || message.includes('invalid_grant'));
};

/**
 * Server state for CalendarIntegrationSettings (A10). Settings load first; the calendar list
 * loads when sync is on or the token is still good, and the sync status when sync is on. The
 * screen shows its full-page spinner only until that first round has finished.
 */
export function useCalendarIntegrationData(userId: string) {
  const queryClient = useQueryClient();
  const settingsKey = queryKeys.calendarSettings(userId);

  const settingsQuery = useQuery({
    queryKey: settingsKey,
    queryFn: () => getUserGoogleCalendarSettings(userId),
    staleTime: 0,
  });
  const settings = settingsQuery.data ?? null;

  // Only ask Google for calendars if sync is on or the token hasn't expired: an expired, disabled
  // connection shows its saved settings without an error.
  const calendarsEnabled =
    !!settings && (settings.is_enabled || new Date(settings.token_expires_at) > new Date());
  const calendarsQuery = useQuery({
    queryKey: queryKeys.googleCalendars(userId),
    queryFn: () => getUserCalendars(userId),
    enabled: calendarsEnabled,
    staleTime: 0,
  });

  const syncEnabled = !!settings?.is_enabled;
  const syncDataQuery = useQuery({
    queryKey: queryKeys.calendarSyncData(userId),
    queryFn: async () => {
      try {
        const [logs, summary] = await Promise.all([getSyncLogs(userId, 10), getSyncStatusSummary(userId)]);
        return { logs: logs as SyncLogEntry[], summary };
      } catch (error) {
        console.error('Error loading sync data:', error);
        throw error;
      }
    },
    enabled: syncEnabled,
    staleTime: 0,
  });

  // The full-page spinner covers the first round of loads only (per user), as before.
  const firstRoundPending =
    settingsQuery.isPending ||
    (calendarsEnabled && calendarsQuery.isPending && calendarsQuery.isFetching) ||
    (syncEnabled && syncDataQuery.isPending && syncDataQuery.isFetching);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!firstRoundPending) setLoadedFor(userId);
  }, [firstRoundPending, userId]);
  const loading = loadedFor !== userId && firstRoundPending;

  const setSettings = (next: UserGoogleCalendarSettings | null) => queryClient.setQueryData(settingsKey, next);
  const invalidate = (filters: ReturnType<typeof orgSettingsInvalidations.calendarSynced>) =>
    Promise.all(filters.map((f) => queryClient.invalidateQueries(f)));

  const updateSettings = useMutation({
    mutationFn: (changes: Parameters<typeof updateUserGoogleCalendarSettings>[1]) =>
      updateUserGoogleCalendarSettings(userId, changes),
    onSuccess: (updated) => setSettings(updated),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectGoogleCalendar(),
    onSuccess: () => {
      setSettings(null);
      queryClient.removeQueries({ queryKey: queryKeys.googleCalendars(userId) });
      queryClient.removeQueries({ queryKey: queryKeys.calendarSyncData(userId) });
    },
  });

  return {
    settings,
    settingsQuery,
    calendars: calendarsQuery.data ?? [],
    calendarsQuery,
    syncLogs: syncDataQuery.data?.logs ?? [],
    syncSummary: syncDataQuery.data?.summary ?? null,
    syncDataQuery,
    loading,
    updateSettings,
    disconnect,
    /** After turning sync on: reload the calendar list and the sync status. */
    refreshAfterEnable: () => invalidate(orgSettingsInvalidations.calendarEnabled(userId)),
    /** After a sync run, or from the refresh button. */
    refreshSyncData: () => invalidate(orgSettingsInvalidations.calendarSynced(userId)),
  };
}

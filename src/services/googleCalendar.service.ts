import { getSupabase } from './base/dataAccess';
import type { Json } from '../utils/supabase/database.types';
import { UserGoogleCalendarSettings, GigSyncStatus } from '../utils/supabase/types';
import { handleApiError, handleFunctionsError, unwrapFunctionsError } from '../utils/api-error-utils';
import { buildCalendarEvent } from '../../supabase/functions/server/lib/pure/calendarEvent';
import type { CalendarVenue } from '../../supabase/functions/server/lib/pure/calendarEvent';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events'
];

const REDIRECT_URI = () => `${window.location.origin}/auth/google-calendar/callback`;

// The Google tokens stay on the server: the browser can't read them (migration 20261107100000).
const SETTINGS_COLS = 'id, user_id, calendar_id, calendar_name, token_expires_at, is_enabled, sync_filters, created_at, updated_at';

export async function getGoogleAuthUrl(): Promise<string> {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI(),
    scope: SCOPES.join(' '),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Connect Google Calendar: the server exchanges the authorization code and stores the
 * connection. A new connection has no calendar chosen and sync off; a reconnect keeps the
 * calendar already chosen.
 */
export async function connectGoogleCalendar(code: string): Promise<void> {
  try {
    const { data, error } = await getSupabase().functions.invoke(
      'server/integrations/google-calendar/connect',
      { method: 'POST', body: { code, redirect_uri: REDIRECT_URI() } },
    );
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  } catch (error) {
    throw await handleFunctionsError(error, 'connect Google Calendar');
  }
}

/** Disconnect Google Calendar: the server revokes the connection at Google and removes it. */
export async function disconnectGoogleCalendar(): Promise<void> {
  try {
    const { error } = await getSupabase().functions.invoke(
      'server/integrations/google-calendar/connection',
      { method: 'DELETE' },
    );
    if (error) throw error;
  } catch (error) {
    throw await handleFunctionsError(error, 'disconnect Google Calendar');
  }
}

/**
 * Get user's Google Calendar settings
 */
export async function getUserGoogleCalendarSettings(userId: string): Promise<UserGoogleCalendarSettings | null> {
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from('user_google_calendar_settings')
      .select(SETTINGS_COLS)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    return data || null;
  } catch (error) {
    return handleApiError(error, 'get user Google Calendar settings');
  }
}

/**
 * Update user's Google Calendar settings
 */
export async function updateUserGoogleCalendarSettings(
  userId: string,
  updates: Partial<Omit<UserGoogleCalendarSettings, 'id' | 'user_id' | 'created_at'>>
): Promise<UserGoogleCalendarSettings> {
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from('user_google_calendar_settings')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select(SETTINGS_COLS)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Failed to update settings: Not found');
    return data;
  } catch (error) {
    return handleApiError(error, 'update user Google Calendar settings');
  }
}

export async function getUserCalendars(userId: string): Promise<Array<{
  id: string;
  name: string;
  primary?: boolean;
  accessRole: string;
}>> {
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase.functions.invoke(
      'server/integrations/google-calendar/calendars',
      { method: 'POST', body: {} },
    );

    if (error) throw error;
    if (data?.error) throw new Error(data.details || data.error);

    return data.calendars || [];
  } catch (error) {
    throw await handleFunctionsError(error, 'get user calendars');
  }
}

export async function syncGigToCalendar(
  userId: string,
  gigId: string,
  gigData: {
    title: string;
    start: string;
    end: string;
    timezone: string;
    description?: string;
    venue?: CalendarVenue | null;
  }
): Promise<{ eventId: string; syncedAt: Date }> {
  const settings = await getUserGoogleCalendarSettings(userId);
  if (!settings) throw new Error('Google Calendar integration not configured');
  return syncGigWithSettings(userId, settings, gigId, gigData);
}

export async function deleteGigFromCalendar(userId: string, gigId: string): Promise<void> {
  const supabase = getSupabase();
  const syncStatus = await getGigSyncStatus(gigId, userId);

  if (!syncStatus?.google_event_id) {
    return;
  }

  try {
    // The server uses the stored connection and calendar; an event already gone counts as removed.
    const { error } = await supabase.functions.invoke(
      'server/integrations/google-calendar/events',
      { method: 'DELETE', body: { event_id: syncStatus.google_event_id } },
    );

    if (error) throw error;

    await updateGigSyncStatus(gigId, userId, {
      google_event_id: null,
      sync_status: 'removed',
      last_synced_at: new Date().toISOString(),
      sync_error: null,
    });
  } catch (error) {
    // Unwrap the real reason (e.g. Google's own error message) before it's
    // persisted or branched on — the raw FunctionsHttpError's `.message` is
    // always the generic "Edge Function returned a non-2xx status code",
    // which would make the 404/410 check below never match and would hide
    // the actual cause from the Sync Log.
    const unwrapped = await unwrapFunctionsError(error);
    const message = typeof unwrapped?.message === 'string' ? unwrapped.message : 'Unknown error';

    if (message.includes('404') || message.includes('410')) {
      await updateGigSyncStatus(gigId, userId, {
        google_event_id: null,
        sync_status: 'removed',
        last_synced_at: new Date().toISOString(),
        sync_error: null,
      });
    } else {
      await updateGigSyncStatus(gigId, userId, {
        sync_status: 'failed',
        sync_error: message,
        last_synced_at: new Date().toISOString(),
      });
      return handleApiError(unwrapped, 'delete gig from calendar');
    }
  }
}

/**
 * Remove one event from the user's calendar by its id, writing no sync status.
 * Used once a gig is deleted: its sync rows went with it (#175). An event that
 * is already gone counts as removed.
 */
export async function deleteCalendarEvent(userId: string, eventId: string): Promise<void> {
  const supabase = getSupabase();
  try {
    const { error } = await supabase.functions.invoke(
      'server/integrations/google-calendar/events',
      { method: 'DELETE', body: { event_id: eventId } },
    );
    if (error) throw error;
  } catch (error) {
    const unwrapped = await unwrapFunctionsError(error);
    const message = typeof unwrapped?.message === 'string' ? unwrapped.message : '';
    if (message.includes('404') || message.includes('410')) return;
    return handleApiError(unwrapped, 'delete calendar event');
  }
}

/**
 * Get gig sync status
 */
export async function getGigSyncStatus(gigId: string, userId: string): Promise<GigSyncStatus | null> {
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from('gig_sync_status')
      .select('id, gig_id, user_id, google_event_id, last_synced_at, sync_status, sync_error, created_at, updated_at')
      .eq('gig_id', gigId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data || null;
  } catch (error) {
    return handleApiError(error, 'get gig sync status');
  }
}

/**
 * Get recent sync logs for a user
 */
export async function getSyncLogs(
  userId: string,
  limit: number = 20
): Promise<(GigSyncStatus & { gig_title?: string })[]> {
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from('gig_sync_status')
      .select('id, gig_id, user_id, google_event_id, last_synced_at, sync_status, sync_error, created_at, updated_at, gig:gigs(title, start)')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).map((row: any) => ({
      ...row,
      gig_title: row.gig?.title,
      gig_start: row.gig?.start,
      gig: undefined,
    }));
  } catch (error) {
    return handleApiError(error, 'get sync logs');
  }
}

/**
 * Get sync status summary for a user, accounting for sync filters
 */
export async function getSyncStatusSummary(userId: string): Promise<{
  total: number;
  synced: number;
  notSynced: number;
  failed: number;
  removed: number;
  lastSyncedAt: string | null;
}> {
  const supabase = getSupabase();

  try {
    const settings = await getUserGoogleCalendarSettings(userId);
    const allowedStatuses = getFilteredStatuses(settings?.sync_filters);

    const { data, error } = await supabase
      .from('gig_sync_status')
      .select('id, gig_id, user_id, google_event_id, last_synced_at, sync_status, sync_error, created_at, updated_at, gig:gigs(status)')
      .eq('user_id', userId);

    if (error) throw error;

    const logs = (data || []) as (typeof data extends (infer T)[] | null ? T : never)[];
    const synced = logs.filter(l => (l.sync_status === 'synced' || l.sync_status === 'updated') && l.google_event_id).length;
    const removed = logs.filter(l => l.sync_status === 'removed').length;
    const failed = logs.filter(l => l.sync_status === 'failed').length;
    const notSynced = logs.filter(l => {
      const gigStatus = (l as any).gig?.status;
      return gigStatus && !allowedStatuses.has(gigStatus) && l.sync_status !== 'removed' && l.sync_status !== 'failed';
    }).length;

    const lastSynced = logs
      .filter(l => l.last_synced_at)
      .sort((a, b) => new Date(b.last_synced_at!).getTime() - new Date(a.last_synced_at!).getTime())[0];

    return {
      total: logs.length,
      synced,
      notSynced,
      failed,
      removed,
      lastSyncedAt: lastSynced?.last_synced_at || null,
    };
  } catch (error) {
    return handleApiError(error, 'get sync status summary');
  }
}

function getFilteredStatuses(syncFilters: Json | null | undefined): Set<string> {
  const statuses = new Set<string>();
  const filters: Record<string, any> = (syncFilters && typeof syncFilters === 'object' && !Array.isArray(syncFilters)) ? syncFilters : {};

  if (filters.sync_confirmed !== false) {
    statuses.add('Booked');
    statuses.add('Completed');
    statuses.add('Settled');
  }
  if (filters.sync_tentative !== false) {
    statuses.add('DateHold');
    statuses.add('Proposed');
  }
  if (filters.sync_cancelled === true) {
    statuses.add('Cancelled');
  }
  return statuses;
}

export async function syncAllGigsForUser(
  userId: string,
  organizationId: string,
  onProgress?: (synced: number, total: number) => void
): Promise<{ synced: number; failed: number; total: number }> {
  const supabase = getSupabase();

  const settings = await getUserGoogleCalendarSettings(userId);
  if (!settings) throw new Error('Google Calendar integration not configured');
  const allowedStatuses = getFilteredStatuses(settings?.sync_filters);

  const { data: participatingGigs, error: partError } = await supabase
    .from('gig_participants')
    .select('gig_id, inactive')
    .eq('organization_id', organizationId);

  if (partError) throw handleApiError(partError, 'fetch gigs for sync');
  if (!participatingGigs || participatingGigs.length === 0) {
    return { synced: 0, failed: 0, total: 0 };
  }

  const gigIds = [...new Set(participatingGigs.map(g => g.gig_id))];
  // A gig the organization is Inactive on is left out of its calendar sync (#175).
  const inactiveGigIds = new Set(participatingGigs.filter(g => g.inactive).map(g => g.gig_id));

  const { data: gigs, error: gigsError } = await supabase
    .from('gigs')
    .select(`
      id, title, start, end, timezone, notes, status,
      participants:gig_participants(
        role,
        organization:organizations(name, address_line1, city)
      )
    `)
    .in('id', gigIds);

  if (gigsError) throw handleApiError(gigsError, 'fetch gig details for sync');
  if (!gigs || gigs.length === 0) {
    return { synced: 0, failed: 0, total: 0 };
  }

  const included = (g: { id: string; status: string }) => allowedStatuses.has(g.status) && !inactiveGigIds.has(g.id);
  const gigsToSync = gigs.filter(included);
  const gigsToRemove = gigs.filter(g => !included(g));

  const totalOps = gigsToSync.length + gigsToRemove.length;
  let synced = 0;
  let failed = 0;
  let progress = 0;

  for (const gig of gigsToRemove) {
    try {
      await deleteGigFromCalendar(userId, gig.id);
    } catch {
      // Ignore delete failures for filtered-out gigs
    }
    progress++;
    onProgress?.(progress, totalOps);
  }

  for (const gig of gigsToSync) {
    try {
      const venue = (gig.participants as any[])?.find((p: any) => p.role === 'Venue')?.organization;

      await syncGigWithSettings(userId, settings, gig.id, {
        title: gig.title,
        start: gig.start,
        end: gig.end,
        timezone: gig.timezone,
        description: gig.notes ?? undefined,
        venue,
      });
      synced++;
    } catch (err) {
      console.error(`Failed to sync gig ${gig.id}:`, err);
      failed++;
    }
    progress++;
    onProgress?.(progress, totalOps);
  }

  return { synced, failed, total: gigsToSync.length };
}

/**
 * Internal version of syncGigToCalendar that takes already loaded settings
 */
async function syncGigWithSettings(
  userId: string,
  settings: UserGoogleCalendarSettings,
  gigId: string,
  gigData: {
    title: string;
    start: string;
    end: string;
    timezone: string;
    description?: string;
    venue?: CalendarVenue | null;
  }
): Promise<{ eventId: string; syncedAt: Date }> {
  const supabase = getSupabase();

  if (!settings.is_enabled || !settings.calendar_id) {
    throw new Error('Google Calendar sync not enabled or no calendar selected');
  }

  try {
    const existingSync = await getGigSyncStatus(gigId, userId);

    // Same event body as the server's sync-gig-all-users: always all-day in
    // the gig's local dates (#117), times and venue in the description.
    const eventData = buildCalendarEvent(
      { title: gigData.title, start: gigData.start, end: gigData.end, timezone: gigData.timezone, notes: gigData.description },
      gigData.venue,
      `${window.location.origin}/gigs/${gigId}`,
    );

    const { data, error } = await supabase.functions.invoke(
      'server/integrations/google-calendar/events',
      {
        method: 'POST',
        // The server writes to the stored connection's chosen calendar.
        body: {
          event_data: eventData,
          event_id: existingSync?.google_event_id || undefined,
        },
      }
    );

    if (error) throw error;
    if (data?.error) throw new Error(data.details || data.error);

    const eventId = data.event_id;

    const syncStatus = existingSync?.google_event_id ? 'updated' : 'synced';
    await updateGigSyncStatus(gigId, userId, {
      google_event_id: eventId,
      sync_status: syncStatus,
      last_synced_at: new Date().toISOString(),
      sync_error: null,
    });

    return { eventId, syncedAt: new Date() };
  } catch (error) {
    // Unwrap before persisting, not after — otherwise every failure gets
    // saved with Supabase's generic "Edge Function returned a non-2xx status
    // code" instead of the real reason (e.g. Google's own error message),
    // which is exactly what made every row in the Sync Log look identical
    // during the issue #9 outage.
    const unwrapped = await unwrapFunctionsError(error);
    const message = typeof unwrapped?.message === 'string' ? unwrapped.message : 'Unknown error';

    await updateGigSyncStatus(gigId, userId, {
      sync_status: 'failed',
      sync_error: message,
      last_synced_at: new Date().toISOString(),
    });
    return handleApiError(unwrapped, 'sync gig to calendar');
  }
}

export async function updateGigSyncStatus(
  gigId: string,
  userId: string,
  updates: Partial<Omit<GigSyncStatus, 'id' | 'gig_id' | 'user_id' | 'created_at'>>
): Promise<GigSyncStatus> {
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from('gig_sync_status')
      .upsert(
        {
          gig_id: gigId,
          user_id: userId,
          ...updates,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'gig_id,user_id' }
      )
      .select('id, gig_id, user_id, google_event_id, last_synced_at, sync_status, sync_error, created_at, updated_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Failed to update sync status');
    return data;
  } catch (error) {
    return handleApiError(error, 'update gig sync status');
  }
}

/**
 * Bulk re-sync all gigs to Google Calendar using the server-side sync-gig-all-users edge function.
 * This will update all-day events to use the correct formatting for all relevant users.
 */
export async function bulkSyncAllGigsServerSide(
  onProgress?: (synced: number, total: number) => void
): Promise<{ success: boolean; total: number; failed: number }> {
  const supabase = getSupabase();
  
  // Fetch all gigs
  const { data: gigs, error: gigsError } = await supabase
    .from('gigs')
    .select('id, title');

  if (gigsError) {
    throw handleApiError(gigsError, 'fetch all gigs for bulk sync');
  }

  if (!gigs || gigs.length === 0) {
    return { success: true, total: 0, failed: 0 };
  }

  let failed = 0;

  for (let i = 0; i < gigs.length; i++) {
    const gig = gigs[i];
    try {
      const { error: invokeError } = await supabase.functions.invoke(
        'server/integrations/google-calendar/sync-gig-all-users',
        {
          method: 'POST',
          body: {
            gig_id: gig.id,
            origin: window.location.origin,
          },
        }
      );

      if (invokeError) throw invokeError;
    } catch (err) {
      const error = await handleFunctionsError(err, `invoke server sync for gig "${gig.title}" (${gig.id})`);
      console.error(error);
      failed++;
    }
    
    if (onProgress) {
      onProgress(i + 1, gigs.length);
    }
  }

  return { success: failed === 0, total: gigs.length, failed };
}
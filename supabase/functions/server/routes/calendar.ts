import type { App } from '../lib/types.ts';
import { requireUser } from '../lib/auth.ts';
import { requireGigAccess } from '../lib/gigAccess.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import { buildCalendarEvent, calendarAudienceOrgIds } from '../lib/pure/calendarEvent.ts';
import {
  tokenNeedsRefresh, isInvalidGrant, calendarFailure, connectedSettings, RECONNECT_MESSAGE,
} from '../lib/pure/googleCalendarAuth.ts';
import { log } from '../../_shared/log.ts';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/** A connection that can't be used until the person reconnects (revoked, expired or missing). */
class ReconnectRequired extends Error {}

function googleCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * A usable access token for a person's stored connection, refreshed and saved when it has
 * expired. A revoked or expired refresh token turns sync off and throws ReconnectRequired.
 */
async function validAccessToken(userId: string): Promise<{ accessToken: string; settings: any }> {
  const { data: settings } = await supabaseAdmin
    .from('user_google_calendar_settings').select('*').eq('user_id', userId).maybeSingle();
  if (!settings) throw new ReconnectRequired();
  if (!tokenNeedsRefresh(settings.token_expires_at)) return { accessToken: settings.access_token, settings };

  const creds = googleCredentials();
  if (!creds) throw new Error('Google Calendar credentials not configured on server');
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: settings.refresh_token, client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: 'refresh_token',
    }),
  });
  const tokenData = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (isInvalidGrant(tokenData)) {
      await supabaseAdmin.from('user_google_calendar_settings')
        .update({ is_enabled: false, updated_at: new Date().toISOString() }).eq('id', settings.id);
      throw new ReconnectRequired();
    }
    throw new Error(`Google token refresh failed (${response.status})`);
  }
  const tokenExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
  await supabaseAdmin.from('user_google_calendar_settings').update({
    access_token: tokenData.access_token, token_expires_at: tokenExpiresAt, updated_at: new Date().toISOString(),
  }).eq('id', settings.id);
  return { accessToken: tokenData.access_token, settings: { ...settings, token_expires_at: tokenExpiresAt } };
}

/** The response for an error on a calendar route: reconnect, our 403 advice, or a reference. */
function failed(c: any, context: string, err: unknown, googleStatus = 500) {
  if (err instanceof ReconnectRequired) return c.json({ error: RECONNECT_MESSAGE }, 409);
  const reference = crypto.randomUUID();
  log('error', 'request.failed', { context, reference, err });
  const failure = calendarFailure(googleStatus, reference);
  return c.json(failure.body, failure.status as any);
}

// Google Calendar integration. The OAuth tokens never leave the server: every route acts on the
// caller's own stored connection, and none accepts or returns a token. sync-gig-all-users also
// requires an active participation in the gig (Q-D; #175).
export function registerCalendar(app: App) {
  // Exchange the authorization code and store the connection.
  app.post('/integrations/google-calendar/connect', requireUser, async (c) => {
    const user = c.get('user');
    const { code, redirect_uri } = await c.req.json().catch(() => ({}));
    if (typeof code !== 'string' || !code || typeof redirect_uri !== 'string' || !redirect_uri) {
      return c.json({ error: 'code and redirect_uri are required' }, 400);
    }
    const creds = googleCredentials();
    if (!creds) return c.json({ error: 'Google Calendar is not configured on the server' }, 500);

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri, grant_type: 'authorization_code' }),
    });
    const tokenData = await response.json().catch(() => ({}));
    if (!response.ok || !tokenData.access_token || !tokenData.refresh_token) {
      const reference = crypto.randomUUID();
      log('error', 'calendar.token_exchange_failed', { reference, status: response.status, google_error: typeof tokenData?.error === 'string' ? tokenData.error : null });
      return c.json({ error: `Couldn't connect Google Calendar. Reference: ${reference}` }, 400);
    }

    const { data: existing } = await supabaseAdmin
      .from('user_google_calendar_settings').select('calendar_id, calendar_name').eq('user_id', user.id).maybeSingle();
    const { error } = await supabaseAdmin.from('user_google_calendar_settings').upsert({
      user_id: user.id,
      ...connectedSettings(existing),
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) return failed(c, 'Error saving the Google Calendar connection', error);
    return c.json({ connected: true });
  });

  // Revoke the tokens at Google and remove the connection. A failed revoke is logged; the
  // connection is removed either way.
  app.delete('/integrations/google-calendar/connection', requireUser, async (c) => {
    const user = c.get('user');
    const { data: settings } = await supabaseAdmin
      .from('user_google_calendar_settings').select('id, refresh_token, access_token').eq('user_id', user.id).maybeSingle();
    if (settings) {
      const token = settings.refresh_token || settings.access_token;
      try {
        const response = await fetch(GOOGLE_REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
        });
        if (!response.ok && response.status !== 400) {
          log('warn', 'calendar.token_revoke_rejected', { status: response.status });
        }
      } catch (err) {
        log('warn', 'calendar.token_revoke_failed', { err });
      }
      const { error } = await supabaseAdmin.from('user_google_calendar_settings').delete().eq('id', settings.id);
      if (error) return failed(c, 'Error removing the Google Calendar connection', error);
    }
    return c.json({ success: true });
  });

  app.post('/integrations/google-calendar/calendars', requireUser, async (c) => {
    try {
      const { accessToken } = await validAccessToken(c.get('user').id);
      const response = await fetch(`${CALENDAR_API}/users/me/calendarList`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const calData = await response.json().catch(() => ({}));
      if (!response.ok) return failed(c, 'Google Calendar list error', calData?.error, response.status);
      const calendars = (calData.items || []).map((cal: any) => ({
        id: cal.id, name: cal.summary || 'Unnamed Calendar', primary: cal.primary || false, accessRole: cal.accessRole || 'reader',
      }));
      return c.json({ calendars });
    } catch (err) {
      return failed(c, 'Error listing calendars', err);
    }
  });

  // Create or replace an event in the caller's chosen calendar.
  app.post('/integrations/google-calendar/events', requireUser, async (c) => {
    const { event_data, event_id } = await c.req.json().catch(() => ({}));
    if (!event_data || typeof event_data !== 'object') {
      return c.json({ error: 'event_data is required' }, 400);
    }
    try {
      const { accessToken, settings } = await validAccessToken(c.get('user').id);
      if (!settings.is_enabled || !settings.calendar_id) {
        return c.json({ error: 'Google Calendar sync is off or no calendar is chosen' }, 409);
      }
      const base = `${CALENDAR_API}/calendars/${encodeURIComponent(settings.calendar_id)}/events`;
      const response = await fetch(event_id ? `${base}/${encodeURIComponent(event_id)}` : base, {
        method: event_id ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event_data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return failed(c, 'Google Calendar event error', result?.error, response.status);
      return c.json({ event_id: result.id });
    } catch (err) {
      return failed(c, 'Error writing a calendar event', err);
    }
  });

  // Delete an event from the caller's chosen calendar; one already gone counts as deleted.
  app.delete('/integrations/google-calendar/events', requireUser, async (c) => {
    const { event_id } = await c.req.json().catch(() => ({}));
    if (typeof event_id !== 'string' || !event_id) {
      return c.json({ error: 'event_id is required' }, 400);
    }
    try {
      const { accessToken, settings } = await validAccessToken(c.get('user').id);
      if (!settings.calendar_id) return c.json({ success: true });
      const response = await fetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(settings.calendar_id)}/events/${encodeURIComponent(event_id)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok && response.status !== 404 && response.status !== 410) {
        const errorData = await response.json().catch(() => ({}));
        return failed(c, 'Google Calendar delete error', (errorData as any)?.error, response.status);
      }
      return c.json({ success: true });
    } catch (err) {
      return failed(c, 'Error deleting a calendar event', err);
    }
  });

  // Sync a gig to all relevant users' calendars. Q-D fix: requireGigAccess on
  // the body gig_id (was previously any-authenticated). Background work is
  // fire-and-forget, preserving the legacy behavior.
  app.post(
    '/integrations/google-calendar/sync-gig-all-users',
    requireUser,
    requireGigAccess(undefined, async (c) => (await c.req.json()).gig_id, { activeOnly: true }),
    async (c) => {
      const { gig_id } = await c.req.json();
      const origin = c.req.header('Origin') || '*';

      (async () => {
        try {
          const { data: gig, error: gigError } = await supabaseAdmin
            .from('gigs')
            .select(`*, participants:gig_participants(*, organization:organization_id(*)), staff_assignments:gig_staff_slots(assignments:gig_staff_assignments(user_id))`)
            .eq('id', gig_id).single();
          if (gigError || !gig) {
            log('error', 'calendar.sync_gig_fetch_failed', { gig_id, err: gigError });
            return;
          }

          const participantOrgIds = calendarAudienceOrgIds(gig.participants || []);
          const { data: orgMembers } = await supabaseAdmin
            .from('organization_members').select('user_id').in('organization_id', participantOrgIds);
          const assignedUserIds = gig.staff_assignments?.flatMap((s: any) => s.assignments?.map((a: any) => a.user_id)) || [];
          const memberUserIds = orgMembers?.map((m: any) => m.user_id) || [];
          const relevantUserIds = [...new Set([...assignedUserIds, ...memberUserIds])];
          if (relevantUserIds.length === 0) return;

          const { data: userSettings, error: settingsError } = await supabaseAdmin
            .from('user_google_calendar_settings').select('*').eq('is_enabled', true).in('user_id', relevantUserIds);
          if (settingsError) {
            log('error', 'calendar.sync_settings_fetch_failed', { err: settingsError });
            return;
          }
          if (!userSettings || userSettings.length === 0) return;

          const venue = gig.participants?.find((p: any) => p.role === 'Venue')?.organization;
          // Always all-day in the gig's local dates (#117). Updates use PUT,
          // which replaces the whole event, so a timed event becomes all-day.
          const eventData = buildCalendarEvent(gig, venue, `${origin || 'http://localhost:3000'}/gigs/${gig_id}`);

          for (const settings of userSettings) {
            try {
              let accessToken: string;
              try {
                ({ accessToken } = await validAccessToken(settings.user_id));
              } catch (tokenError) {
                if (!(tokenError instanceof ReconnectRequired)) {
                  log('error', 'calendar.sync_token_failed', { user_id: settings.user_id, err: tokenError });
                }
                continue;
              }

              const { data: existingSync } = await supabaseAdmin
                .from('gig_sync_status').select('google_event_id').eq('gig_id', gig_id).eq('user_id', settings.user_id).maybeSingle();

              const apiUrl = existingSync?.google_event_id
                ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.calendar_id)}/events/${encodeURIComponent(existingSync.google_event_id)}`
                : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.calendar_id)}/events`;
              const method_ = existingSync?.google_event_id ? 'PUT' : 'POST';

              const eventResponse = await fetch(apiUrl, {
                method: method_,
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(eventData),
              });

              if (eventResponse.ok) {
                const eventResult = await eventResponse.json();
                await supabaseAdmin.from('gig_sync_status').upsert({
                  gig_id, user_id: settings.user_id, google_event_id: eventResult.id,
                  sync_status: existingSync?.google_event_id ? 'updated' : 'synced',
                  last_synced_at: new Date().toISOString(), sync_error: null,
                }, { onConflict: 'gig_id,user_id' });
              } else {
                await eventResponse.body?.cancel();
                await supabaseAdmin.from('gig_sync_status').upsert({
                  gig_id, user_id: settings.user_id, sync_status: 'failed',
                  sync_error: eventResponse.status === 403
                    ? 'No permission to change events in this calendar'
                    : `Google Calendar error ${eventResponse.status}`,
                  last_synced_at: new Date().toISOString(),
                }, { onConflict: 'gig_id,user_id' });
              }
            } catch (userSyncError) {
              log('error', 'calendar.sync_user_failed', { user_id: settings.user_id, gig_id, err: userSyncError });
            }
          }
        } catch (syncError) {
          log('error', 'calendar.sync_failed', { gig_id, err: syncError });
        }
      })();

      return c.json({ success: true, message: 'Sync process started' });
    }
  );
}

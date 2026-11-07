// Google Calendar connection helpers, free of Deno imports so Vitest can test them. The tokens
// live only in user_google_calendar_settings and are used only by the server.

export const RECONNECT_MESSAGE = 'Google Calendar connection has expired or been revoked. Reconnect in settings.';
export const CALENDAR_PERMISSION_MESSAGE =
  'You don\'t have permission to change events in this Google Calendar. Ask its owner to share it with "Make changes to events" access, or connect with an account that owns it.';

/** Whether the stored access token has expired, or expires within a minute. */
export function tokenNeedsRefresh(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  const at = expiresAt ? new Date(expiresAt).getTime() : NaN;
  if (Number.isNaN(at)) return true;
  return at - now.getTime() <= 60_000;
}

/** Google's answer to a refresh with a revoked or expired refresh token. */
export function isInvalidGrant(body: { error?: unknown } | null | undefined): boolean {
  return body?.error === 'invalid_grant';
}

/** What the caller sees when a Google Calendar call fails: our advice for a 403, else a reference. */
export function calendarFailure(googleStatus: number, reference: string): { status: number; body: { error: string } } {
  if (googleStatus === 403) return { status: 403, body: { error: CALENDAR_PERMISSION_MESSAGE } };
  return { status: 502, body: { error: `Google Calendar request failed. Reference: ${reference}` } };
}

/**
 * The calendar fields for a connection being saved: a new one has no calendar chosen and sync
 * off; a reconnect keeps the calendar already chosen and turns sync back on.
 */
export function connectedSettings(existing: { calendar_id?: string | null; calendar_name?: string | null } | null) {
  if (existing?.calendar_id) {
    return { calendar_id: existing.calendar_id, calendar_name: existing.calendar_name ?? '', is_enabled: true };
  }
  return { calendar_id: '', calendar_name: '', is_enabled: false };
}

/** The organizations whose members may act on a gig: every participant, or only active ones. */
export function gigAccessOrgIds(
  participants: Array<{ organization_id: string; inactive?: boolean | null }>,
  options: { activeOnly?: boolean } = {},
): string[] {
  return participants.filter((p) => !options.activeOnly || !p.inactive).map((p) => p.organization_id);
}

import { describe, it, expect } from 'vitest';
import {
  tokenNeedsRefresh,
  isInvalidGrant,
  calendarFailure,
  connectedSettings,
  gigAccessOrgIds,
  RECONNECT_MESSAGE,
  CALENDAR_PERMISSION_MESSAGE,
} from './googleCalendarAuth';

const NOW = new Date('2026-11-07T12:00:00Z');

describe('tokenNeedsRefresh', () => {
  it('refreshes an expired token, or one expiring within a minute', () => {
    expect(tokenNeedsRefresh('2026-11-07T11:00:00Z', NOW)).toBe(true);
    expect(tokenNeedsRefresh('2026-11-07T12:00:30Z', NOW)).toBe(true);
    expect(tokenNeedsRefresh('2026-11-07T12:05:00Z', NOW)).toBe(false);
  });
  it('refreshes when the expiry is missing or unreadable', () => {
    expect(tokenNeedsRefresh(null, NOW)).toBe(true);
    expect(tokenNeedsRefresh('not a date', NOW)).toBe(true);
  });
});

describe('isInvalidGrant', () => {
  it("recognizes Google's answer for a revoked or expired refresh token", () => {
    expect(isInvalidGrant({ error: 'invalid_grant' })).toBe(true);
    expect(isInvalidGrant({ error: 'invalid_client' })).toBe(false);
    expect(isInvalidGrant(null)).toBe(false);
  });
});

describe('calendarFailure', () => {
  it('gives our permission advice for a 403, without Google\'s own text', () => {
    expect(calendarFailure(403, 'ref-1')).toEqual({ status: 403, body: { error: CALENDAR_PERMISSION_MESSAGE } });
  });
  it('gives a generic message with a reference otherwise', () => {
    expect(calendarFailure(500, 'ref-2')).toEqual({ status: 502, body: { error: 'Google Calendar request failed. Reference: ref-2' } });
    expect(calendarFailure(400, 'ref-3').status).toBe(502);
  });
  it('asks the person to reconnect', () => {
    expect(RECONNECT_MESSAGE).toBe('Google Calendar connection has expired or been revoked. Reconnect in settings.');
  });
});

describe('connectedSettings', () => {
  it('starts a new connection with no calendar chosen and sync off', () => {
    expect(connectedSettings(null)).toEqual({ calendar_id: '', calendar_name: '', is_enabled: false });
  });
  it('keeps the calendar already chosen on a reconnect, and turns sync back on', () => {
    expect(connectedSettings({ calendar_id: 'cal-1', calendar_name: 'Gigs' }))
      .toEqual({ calendar_id: 'cal-1', calendar_name: 'Gigs', is_enabled: true });
  });
});

describe('gigAccessOrgIds', () => {
  const participants = [
    { organization_id: 'org-a', inactive: false },
    { organization_id: 'org-b', inactive: true },
    { organization_id: 'org-c' },
  ];
  it('counts every participant by default', () => {
    expect(gigAccessOrgIds(participants)).toEqual(['org-a', 'org-b', 'org-c']);
  });
  it('counts only active participants when asked', () => {
    expect(gigAccessOrgIds(participants, { activeOnly: true })).toEqual(['org-a', 'org-c']);
  });
});

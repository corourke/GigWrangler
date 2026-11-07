import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAlertable, recipientsToNotify, isSentryConfigured, isAuthorizedCronRequest, timingSafeEqual } from './healthCheck';

describe('isAlertable', () => {
  it('alerts only on a real failure', () => {
    expect(isAlertable('fail')).toBe(true);
    expect(isAlertable('ok')).toBe(false);
    expect(isAlertable('not_configured')).toBe(false);
  });
});

describe('recipientsToNotify (dedup — one alert per incident)', () => {
  it('notifies every moderator when none has been notified yet', () => {
    expect(recipientsToNotify(['mod-1', 'mod-2'], [])).toEqual(['mod-1', 'mod-2']);
  });
  it('excludes a moderator who already has an unread alert for this check', () => {
    expect(recipientsToNotify(['mod-1', 'mod-2'], ['mod-1'])).toEqual(['mod-2']);
  });
  it('notifies nobody once every moderator already has an unread alert', () => {
    expect(recipientsToNotify(['mod-1', 'mod-2'], ['mod-1', 'mod-2'])).toEqual([]);
  });
  it('handles no moderators', () => {
    expect(recipientsToNotify([], [])).toEqual([]);
  });
});

describe('isSentryConfigured', () => {
  it('requires token, org slug, and project slug all present', () => {
    expect(isSentryConfigured('token', 'org', 'project')).toBe(true);
  });
  it('is false when any piece is missing', () => {
    expect(isSentryConfigured(null, 'org', 'project')).toBe(false);
    expect(isSentryConfigured('token', undefined, 'project')).toBe(false);
    expect(isSentryConfigured('token', 'org', '')).toBe(false);
    expect(isSentryConfigured(undefined, undefined, undefined)).toBe(false);
  });
});

describe('isAuthorizedCronRequest', () => {
  const secret = 'a'.repeat(64);
  it('accepts the exact bearer token', () => {
    expect(isAuthorizedCronRequest(`Bearer ${secret}`, secret)).toBe(true);
  });
  it('rejects a wrong, missing or non-Bearer token', () => {
    expect(isAuthorizedCronRequest(`Bearer ${'b'.repeat(64)}`, secret)).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCronRequest(null, secret)).toBe(false);
    expect(isAuthorizedCronRequest(secret, secret)).toBe(false);
  });
  it('rejects everything while HEALTH_CHECK_CRON_SECRET is unset', () => {
    expect(isAuthorizedCronRequest('Bearer ', undefined)).toBe(false);
    expect(isAuthorizedCronRequest('Bearer ', '')).toBe(false);
    expect(isAuthorizedCronRequest('Bearer undefined', undefined)).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('matches equal strings only', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('is what the cron check compares the token with', () => {
    const source = readFileSync('supabase/functions/server/lib/pure/healthCheck.ts', 'utf8');
    const body = source.slice(source.indexOf('export function isAuthorizedCronRequest'));
    expect(body).toMatch(/timingSafeEqual\(/);
    expect(body.slice(0, body.indexOf('\n}'))).not.toMatch(/===\s*expected/);
  });
});

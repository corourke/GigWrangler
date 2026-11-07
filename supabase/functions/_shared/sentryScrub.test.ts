import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scrubText, scrubEvent } from './sentryScrub';

describe('scrubText', () => {
  it('replaces email addresses', () => {
    expect(scrubText('Invite failed for pat.lee+x@example.co.uk today')).toBe('Invite failed for [email] today');
  });

  it('replaces bearer tokens and JWTs', () => {
    expect(scrubText('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer [token]');
    expect(scrubText('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here')).toBe('jwt [token] here');
  });

  it('replaces token-like query parameters', () => {
    expect(scrubText('https://x.test/cb?code=4/abc&state=1&access_token=ya29.zzz&refresh_token=1//r'))
      .toBe('https://x.test/cb?code=[token]&state=1&access_token=[token]&refresh_token=[token]');
  });

  it('leaves ordinary text alone', () => {
    expect(scrubText('Failed to load gig 42')).toBe('Failed to load gig 42');
  });
});

describe('scrubEvent', () => {
  it('scrubs strings throughout the event and drops the user\'s email and IP', () => {
    const event = {
      message: 'Error for pat@example.com',
      user: { id: 'u1', email: 'pat@example.com', ip_address: '1.2.3.4' },
      exception: { values: [{ type: 'Error', value: 'Bearer secret-token failed' }] },
      breadcrumbs: [{ message: 'GET /x?access_token=abc', data: { url: 'https://x.test/?token=abc' } }],
      request: { url: 'https://app.test/reset?code=xyz', headers: { Authorization: 'Bearer abc' } },
      extra: { count: 3, nested: { who: 'sam@example.org' } },
    };
    const out: any = scrubEvent(event);
    expect(out.message).toBe('Error for [email]');
    expect(out.user).toEqual({ id: 'u1' });
    expect(out.exception.values[0].value).toBe('Bearer [token] failed');
    expect(out.breadcrumbs[0].message).toBe('GET /x?access_token=[token]');
    expect(out.breadcrumbs[0].data.url).toBe('https://x.test/?token=[token]');
    expect(out.request.url).toBe('https://app.test/reset?code=[token]');
    expect(out.request.headers.Authorization).toBe('Bearer [token]');
    expect(out.extra).toEqual({ count: 3, nested: { who: '[email]' } });
  });

  it('is wired into the app and the edge functions as beforeSend', () => {
    expect(readFileSync('src/main.tsx', 'utf8')).toMatch(/beforeSend:\s*scrubEvent/);
    expect(readFileSync('supabase/functions/_shared/sentry.ts', 'utf8')).toMatch(/beforeSend:\s*scrubEvent/);
  });
});

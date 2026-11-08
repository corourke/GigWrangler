import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RATE_LIMITS, rateLimitError, type RateLimitAction } from './rateLimits';

describe('rate limits', () => {
  it('has the agreed limits', () => {
    const rules = (a: RateLimitAction) => RATE_LIMITS[a].map(r => [r.scope, r.max, r.windowHours]);
    expect(rules('org_create')).toEqual([['user', 5, 24]]);
    expect(rules('places')).toEqual([['user', 300, 1], ['all', 2000, 24]]);
    expect(rules('invitation_email')).toEqual([['user', 20, 1], ['org', 100, 24]]);
    expect(rules('access_request')).toEqual([['user', 10, 24]]);
  });

  it('allows anything under every limit', () => {
    expect(rateLimitError('org_create', { user: 4 })).toBeNull();
    expect(rateLimitError('places', { user: 299, all: 1999 })).toBeNull();
    expect(rateLimitError('invitation_email', { user: 19, org: 99 })).toBeNull();
    expect(rateLimitError('access_request', { user: 9 })).toBeNull();
  });

  it('stops at each limit with a plain message', () => {
    expect(rateLimitError('org_create', { user: 5 })).toBe('You can create up to 5 organizations in 24 hours. Try again later.');
    expect(rateLimitError('places', { user: 300, all: 0 })).toBe('Too many place searches (300 an hour). Try again later.');
    expect(rateLimitError('places', { user: 0, all: 2000 })).toBe('Place search is busy right now. Try again later.');
    expect(rateLimitError('invitation_email', { user: 20, org: 0 })).toBe('You can send up to 20 invitations an hour. Try again later.');
    expect(rateLimitError('invitation_email', { user: 0, org: 100 })).toBe('This organization can send up to 100 invitations in 24 hours. Try again later.');
    expect(rateLimitError('access_request', { user: 10 })).toBe('You can make up to 10 access requests in 24 hours. Try again later.');
  });

  it('reports the first limit reached, in order', () => {
    expect(rateLimitError('invitation_email', { user: 25, org: 150 })).toBe('You can send up to 20 invitations an hour. Try again later.');
  });
});

// Each limited route checks (and records) its limit before doing the work.
describe('routes apply their limits', () => {
  const route = (file: string) => readFileSync(`supabase/functions/server/routes/${file}`, 'utf8');
  const before = (source: string, limit: string, work: string) => {
    const i = source.indexOf(limit);
    const j = source.indexOf(work, i === -1 ? 0 : i);
    return i !== -1 && j !== -1 && i < j;
  };

  it('organization creation', () => {
    expect(before(route('organizations.ts'), "rateLimited(c, 'org_create'", ".from('organizations').insert(")).toBe(true);
  });
  it('invitation emails', () => {
    expect(before(route('organizations.ts'), "rateLimited(c, 'invitation_email'", 'inviteUserByEmail(')).toBe(true);
  });
  it('access requests', () => {
    expect(before(route('accessRequests.ts'), "rateLimited(c, 'access_request'", ".from('access_requests')")).toBe(true);
  });
  it('both Places calls', () => {
    const source = route('places.ts');
    expect(source.split("rateLimited(c, 'places'").length - 1).toBe(2);
    expect(before(source, "rateLimited(c, 'places'", 'fetch(')).toBe(true);
  });
});

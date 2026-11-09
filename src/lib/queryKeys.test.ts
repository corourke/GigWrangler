import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterGigChange, invalidateAfterGigListChange } from './queryKeys';

// A10: keys are hierarchical, so invalidating a gig or an organization's gigs reaches every
// cache entry under it.
const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => key[i] === part);

describe('queryKeys (A10)', () => {
  it("puts an organization's gig list and aggregates under its gigs key", () => {
    expect(startsWith(queryKeys.gigList('org-1'), queryKeys.gigs('org-1'))).toBe(true);
    expect(startsWith(queryKeys.gigAggregates('org-1'), queryKeys.gigs('org-1'))).toBe(true);
    expect(queryKeys.gigList('org-1')).not.toEqual(queryKeys.gigAggregates('org-1'));
  });

  it("puts a gig's child count, conflicts and history under its gig key", () => {
    const gig = queryKeys.gig('g1');
    expect(startsWith(queryKeys.gigChildCount('g1'), gig)).toBe(true);
    expect(startsWith(queryKeys.gigConflicts('g1', 'org-1', { start: 's', end: 'e', timezone: 'UTC', allDay: false }), gig)).toBe(true);
    expect(startsWith(queryKeys.gigActivity('g1'), gig)).toBe(true);
  });

  it('keys conflicts by the times they were checked for', () => {
    const a = queryKeys.gigConflicts('g1', 'org-1', { start: 's', end: 'e', timezone: 'UTC', allDay: false });
    const b = queryKeys.gigConflicts('g1', 'org-1', { start: 's2', end: 'e', timezone: 'UTC', allDay: false });
    expect(a).not.toEqual(b);
  });

  it('has a dashboard key per organization', () => {
    expect(queryKeys.dashboard('org-1')).not.toEqual(queryKeys.dashboard('org-2'));
  });

});

// Answers that depend on who is signed in are keyed by that person.
describe('user-scoped keys', () => {
  it('include the user id', () => {
    for (const key of [
      (u: string) => queryKeys.recentActivity(u),
      (u: string) => queryKeys.notifications(u),
      (u: string) => queryKeys.moderatorAccessRequests(u),
    ]) {
      expect(key('user-a')).toContain('user-a');
      expect(key('user-a')).not.toEqual(key('user-b'));
    }
  });

  it('share a prefix per kind, so one invalidation reaches every user\'s copy', () => {
    expect(startsWith(queryKeys.moderatorAccessRequests('user-a'), queryKeys.moderatorAccessRequestsAll())).toBe(true);
  });
});

describe('invalidation (A10)', () => {
  it('a changed gig refreshes the gig, its organization\'s gig list and dashboard', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await invalidateAfterGigChange(qc, { gigId: 'g1', organizationId: 'org-1' });
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([queryKeys.gig('g1'), queryKeys.gigs('org-1'), queryKeys.dashboard('org-1')]));
  });

  it('an added or removed gig refreshes the gig list and dashboard', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await invalidateAfterGigListChange(qc, 'org-1');
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([queryKeys.gigs('org-1'), queryKeys.dashboard('org-1')]));
  });
});

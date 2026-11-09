import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterGigChange, invalidateAfterGigListChange, invalidateAfterStaffingChange } from './queryKeys';

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

  it('has a dashboard key per organization and one recent-activity key', () => {
    expect(queryKeys.dashboard('org-1')).not.toEqual(queryKeys.dashboard('org-2'));
    expect(queryKeys.recentActivity()).toEqual(queryKeys.recentActivity());
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

describe('gig section keys (A10, PR 2)', () => {
  it("puts each section's data under its gig", () => {
    const gig = queryKeys.gig('g1');
    for (const key of [
      queryKeys.gigStaffSlots('g1', 'org-1'),
      queryKeys.gigParticipants('g1'),
      queryKeys.gigKitAssignments('g1', 'org-1'),
      queryKeys.gigEquipmentConflicts('g1', 'org-1', { start: 's', end: 'e', timezone: 'UTC', allDay: false }),
      queryKeys.gigEquipmentNeeded('g1', 'org-1', { start: 's', end: 'e', timezone: 'UTC', allDay: false }, 0),
    ]) expect(startsWith(key, gig)).toBe(true);
  });

  it('keys equipment needed by its refresh count', () => {
    const when = { start: 's', end: 'e', timezone: 'UTC', allDay: false };
    expect(queryKeys.gigEquipmentNeeded('g1', 'org-1', when, 0)).not.toEqual(queryKeys.gigEquipmentNeeded('g1', 'org-1', when, 1));
  });

  it("a staffing change refreshes the gig's money figures and the dashboard", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await invalidateAfterStaffingChange(qc, { gigId: 'g1', organizationId: 'org-1' });
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([
      queryKeys.gigFinancialsSummary('g1'), queryKeys.gigProjectedStaff('g1'), queryKeys.dashboard('org-1'),
    ]));
  });
});

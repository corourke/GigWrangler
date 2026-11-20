import { describe, it, expect, vi, beforeEach } from 'vitest';

let result: { data: unknown; error: unknown } = { data: null, error: null };
const calls: unknown[][] = [];
const chain: any = new Proxy({}, {
  get: (_t, prop: string) => {
    if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
    if (prop === 'maybeSingle') return async () => result;
    return (...args: unknown[]) => { calls.push([prop, ...args]); return chain; };
  },
});
vi.mock('../base/dataAccess', () => ({
  getSupabase: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => { calls.push(['from', t]); return chain; },
  }),
}));
vi.mock('../../utils/idb/store', () => ({ idbStore: {} }));
vi.mock('./staffDashboard.service', () => ({ fetchMyUpcomingAssignments: vi.fn() }));
vi.mock('../gig.service', () => ({ updateStaffAssignmentStatus: vi.fn() }));
vi.mock('./offlineSync.service', () => ({ offlineSyncService: { queueTrackingUpdate: vi.fn() } }));

import { fetchMyAssignmentState, fetchMyAssignment } from './myAssignments.service';

const NOW = new Date('2026-11-10T12:00:00Z');
const row = (status: string, gig: Record<string, unknown>, userId = 'u1') => ({ data: { id: 'a-1', user_id: userId, status, slot: { gig } }, error: null });
const coming = { status: 'Booked', start: '2026-11-12T20:00:00Z', end: '2026-11-12T23:00:00Z' };

beforeEach(() => { calls.length = 0; });

describe('fetchMyAssignmentState (#457)', () => {
  it('asks for the one assignment by id', async () => {
    result = row('Invited', coming);
    await fetchMyAssignmentState('a-1', NOW);
    expect(calls).toContainEqual(['from', 'gig_staff_assignments']);
    expect(calls).toContainEqual(['eq', 'id', 'a-1']);
  });
  it('is open for an invite on a coming gig, answered once answered', async () => {
    result = row('Requested', coming);
    expect(await fetchMyAssignmentState('a-1', NOW)).toBe('open');
    result = row('Confirmed', coming);
    expect(await fetchMyAssignmentState('a-1', NOW)).toBe('Confirmed');
  });
  it('is closed when the assignment is not visible (gone, or not theirs), or the gig is cancelled or over', async () => {
    result = { data: null, error: null };
    expect(await fetchMyAssignmentState('a-1', NOW)).toBe('closed');
    result = row('Invited', { ...coming, status: 'Cancelled' });
    expect(await fetchMyAssignmentState('a-1', NOW)).toBe('closed');
    result = row('Invited', { ...coming, end: '2026-11-09T23:00:00Z' });
    expect(await fetchMyAssignmentState('a-1', NOW)).toBe('closed');
  });
  it('throws when the lookup fails, so the row shows nothing extra', async () => {
    result = { data: null, error: new Error('network') };
    await expect(fetchMyAssignmentState('a-1', NOW)).rejects.toThrow('network');
  });
});

describe('fetchMyAssignment (#457 part 2)', () => {
  it('gives the state with the role and the gig, for the reply sheet', async () => {
    result = { data: { id: 'a-1', user_id: 'u1', status: 'Invited', slot: { staff_role: { name: 'FOH' }, gig: { id: 'g1', title: 'Spring Gala', timezone: 'UTC', all_day: false, ...coming } } }, error: null };
    expect(await fetchMyAssignment('a-1', NOW)).toEqual({
      state: 'open', role: 'FOH',
      gig: { id: 'g1', title: 'Spring Gala', timezone: 'UTC', all_day: false, ...coming },
    });
  });
  it('is closed with no gig when the assignment is not visible', async () => {
    result = { data: null, error: null };
    expect(await fetchMyAssignment('a-1', NOW)).toEqual({ state: 'closed', role: null, gig: null });
  });
});

// Show an invite only to the person it was sent to (Docs Lead smoke, 11-19).
describe("an assignment that isn't the signed-in person's", () => {
  const someoneElses = row('Invited', coming, 'someone-else');
  it('is no longer needed for the bell state, even when the row can be read', async () => {
    result = someoneElses;
    expect(await fetchMyAssignmentState('a-1', NOW)).toBe('closed');
  });
  it('shows nothing of the role or the gig for the reply sheet', async () => {
    result = { data: { ...someoneElses.data, slot: { staff_role: { name: 'FOH' }, gig: { id: 'g1', title: 'Spring Gala', ...coming } } }, error: null };
    expect(await fetchMyAssignment('a-1', NOW)).toEqual({ state: 'closed', role: null, gig: null });
  });
  it('still shows the signed-in person their own', async () => {
    result = row('Invited', coming, 'u1');
    expect(await fetchMyAssignmentState('a-1', NOW)).toBe('open');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Plan #445 (A2b): each "Needs you" count is one query or server call.
const calls: Array<[string, ...unknown[]]> = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };
const chain: any = new Proxy({}, {
  get: (_t, prop: string) => {
    if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
    return (...args: unknown[]) => { calls.push([prop, ...args]); return chain; };
  },
});
vi.mock('../base/dataAccess', () => ({
  getSupabase: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => { calls.push(['from', table]); return chain; },
  }),
}));
vi.mock('../accessRequest.service', () => ({ getOrgAccessRequests: vi.fn() }));
vi.mock('../purchaseScanQueue.service', () => ({ listScanQueue: vi.fn() }));

import { getOrgAccessRequests } from '../accessRequest.service';
import { listScanQueue } from '../purchaseScanQueue.service';
import { fetchMyInvites, fetchOpenCrewSpots, fetchPaymentsDue, fetchAccessRequestCount, fetchReceiptsToReview } from './needsYou.service';

const NOW = new Date('2026-11-10T17:00:00Z');
beforeEach(() => { calls.length = 0; result = { data: [], error: null }; vi.clearAllMocks(); });

describe('needsYou.service', () => {
  it("invites: the person's Requested and Invited assignments, still to come", async () => {
    result = { data: [
      { id: 'a1', status: 'Requested', slot: { organization_id: 'o1', staff_role: { name: 'FOH' }, gig: { id: 'g1', title: 'Show', start: '2026-11-12T20:00:00Z', end: '2026-11-12T23:00:00Z', timezone: 'UTC', all_day: false, status: 'Booked' } } },
      { id: 'a2', status: 'Requested', slot: { organization_id: 'o1', staff_role: null, gig: { id: 'g2', title: 'Gone', start: '2026-11-01T20:00:00Z', end: '2026-11-01T23:00:00Z', timezone: 'UTC', all_day: false, status: 'Booked' } } },
    ], error: null };
    const invites = await fetchMyInvites(NOW);
    expect(calls).toContainEqual(['from', 'gig_staff_assignments']);
    expect(calls).toContainEqual(['eq', 'user_id', 'u1']);
    expect(calls).toContainEqual(['in', 'status', ['Requested', 'Invited']]);
    expect(invites).toEqual([{ assignmentId: 'a1', role: 'FOH', gig: expect.objectContaining({ id: 'g1', title: 'Show' }) }]);
  });

  it("open crew spots: the organization's slots on gigs in the next 14 days", async () => {
    result = { data: [{ required_count: 2, gig: { id: 'g1', title: 'Show', start: '2026-11-12T20:00:00Z', end: '2026-11-12T23:00:00Z', status: 'Booked' }, assignments: [{ status: 'Declined' }] }], error: null };
    const spots = await fetchOpenCrewSpots('org-1', NOW);
    expect(calls).toContainEqual(['from', 'gig_staff_slots']);
    expect(calls).toContainEqual(['eq', 'organization_id', 'org-1']);
    expect(calls).toContainEqual(['gte', 'gig.start', '2026-11-10T17:00:00.000Z']);
    expect(calls).toContainEqual(['lte', 'gig.start', '2026-11-24T17:00:00.000Z']);
    expect(spots.spots).toBe(2);
  });

  it("payments: the organization's unpaid lines due on or before today", async () => {
    result = { data: [{ id: 'f1', due_date: '2026-11-10', stage: 'invoiced', direction: 'in', gig: { id: 'g1', title: 'Show' } }], error: null };
    const due = await fetchPaymentsDue('org-1', '2026-11-10');
    expect(calls).toContainEqual(['from', 'gig_financials']);
    expect(calls).toContainEqual(['eq', 'organization_id', 'org-1']);
    expect(calls).toContainEqual(['lte', 'due_date', '2026-11-10']);
    expect(calls).toContainEqual(['in', 'stage', ['accepted', 'contract_sent', 'contracted', 'invoiced']]);
    expect(due).toEqual({ due: 1, overdue: 0, lines: [expect.objectContaining({ id: 'f1', gigId: 'g1', gigTitle: 'Show', direction: 'in' })] });
  });

  it('access requests: the pending ones the server returns for the role', async () => {
    vi.mocked(getOrgAccessRequests).mockResolvedValue([{ id: 'r1' }, { id: 'r2' }] as any);
    expect(await fetchAccessRequestCount('org-1')).toBe(2);
    expect(getOrgAccessRequests).toHaveBeenCalledWith('org-1');
  });

  it('receipts: what is still in the scan queue', async () => {
    vi.mocked(listScanQueue).mockResolvedValue([{ id: 'q1', status: 'ready', file_name: 'a.jpg' }, { id: 'q2', status: 'failed', file_name: 'b.jpg' }] as any);
    expect((await fetchReceiptsToReview('org-1')).map((r) => r.id)).toEqual(['q1', 'q2']);
  });

  it('passes errors on', async () => {
    result = { data: null, error: new Error('nope') };
    await expect(fetchPaymentsDue('org-1', '2026-11-10')).rejects.toThrow('nope');
  });
});

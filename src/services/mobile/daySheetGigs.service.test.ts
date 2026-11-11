import { describe, it, expect, vi, beforeEach } from 'vitest';

// Plan #445 (A1): "Choose another gig" for Staff lists their own assignments, upcoming and the
// last 30 days; gigs whose sheet is saved on the phone are marked.
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
vi.mock('../../utils/idb/store', () => ({ idbStore: { getAllDayOfShow: vi.fn(), getGigs: vi.fn() } }));

import { idbStore } from '../../utils/idb/store';
import { listMyDaySheetGigs, listSavedSheetIds, listOfflineGigs } from './daySheetGigs.service';

const NOW = new Date('2026-11-10T17:00:00Z');
const gig = (id: string, start: string, status = 'Booked') =>
  ({ id, title: `Gig ${id}`, start, end: start, timezone: 'UTC', all_day: false, status });

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
});

describe('listMyDaySheetGigs', () => {
  it("asks for the person's assignments on gigs from 30 days ago on, leaving out declined ones", async () => {
    await listMyDaySheetGigs(NOW);
    expect(calls).toContainEqual(['from', 'gig_staff_assignments']);
    expect(calls).toContainEqual(['eq', 'user_id', 'u1']);
    expect(calls).toContainEqual(['neq', 'status', 'Declined']);
    expect(calls).toContainEqual(['gte', 'slot.gig.start', '2026-10-11T17:00:00.000Z']);
  });

  it('returns each gig once, soonest first, without cancelled gigs', async () => {
    result = {
      data: [
        { slot: { gig: gig('b', '2026-11-20T20:00:00Z') } },
        { slot: { gig: gig('a', '2026-11-01T20:00:00Z') } },
        { slot: { gig: gig('b', '2026-11-20T20:00:00Z') } },
        { slot: { gig: gig('c', '2026-11-15T20:00:00Z', 'Cancelled') } },
      ],
      error: null,
    };
    const gigs = await listMyDaySheetGigs(NOW);
    expect(gigs.map((g) => g.id)).toEqual(['a', 'b']);
    expect(gigs[0]).toEqual({ id: 'a', title: 'Gig a', start: '2026-11-01T20:00:00Z', end: '2026-11-01T20:00:00Z', timezone: 'UTC', all_day: false, status: 'Booked' });
  });

  it('passes errors on', async () => {
    result = { data: null, error: new Error('nope') };
    await expect(listMyDaySheetGigs(NOW)).rejects.toThrow('nope');
  });
});

describe('listSavedSheetIds', () => {
  it('lists the gigs whose sheet is on the phone', async () => {
    vi.mocked(idbStore.getAllDayOfShow).mockResolvedValue([{ gig_id: 'a' }, { gig_id: 'b' }] as any);
    expect(await listSavedSheetIds()).toEqual(new Set(['a', 'b']));
  });

  it('is empty when the phone has no store', async () => {
    vi.mocked(idbStore.getAllDayOfShow).mockRejectedValue(new Error('no idb'));
    expect(await listSavedSheetIds()).toEqual(new Set());
  });
});

describe('listOfflineGigs', () => {
  it("lists the organization's gigs on the phone and the gigs whose sheet is saved, each once", async () => {
    vi.mocked(idbStore.getGigs).mockResolvedValue([
      { ...gig('a', '2026-11-12T20:00:00Z'), participants: [{ organization_id: 'org-1' }] },
      { ...gig('x', '2026-11-12T20:00:00Z'), participants: [{ organization_id: 'org-9' }] },
    ] as any);
    vi.mocked(idbStore.getAllDayOfShow).mockResolvedValue([{ gig_id: 'a', gig: gig('a', '2026-11-12T20:00:00Z') }, { gig_id: 'b', gig: gig('b', '2026-11-14T20:00:00Z') }] as any);
    expect((await listOfflineGigs('org-1')).map((g) => g.id)).toEqual(['a', 'b']);
  });
});

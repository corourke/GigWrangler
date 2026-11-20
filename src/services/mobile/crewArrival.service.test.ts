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
const getDayOfShow = vi.fn();
const putDayOfShow = vi.fn();
vi.mock('../../utils/idb/store', () => ({ idbStore: { getDayOfShow: (...a: unknown[]) => getDayOfShow(...a), putDayOfShow: (...a: unknown[]) => putDayOfShow(...a) } }));
const queue = vi.fn();
vi.mock('./offlineSync.service', () => ({ offlineSyncService: { queueTrackingUpdate: (...a: unknown[]) => queue(...a) } }));

import { fetchMyArrival, recordMyArrival, undoMyArrival } from './crewArrival.service';

const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true });
const NOW = new Date('2026-11-10T22:42:00Z');

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  setOnline(true);
  result = { data: null, error: null };
  getDayOfShow.mockResolvedValue({ gig_id: 'g1', saved_at: 1, my_arrival: null });
});

describe('fetchMyArrival (#458)', () => {
  it("reads the signed-in person's own row for the gig", async () => {
    result = { data: { arrived_at: '2026-11-10T22:00:00Z', set_by: 'u1' }, error: null };
    expect(await fetchMyArrival('g1')).toEqual({ arrived_at: '2026-11-10T22:00:00Z', by_manager: false });
    expect(calls).toContainEqual(['from', 'gig_crew_arrivals']);
    expect(calls).toContainEqual(['eq', 'gig_id', 'g1']);
    expect(calls).toContainEqual(['eq', 'user_id', 'u1']);
  });
  it('says when a Manager or Admin set it', async () => {
    result = { data: { arrived_at: '2026-11-10T22:00:00Z', set_by: 'someone-else' }, error: null };
    expect((await fetchMyArrival('g1'))?.by_manager).toBe(true);
  });
  it('is null when there is none', async () => {
    expect(await fetchMyArrival('g1')).toBeNull();
  });
});

describe('recordMyArrival', () => {
  it('online: saves the phone\'s time for the person and the gig', async () => {
    const r = await recordMyArrival('g1', NOW);
    expect(r).toEqual({ outcome: 'saved', arrived_at: NOW.toISOString() });
    expect(calls).toContainEqual(['upsert', { gig_id: 'g1', user_id: 'u1', arrived_at: NOW.toISOString() }, { onConflict: 'gig_id,user_id' }]);
    expect(queue).not.toHaveBeenCalled();
  });
  it('online: throws when the server refuses', async () => {
    result = { data: null, error: new Error('refused') };
    await expect(recordMyArrival('g1', NOW)).rejects.toThrow('refused');
  });
  it("offline: queues it and keeps it on the phone's copy of the sheet as waiting to send", async () => {
    setOnline(false);
    const r = await recordMyArrival('g1', NOW);
    expect(r).toEqual({ outcome: 'queued', arrived_at: NOW.toISOString() });
    expect(queue).toHaveBeenCalledWith({ gigId: 'g1', userId: 'u1', arrivedAt: NOW.toISOString() }, 'CREW_ARRIVAL');
    expect(putDayOfShow).toHaveBeenCalledWith(expect.objectContaining({ gig_id: 'g1', my_arrival: { arrived_at: NOW.toISOString(), by_manager: false, pending: true } }));
    expect(calls.find((c) => c[0] === 'upsert')).toBeUndefined();
  });
});

describe('undoMyArrival', () => {
  it('online: removes it', async () => {
    result = { data: [{ gig_id: 'g1' }], error: null };
    expect(await undoMyArrival('g1')).toBe('undone');
    expect(calls).toContainEqual(['delete']);
    expect(calls).toContainEqual(['eq', 'gig_id', 'g1']);
    expect(calls).toContainEqual(['eq', 'user_id', 'u1']);
  });
  it('online: says locked when nothing was removed (a Manager or Admin set it)', async () => {
    result = { data: [], error: null };
    expect(await undoMyArrival('g1')).toBe('locked');
  });
  it('offline: queues the removal and clears it from the phone\'s copy', async () => {
    setOnline(false);
    getDayOfShow.mockResolvedValue({ gig_id: 'g1', saved_at: 1, my_arrival: { arrived_at: NOW.toISOString(), by_manager: false, pending: true } });
    expect(await undoMyArrival('g1')).toBe('queued');
    expect(queue).toHaveBeenCalledWith({ gigId: 'g1', userId: 'u1', arrivedAt: null }, 'CREW_ARRIVAL');
    expect(putDayOfShow).toHaveBeenCalledWith(expect.objectContaining({ gig_id: 'g1', my_arrival: null }));
  });
});

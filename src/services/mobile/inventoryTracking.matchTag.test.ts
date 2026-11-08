import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => {
  const calls: { table: string; eq: [string, unknown][] }[] = [];
  const results: Record<string, any[]> = {};
  const from = vi.fn((table: string) => {
    const call = { table, eq: [] as [string, unknown][] };
    calls.push(call);
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => { call.eq.push([col, val]); return chain; });
    chain.limit = vi.fn(async () => ({ data: results[table] ?? [], error: null }));
    return chain;
  });
  return { calls, results, from };
});

vi.mock('../../utils/supabase/client', () => ({ createClient: () => ({ from: db.from }) }));
vi.mock('../../utils/idb/store', () => ({ idbStore: { getPackingList: vi.fn(), putPackingList: vi.fn() } }));
vi.mock('./offlineSync.service', () => ({ offlineSyncService: { queueTrackingUpdate: vi.fn(), processOutbox: vi.fn() } }));

import { inventoryTrackingService } from './inventoryTracking.service';

// B14: a scanned tag is looked up in the selected organization only. Tags are unique per
// organization, so another organization's kit or unit with the same tag must not be found.
describe('matchTag', () => {
  beforeEach(() => { db.calls.length = 0; for (const k of Object.keys(db.results)) delete db.results[k]; });

  it('looks for kits and units in the selected organization', async () => {
    db.results.assets = [{ id: 'a1', tag_number: 'K12-2' }];
    const found = await inventoryTrackingService.matchTag(' K12-2 ', 'org-a');
    expect(found).toEqual({ type: 'asset', item: { id: 'a1', tag_number: 'K12-2' } });
    for (const table of ['kits', 'assets']) {
      const call = db.calls.find(c => c.table === table)!;
      expect(call.eq).toEqual(expect.arrayContaining([['organization_id', 'org-a'], ['tag_number', 'K12-2']]));
    }
  });

  it('finds a kit first', async () => {
    db.results.kits = [{ id: 'k1', name: 'Rack', tag_number: 'R1', is_container: true }];
    expect(await inventoryTrackingService.matchTag('R1', 'org-a')).toMatchObject({ type: 'kit' });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// A stand-in for idb's openDB: records the upgrade and which stores each transaction clears.
const created: string[] = [];
const cleared: string[][] = [];
const rows = new Map<string, any>();

vi.mock('idb', () => ({
  openDB: vi.fn(async (_name: string, _version: number, opts: any) => {
    opts.upgrade(
      { createObjectStore: (name: string) => { created.push(name); return { createIndex: vi.fn() }; } },
      4, 6, { objectStoreNames: [] },
    );
    return {
      put: vi.fn(async (_store: string, value: any) => { rows.set(value.gig_id, value); }),
      get: vi.fn(async (_store: string, key: string) => rows.get(key)),
      getAll: vi.fn(async () => [...rows.values()]),
      delete: vi.fn(async (_store: string, key: string) => { rows.delete(key); }),
      transaction: (stores: string[]) => {
        cleared.push([...stores]);
        return { objectStore: () => ({ clear: vi.fn(async () => {}) }), done: Promise.resolve() };
      },
    };
  }),
}));

import { idbStore } from './store';

describe('the day-of-show store on the phone (§3e)', () => {
  beforeEach(() => { cleared.length = 0; rows.clear(); });

  it('is added by the version 5 upgrade, and its documents store by version 6', async () => {
    await idbStore.getDayOfShow('g1');
    expect(created).toEqual(['day_of_show', 'day_of_show_files']);
  });

  it('keeps one saved sheet per gig', async () => {
    await idbStore.putDayOfShow({ gig_id: 'g1', saved_at: 1 } as any);
    await idbStore.putDayOfShow({ gig_id: 'g1', saved_at: 2 } as any);
    expect(await idbStore.getDayOfShow('g1')).toEqual({ gig_id: 'g1', saved_at: 2 });
    expect(await idbStore.getAllDayOfShow()).toHaveLength(1);
    await idbStore.deleteDayOfShow('g1');
    expect(await idbStore.getDayOfShow('g1')).toBeUndefined();
  });

  it('is cleared with the other cached data, and at sign-out', async () => {
    await idbStore.clearCaches();
    await idbStore.clearAll();
    expect(cleared[0]).toContain('day_of_show');
    expect(cleared[1]).toContain('day_of_show');
    expect(cleared[1]).toContain('outbox');
    expect(cleared[0]).toContain('day_of_show_files');
    expect(cleared[1]).toContain('day_of_show_files');
  });
});

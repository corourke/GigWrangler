import { describe, it, expect, vi } from 'vitest';

// Receipts kept on the phone (mobile receipt capture, 11-10) live in the outbox, with their
// files. A stand-in for idb's openDB records which stores each transaction clears.
const cleared: string[][] = [];
vi.mock('idb', () => ({
  openDB: vi.fn(async (_name: string, _version: number, opts: any) => {
    opts.upgrade({ createObjectStore: () => ({ createIndex: vi.fn() }) }, 5, 5, { objectStoreNames: [] });
    return {
      transaction: (stores: string[]) => {
        cleared.push([...stores]);
        return { objectStore: () => ({ clear: vi.fn(async () => {}) }), done: Promise.resolve() };
      },
    };
  }),
}));

import { idbStore } from './store';

describe('receipts kept on the phone', () => {
  it('are cleared at sign-out, with everything else (clearAll clears the outbox)', async () => {
    await idbStore.clearAll();
    expect(cleared.at(-1)).toContain('outbox');
  });

  it('stay through a sign-in that finds no owner recorded (clearCaches keeps the outbox)', async () => {
    await idbStore.clearCaches();
    expect(cleared.at(-1)).not.toContain('outbox');
  });
});

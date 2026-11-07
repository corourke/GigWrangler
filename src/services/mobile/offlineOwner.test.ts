import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/idb/store', () => ({ idbStore: { clearAll: vi.fn().mockResolvedValue(undefined) } }));

import { idbStore } from '../../utils/idb/store';
import { claimOfflineStore, releaseOfflineStore, OFFLINE_OWNER_KEY } from './offlineOwner';

// The phone's offline copy (gigs, packing lists, staff assignments, kits and equipment, and changes
// waiting to sync) belongs to one signed-in person at a time.
describe('offline store owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('clears the store the first time someone signs in on this device, and remembers them', async () => {
    await claimOfflineStore('user-1');
    expect(idbStore.clearAll).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(OFFLINE_OWNER_KEY)).toBe('user-1');
  });

  it('keeps the store when the same person signs in again', async () => {
    localStorage.setItem(OFFLINE_OWNER_KEY, 'user-1');
    await claimOfflineStore('user-1');
    expect(idbStore.clearAll).not.toHaveBeenCalled();
  });

  it('clears it when someone else signs in', async () => {
    localStorage.setItem(OFFLINE_OWNER_KEY, 'user-1');
    await claimOfflineStore('user-2');
    expect(idbStore.clearAll).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(OFFLINE_OWNER_KEY)).toBe('user-2');
  });

  it('clears it and forgets the owner on sign-out', async () => {
    localStorage.setItem(OFFLINE_OWNER_KEY, 'user-1');
    await releaseOfflineStore();
    expect(idbStore.clearAll).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(OFFLINE_OWNER_KEY)).toBeNull();
  });

  it('still clears when the browser blocks storage', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    await claimOfflineStore('user-1');
    expect(idbStore.clearAll).toHaveBeenCalledTimes(1);
    get.mockRestore();
  });
});

import { idbStore } from '../../utils/idb/store';

/**
 * The phone's offline copy (gigs, packing lists, staff assignments, kits and equipment, day-of-show
 * sheets, and changes waiting to sync) belongs to one signed-in person at a time. Claimed at sign-in: cleared first if
 * someone else had it (only the cached data if no owner was recorded). Cleared again at sign-out.
 */
export const OFFLINE_OWNER_KEY = 'gw.offlineOwner';

function readOwner(): string | null {
  try {
    return localStorage.getItem(OFFLINE_OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OFFLINE_OWNER_KEY, userId);
    else localStorage.removeItem(OFFLINE_OWNER_KEY);
  } catch {
    // Storage blocked: the store is cleared at every sign-in instead.
  }
}

export async function claimOfflineStore(userId: string): Promise<void> {
  const owner = readOwner();
  if (owner === userId) return;
  if (owner) {
    // Someone else's: none of it is this person's.
    await idbStore.clearAll();
  } else {
    // No owner recorded (the first sign-in after this update, or storage blocked): the cached data
    // goes. Queued changes stay: those that name no one were queued on this phone by the older app,
    // and are adopted by the person signed in now; any naming someone else are dropped when the
    // outbox is processed (offlineSyncService.processOutbox).
    await idbStore.clearCaches();
    await idbStore.adoptUnownedOutbox(userId);
  }
  writeOwner(userId);
}

export async function releaseOfflineStore(): Promise<void> {
  await idbStore.clearAll();
  writeOwner(null);
}

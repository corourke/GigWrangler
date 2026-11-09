/**
 * My Schedule on mobile: the device copy first, then the server's (A10). The IndexedDB copy is
 * kept here in the service layer; the screen only reads what this returns.
 */
import { idbStore } from '../../utils/idb/store';
import { fetchMyUpcomingAssignments, type StaffDashboardGig } from './staffDashboard.service';
import { updateStaffAssignmentStatus } from '../gig.service';
import { offlineSyncService } from './offlineSync.service';

/**
 * Hands any device copy to `onCached` straight away, then (online) fetches the fresh list and
 * stores it on the device. Offline it returns the device copy, or undefined when there is none
 * (keep what is shown).
 */
export async function loadMyUpcomingAssignments(
  onCached: (cached: StaffDashboardGig[]) => void,
): Promise<StaffDashboardGig[] | undefined> {
  const cached = (await idbStore.getStaffAssignments().catch(() => [])) as StaffDashboardGig[];
  if (cached.length > 0) onCached(cached);

  if (!navigator.onLine) return cached.length > 0 ? cached : undefined;

  const fresh = await fetchMyUpcomingAssignments();
  await idbStore.putStaffAssignments(fresh).catch(() => {});
  return fresh;
}

/** Confirm or decline: sent now when online, queued for the next sync when offline. */
export async function setMyAssignmentStatus(assignmentId: string, status: 'Confirmed' | 'Declined'): Promise<void> {
  if (navigator.onLine) {
    await updateStaffAssignmentStatus(assignmentId, status);
  } else {
    await offlineSyncService.queueTrackingUpdate({ assignmentId, status }, 'STAFF_ASSIGNMENT_UPDATE');
  }
}

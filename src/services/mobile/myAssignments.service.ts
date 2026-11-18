/**
 * My Schedule on mobile: the device copy first, then the server's (A10). The IndexedDB copy is
 * kept here in the service layer; the screen only reads what this returns.
 */
import { idbStore } from '../../utils/idb/store';
import { fetchMyUpcomingAssignments, type StaffDashboardGig } from './staffDashboard.service';
import { updateStaffAssignmentStatus } from '../gig.service';
import { offlineSyncService } from './offlineSync.service';
import { getSupabase } from '../base/dataAccess';
import { inviteState, type InviteState } from '../../utils/needsYou';

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

/** One of the signed-in person's own assignments with its role and gig (#457). */
export interface MyAssignment {
  state: InviteState;
  role: string | null;
  gig: { id: string; title: string; start: string; end?: string | null; timezone?: string | null; all_day?: boolean | null; status?: string | null } | null;
}

/**
 * Where one of the signed-in person's own assignments stands, with its role and gig (#457): open
 * to reply to, already answered, or no longer needed (gone, cancelled, over, or not theirs).
 */
export async function fetchMyAssignment(assignmentId: string, now: Date = new Date()): Promise<MyAssignment> {
  const { data, error } = await getSupabase()
    .from('gig_staff_assignments')
    .select('id, status, slot:gig_staff_slots!inner(staff_role:staff_roles(name), gig:gigs!inner(id, title, status, start, end, timezone, all_day))')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error) throw error;
  const gig = (data as any)?.slot?.gig;
  if (!data || !gig) return { state: 'closed', role: null, gig: null };
  return { state: inviteState({ status: (data as any).status, gig }, now), role: (data as any).slot?.staff_role?.name ?? null, gig };
}

/** Just the state of one of my assignments (the bell's invite row). */
export async function fetchMyAssignmentState(assignmentId: string, now: Date = new Date()): Promise<InviteState> {
  return (await fetchMyAssignment(assignmentId, now)).state;
}

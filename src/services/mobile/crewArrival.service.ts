/**
 * The signed-in person's own arrival at a gig (#458): read it, record it, take it back. Offline, a
 * change is queued (and kept on the phone's copy of the day sheet as waiting to send) and sent when
 * the phone is back online.
 */
import { getSupabase } from '../base/dataAccess';
import { idbStore } from '../../utils/idb/store';
import { offlineSyncService } from './offlineSync.service';
import type { MyArrival } from '../../utils/crewArrival';

async function signedInId(): Promise<string> {
  // The local session, so it works offline.
  const { data } = await getSupabase().auth.getSession();
  const id = data?.session?.user?.id;
  if (!id) throw new Error('Sign in again to record your arrival');
  return id;
}

/** Keeps what the phone's copy of the sheet says in step (best effort). */
async function rememberOnPhone(gigId: string, arrival: MyArrival | null): Promise<void> {
  try {
    const cached = (await idbStore.getDayOfShow(gigId)) as { gig_id: string } | undefined;
    if (cached) await idbStore.putDayOfShow({ ...cached, my_arrival: arrival } as any);
  } catch {
    /* the phone's copy is a convenience */
  }
}

export async function fetchMyArrival(gigId: string): Promise<MyArrival | null> {
  const me = await signedInId();
  const { data, error } = await getSupabase()
    .from('gig_crew_arrivals')
    .select('arrived_at, set_by')
    .eq('gig_id', gigId)
    .eq('user_id', me)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { arrived_at: (data as any).arrived_at, by_manager: (data as any).set_by !== me };
}

/** Records the phone's time for the signed-in person. `queued` when offline. */
export async function recordMyArrival(gigId: string, now: Date = new Date()): Promise<{ outcome: 'saved' | 'queued'; arrived_at: string }> {
  const me = await signedInId();
  const arrivedAt = now.toISOString();
  if (!navigator.onLine) {
    await offlineSyncService.queueTrackingUpdate({ gigId, userId: me, arrivedAt }, 'CREW_ARRIVAL');
    await rememberOnPhone(gigId, { arrived_at: arrivedAt, by_manager: false, pending: true });
    return { outcome: 'queued', arrived_at: arrivedAt };
  }
  const { error } = await getSupabase()
    .from('gig_crew_arrivals')
    .upsert({ gig_id: gigId, user_id: me, arrived_at: arrivedAt }, { onConflict: 'gig_id,user_id' });
  if (error) throw error;
  await rememberOnPhone(gigId, { arrived_at: arrivedAt, by_manager: false });
  return { outcome: 'saved', arrived_at: arrivedAt };
}

/** Takes the signed-in person's arrival back. `locked` when a Manager or Admin set it. */
export async function undoMyArrival(gigId: string): Promise<'undone' | 'queued' | 'locked'> {
  const me = await signedInId();
  if (!navigator.onLine) {
    await offlineSyncService.queueTrackingUpdate({ gigId, userId: me, arrivedAt: null }, 'CREW_ARRIVAL');
    await rememberOnPhone(gigId, null);
    return 'queued';
  }
  const { data, error } = await getSupabase()
    .from('gig_crew_arrivals')
    .delete()
    .eq('gig_id', gigId)
    .eq('user_id', me)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) return 'locked';
  await rememberOnPhone(gigId, null);
  return 'undone';
}

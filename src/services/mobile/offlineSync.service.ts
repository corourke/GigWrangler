import { getSupabase } from '../base/dataAccess';
import { idbStore, OutboxItem } from '../../utils/idb/store';
import { toast } from 'sonner';

const supabase = getSupabase();

type SyncHandler = (payload: any) => Promise<void>;

const syncHandlers: Record<string, SyncHandler> = {};

const getLatestTrackingQuery = (payload: any) => {
  let query = supabase
    .from('inventory_tracking')
    .select('id, scanned_at, created_at, status, scanned_by, notes')
    .eq('gig_id', payload.gig_id)
    .eq('kit_id', payload.kit_id)
    .order('scanned_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (payload.asset_id) {
    query = query.eq('asset_id', payload.asset_id);
  } else {
    query = query.is('asset_id', null);
  }

  return query;
};

export function registerSyncHandler(type: string, handler: SyncHandler) {
  syncHandlers[type] = handler;
}

registerSyncHandler('INVENTORY_SCAN', async (payload: any) => {
  const { error } = await supabase
    .from('inventory_tracking')
    .insert({
      organization_id: payload.organization_id,
      gig_id: payload.gig_id,
      kit_id: payload.kit_id,
      asset_id: payload.asset_id ?? null,
      status: payload.status,
      scanned_at: payload.scanned_at,
      scanned_by: payload.scanned_by,
      client_id: payload.client_id ?? null,
      notes: payload.notes ?? null,
      location: payload.location ?? null,
      // How many of the unit or lot are there as of this scan (#185); 1 for a unit.
      quantity: Math.max(1, Math.floor(Number(payload.quantity ?? 1)) || 1),
    });

  // Already recorded: an earlier try got through but its reply was lost.
  if ((error as any)?.code === '23505' && payload.client_id) return;
  if (error) {
    throw error;
  }
});

registerSyncHandler('INVENTORY_CLEAR', async (payload: any) => {
  if (payload.record_id) {
    const { error } = await supabase
      .from('inventory_tracking')
      .delete()
      .eq('id', payload.record_id);

    if (error) {
      throw error;
    }
    return;
  }

  const { data: latest, error: latestError } = await getLatestTrackingQuery(payload).maybeSingle();

  if (latestError) {
    throw latestError;
  }

  if (!latest?.id) {
    return;
  }

  const { error } = await supabase
    .from('inventory_tracking')
    .delete()
    .eq('id', latest.id);

  if (error) {
    throw error;
  }
});

// Nothing queues this any more: a note is a new row (INVENTORY_SCAN, #246). Kept so a note queued
// by an earlier version of the app still syncs instead of sitting in the outbox.
registerSyncHandler('INVENTORY_NOTE_UPDATE', async (payload: any) => {
  const recordId = payload.record_id;

  if (recordId) {
    const { error } = await supabase
      .from('inventory_tracking')
      .update({ notes: payload.notes ?? null })
      .eq('id', recordId);

    if (error) {
      throw error;
    }
    return;
  }

  const { data: latest, error: latestError } = await getLatestTrackingQuery(payload).maybeSingle();

  if (latestError) {
    throw latestError;
  }

  if (!latest?.id) {
    return;
  }

  const { error } = await supabase
    .from('inventory_tracking')
    .update({ notes: payload.notes ?? null })
    .eq('id', latest.id);

  if (error) {
    throw error;
  }
});

registerSyncHandler('ASSET_STATUS_UPDATE', async (payload: any) => {
  const { error } = await supabase.rpc('update_asset_status', {
    p_asset_id: payload.asset_id,
    p_status: payload.status,
  });

  // Refused (not allowed, e.g. Staff bringing back written-off equipment; or not possible for the
  // record as it is now, e.g. already flagged for maintenance, #186): a retry won't change that,
  // so say why and drop it rather than retrying it silently forever.
  if ((error as any)?.code === '42501' || (error as any)?.code === '22023') {
    toast.error(`Status not changed: ${(error as any).message}`);
    return;
  }
  if (error) {
    throw error;
  }
});

// Maintenance from the phone (#186 step 3): send (with the gig: still out, it's only flagged until
// it comes home), return to service (or cancel a flag), and edit the details. Older phones still
// queue ASSET_STATUS_UPDATE, above, which the database routes too. A refusal won't change on a
// retry, so say why and drop it.
const maintenanceCall = (fn: string, args: (payload: any) => Record<string, unknown>, what: string) =>
  async (payload: any) => {
    const { error } = await supabase.rpc(fn as any, args(payload) as any);
    if ((error as any)?.code === '42501' || (error as any)?.code === '22023') {
      toast.error(`${what}: ${(error as any).message}`);
      return;
    }
    if (error) throw error;
  };

registerSyncHandler('MAINTENANCE_SEND', maintenanceCall('send_to_maintenance', (p) => ({
  p_asset_id: p.asset_id,
  p_quantity: p.quantity,
  p_notes: p.notes ?? null,
  p_location: p.location ?? null,
  p_expected_back: p.expected_back ?? null,
  p_gig_id: p.gig_id ?? null,
}), 'Not sent to maintenance'));

registerSyncHandler('MAINTENANCE_RETURN', maintenanceCall('return_to_service', (p) => ({
  p_asset_id: p.asset_id,
}), 'Not returned to service'));

registerSyncHandler('MAINTENANCE_UPDATE', maintenanceCall('update_maintenance', (p) => ({
  p_asset_id: p.asset_id,
  p_notes: p.notes ?? null,
  p_location: p.location ?? null,
  p_expected_back: p.expected_back ?? null,
}), 'Maintenance details not saved'));

// A kit added at pack-out (#185): a flagged assignment. Already there (a retry) counts as done;
// refused (not allowed, or the kit is gone) won't change on a retry, so say why and drop it.
registerSyncHandler('KIT_ASSIGNMENT_ADD', async (payload: any) => {
  const { error } = await (supabase.from('gig_kit_assignments') as any).insert(payload);
  if ((error as any)?.code === '23505') return;
  if ((error as any)?.code === '42501') {
    toast.error(`Kit not added to the gig: ${(error as any).message}`);
    return;
  }
  if (error) throw error;
});

// Removing a kit added at pack-out: only the adder's own flagged assignment.
// A kit added at pack-out, removed (#185 PR 2): the assignment, then every row the kit wrote at
// the gig (rows queued before this sync first, so they go too). A removal that's refused, or
// deletes nothing, keeps the rows: the next fetch shows the kit again.
registerSyncHandler('KIT_ASSIGNMENT_REMOVE', async (payload: any) => {
  const { data: removed, error } = await (supabase.from('gig_kit_assignments') as any)
    .delete()
    .eq('organization_id', payload.organization_id)
    .eq('gig_id', payload.gig_id)
    .eq('kit_id', payload.kit_id)
    .eq('added_at_pack_out', true)
    .eq('assigned_by', payload.assigned_by)
    .select('id');
  if ((error as any)?.code === '42501' || (!error && (removed ?? []).length === 0)) {
    toast.error(`Kit not removed from the gig${error ? `: ${(error as any).message}` : '.'}`);
    return;
  }
  if (error) throw error;
  const { error: rowsError } = await supabase.from('inventory_tracking').delete()
    .eq('organization_id', payload.organization_id)
    .eq('gig_id', payload.gig_id)
    .eq('kit_id', payload.kit_id);
  if (rowsError) throw rowsError;
});

registerSyncHandler('STAFF_ASSIGNMENT_UPDATE', async (payload: any) => {
  const updateData: Record<string, any> = { status: payload.status };
  if (payload.status === 'Confirmed') {
    updateData.confirmed_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from('gig_staff_assignments')
    .update(updateData)
    .eq('id', payload.assignmentId);

  if (error) {
    throw error;
  }
});

// Receipts kept on the phone (mobile receipt capture, 11-10). Registered here so they sync from
// app start; the upload code loads only when one is sent.
registerSyncHandler('RECEIPT_UPLOAD', async (payload: any) => {
  const { sendQueuedReceipt } = await import('./receiptOutbox.service');
  await sendQueuedReceipt(payload);
});

/** The sync in progress, if any: a second call joins it rather than sending the same changes again. */
let running: Promise<void> | null = null;

/** After this many failed tries a change stops retrying and counts as one that couldn't sync. */
export const MAX_SYNC_ATTEMPTS = 5;

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
}

/** Who queued a change: stamped on it, or for an older one, its payload's scanner or adder. */
const actorOf = (item: OutboxItem): string | null =>
  item.actor_id ?? item.payload?.scanned_by ?? item.payload?.assigned_by ?? null;

export const offlineSyncService = {
  /**
   * Sends the signed-in person's queued changes. A change someone else queued on this device (or
   * one whose owner can't be told) is dropped without being sent. A change that fails
   * MAX_SYNC_ATTEMPTS times is marked failed and left alone, and the person is told how many
   * couldn't sync.
   */
  processOutbox(): Promise<void> {
    if (!running) {
      running = this.sendOutbox().finally(() => { running = null; });
    }
    return running;
  },

  async sendOutbox() {
    const outbox = await idbStore.getOutbox();
    if (outbox.length === 0) return;
    const me = await currentUserId();
    if (!me) return;

    let newlyFailed = 0;
    let failed = 0;
    for (const item of outbox) {
      if (actorOf(item) !== me) {
        await idbStore.removeFromOutbox(item.id!);
        continue;
      }
      if (item.failed) {
        failed += 1;
        continue;
      }
      try {
        await this.syncItem(item);
        await idbStore.removeFromOutbox(item.id!);
      } catch (error) {
        console.error('Sync failed for item:', item, error);
        item.attempts = (item.attempts || 0) + 1;
        if (item.attempts >= MAX_SYNC_ATTEMPTS) {
          item.failed = true;
          newlyFailed += 1;
          failed += 1;
        }
        await idbStore.updateOutboxItem(item);
      }
    }
    if (newlyFailed > 0) {
      toast.error(`${failed} change${failed === 1 ? '' : 's'} couldn't sync`);
    }
  },

  async syncItem(item: OutboxItem) {
    const handler = syncHandlers[item.type];
    if (!handler) {
      console.warn('Unknown outbox item type:', item.type);
      return;
    }
    await handler(item.payload);
  },

  /** Queues a change for the signed-in person; a scan gets its own id, so a retry can't record it twice. */
  async queueTrackingUpdate(payload: any, type: OutboxItem['type']) {
    const me = await currentUserId();
    if (!me) throw new Error('Sign in again to save this change');
    const stamped = type === 'INVENTORY_SCAN' && !payload?.client_id
      ? { ...payload, client_id: crypto.randomUUID() }
      : payload;
    return idbStore.addToOutbox({ type, payload: stamped, actor_id: me });
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    offlineSyncService.processOutbox();
  });
}

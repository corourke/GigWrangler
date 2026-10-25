import { OrganizationRole } from '../utils/supabase/types';
import { handleApiError } from '../utils/api-error-utils';
import { UUID_REGEX } from '../utils/validation-utils';
import { getCurrentUser, getSupabase } from './base/dataAccess';
import { resolveGigActivityCtx, type GigActivityCtx, type GigActivityCtxInput } from './gigService.shared';
import { writeActivity } from './writeActivity';

/**
 * Gig participant / venue / act operations (Phase 7, Step 4 — extracted from
 * gig.service.ts). gig.service re-exports these for backwards compatibility.
 */

/** A participation's values as a caller loaded or last saved them (#175). */
export interface LoadedParticipantRow {
  id: string;
  role: OrganizationRole;
  notes?: string | null;
  is_client?: boolean;
}

/**
 * Update gig participants.
 *
 * `loadedIds` are the ids of the rows the caller loaded (or last saved). Only
 * those that are no longer in `participants` are deleted: a row someone else
 * added since is left alone, and with no `loadedIds` nothing is deleted
 * (issue #92).
 *
 * `loadedRows` are those rows' values as the caller loaded (or last saved) them.
 * Only a row that differs from them is written: the user may not be allowed
 * to change the others (an Inactive organization keeps only its own notes),
 * and another editor's later change to them isn't written over (#175). A row
 * not in `loadedRows` is compared with the database instead.
 *
 * Returns `ids`, parallel to `participants`: each row's database id, including
 * the id of any row inserted by this call (undefined for a row that was
 * skipped). Callers that keep editing the same rows (autosave) must write
 * these back, or their next save sends no id and the row is deleted and
 * inserted again (issue #69).
 */
export async function updateGigParticipants(
  gigId: string,
  participants: Array<{
    id?: string;
    organization_id: string;
    role: OrganizationRole;
    notes?: string | null;
    is_client?: boolean;
  }>,
  activityCtx?: GigActivityCtxInput,
  loadedIds: string[] = [],
  loadedRows: LoadedParticipantRow[] = []
) {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    const { data: existingParticipants, error: fetchError } = await supabase
      .from('gig_participants')
      .select('id, organization_id, role, notes, is_client')
      .eq('gig_id', gigId);

    if (fetchError) throw fetchError;

    // Callers that own the gig-level save (gig.service#updateGig) pass the
    // whole context; others pass just the org they act as, or nothing, and the
    // rest is derived here rather than silently skipping the activity log
    // (issue #55 — adds via this path weren't logged at all).
    // A failed lookup is reported and skips the log; it doesn't fail the save
    // (issue #103 — it used to log against no organization).
    let effectiveCtx: GigActivityCtx | null = null;
    try {
      effectiveCtx = await resolveGigActivityCtx(
        supabase, user, gigId, activityCtx,
        (existingParticipants ?? []).map(p => p.organization_id),
      );
    } catch (e) { console.error('Activity log context lookup failed:', e); }

    const existingIds = (existingParticipants ?? []).map(p => p.id);
    const existingOrg = new Map((existingParticipants ?? []).map(p => [p.id, p.organization_id]));
    const existingById = new Map((existingParticipants ?? []).map(p => [p.id, p as any]));
    const loadedById = new Map(loadedRows.map(r => [r.id, r]));
    const incomingIds = participants
      .filter(p => p.id && UUID_REGEX.test(p.id))
      .map(p => p.id!);

    // A participation's organization never changes in place (#175): a row moved to another
    // organization is removed and a new one added.
    const moved = new Set(participants
      .filter(p => p.id && existingOrg.has(p.id) && existingOrg.get(p.id) !== p.organization_id)
      .map(p => p.id!));
    const idsToDelete = existingIds.filter(id => (loadedIds.includes(id) && !incomingIds.includes(id)) || moved.has(id));

    // .select() so a removal the database refuses (no rows, no error) isn't taken as done.
    if (idsToDelete.length > 0) {
      const { data: deleted, error: deleteError } = await supabase.from('gig_participants').delete().in('id', idsToDelete).select('id');
      if (deleteError) throw deleteError;
      if ((deleted ?? []).length !== idsToDelete.length) {
        throw new Error('An organization could not be removed from this gig: you do not have permission to remove it.');
      }
    }

    // Removals are logged by the database, in the same step as the delete (#175).

    const ids: Array<string | undefined> = [];
    for (const participant of participants) {
      const isDbId = participant.id && UUID_REGEX.test(participant.id);
      const changes = {
        role: participant.role,
        notes: participant.notes || null,
        is_client: participant.is_client ?? false,
      };

      if (isDbId && existingIds.includes(participant.id!) && !moved.has(participant.id!)) {
        // Only rows the user changed are written (see above).
        const before = loadedById.get(participant.id!) ?? existingById.get(participant.id!);
        if (before && before.role === changes.role && (before.notes || null) === changes.notes
            && (before.is_client ?? false) === changes.is_client) {
          ids.push(participant.id);
          continue;
        }
        const { data: updated, error: updateError } = await supabase.from('gig_participants').update(changes).eq('id', participant.id!).select('id');
        if (updateError) throw updateError;
        if (!updated || updated.length === 0) {
          throw new Error('A participant could not be changed: you do not have permission to change it.');
        }
        ids.push(participant.id);
      } else if (participant.organization_id && participant.role) {
        const { data: inserted, error: insertError } = await (supabase.from('gig_participants') as any)
          .insert({ gig_id: gigId, organization_id: participant.organization_id, ...changes })
          .select('id')
          .single();
        if (insertError) throw insertError;
        ids.push(inserted?.id);
        if (inserted?.id && effectiveCtx) {
          const { data: orgRow } = await (supabase.from('organizations') as any).select('name').eq('id', participant.organization_id).single();
          try {
            await writeActivity({
              organization_id: effectiveCtx.organization_id,
              event_type: 'participant.added',
              entity_type: 'participant',
              entity_id: inserted.id,
              gig_id: gigId,
              actor_display_name: effectiveCtx.actor_display_name,
              actor_org_name: effectiveCtx.actor_org_name,
              context: { gig_title: effectiveCtx.gig_title, organization_name: (orgRow as any)?.name ?? '', role: participant.role },
            });
          } catch (e) { console.error('Activity log failed:', e); }
        }
      } else {
        ids.push(undefined);
      }
    }

    return { success: true, ids };
  } catch (err) {
    return handleApiError(err, 'update gig participants');
  }
}

/**
 * Remove an organization from a gig: all of its roles there (#175). The
 * database refuses it for the owner, and while the organization has staff,
 * equipment or financial records on the gig; its message, passed on, says
 * what to do instead (release staff and equipment, mark it Inactive). The
 * database logs one entry for the removal, marked as leaving when the user
 * acts for the organization itself.
 */
export async function removeGigParticipant(gigId: string, organizationId: string) {
  try {
    await getCurrentUser();
    const supabase = getSupabase();

    const { data: rows, error: fetchError } = await supabase
      .from('gig_participants')
      .select('id, organization_id, role')
      .eq('gig_id', gigId)
      .eq('organization_id', organizationId);
    if (fetchError) throw fetchError;
    if (!rows || rows.length === 0) throw new Error('This organization is not on this gig.');

    // .select() so a removal the database refuses (no rows, no error) isn't taken as done.
    const { data: deleted, error: deleteError } = await supabase
      .from('gig_participants')
      .delete()
      .eq('gig_id', gigId)
      .eq('organization_id', organizationId)
      .select('id');
    if (deleteError) throw deleteError;
    if ((deleted ?? []).length !== rows.length) {
      throw new Error('This organization could not be removed from the gig: you do not have permission to remove it.');
    }

    // Logged by the database, in the same step as the delete.
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'remove organization from gig');
  }
}

/**
 * Mark an organization Inactive on a gig, or reactivate it (#175). It's a flag
 * on each of its roles there. The owner, or the organization itself, may do it.
 */
export async function setGigParticipantInactive(gigId: string, organizationId: string, inactive: boolean) {
  try {
    await getCurrentUser();
    const supabase = getSupabase();

    const { data: updated, error } = await supabase
      .from('gig_participants')
      .update({ inactive })
      .eq('gig_id', gigId)
      .eq('organization_id', organizationId)
      .select('id');
    if (error) throw error;
    if (!updated || updated.length === 0) {
      throw new Error(`This organization could not be ${inactive ? 'marked Inactive' : 'reactivated'}: you do not have permission to change it.`);
    }
    return { success: true };
  } catch (err) {
    return handleApiError(err, inactive ? 'mark organization Inactive' : 'reactivate organization');
  }
}

/**
 * The gig's participants with their organizations.
 */
export async function getGigParticipants(gigId: string) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('gig_participants')
      .select('id, role, organization:organization_id(id, name)')
      .eq('gig_id', gigId);

    if (error) throw error;
    return data || [];
  } catch (err) {
    return handleApiError(err, 'fetch gig participants') as never;
  }
}

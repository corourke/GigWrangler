import { handleApiError } from '../utils/api-error-utils';
import { UUID_REGEX } from '../utils/validation-utils';
import { getCurrentUser, getSupabase, deleteOne, updateRecord, listRecords } from './base/dataAccess';
import type { DbGigKitAssignment } from '../utils/supabase/types';

/**
 * Kit-assignment operations for gigs (Phase 7, Step 4 — extracted from
 * gig.service.ts). gig.service re-exports these for backwards compatibility.
 */

/**
 * Assign a kit to a gig
 */
export async function assignKitToGig(gigId: string, kitId: string, organizationId: string, notes?: string) {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('gig_kit_assignments')
      .insert({
        gig_id: gigId,
        kit_id: kitId,
        organization_id: organizationId,
        notes: notes || null,
        assigned_by: user.id,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    return handleApiError(err, 'assign kit to gig');
  }
}

/**
 * Remove a kit from a gig
 */
export async function removeKitFromGig(assignmentId: string) {
  // deleteOne confirms a row was removed — RLS denies silently (0 rows, no error)
  await deleteOne('gig_kit_assignments', assignmentId, {
    context: 'remove kit from gig',
    notFound: 'Kit assignment not found, or you do not have permission to remove it.',
  });
  return { success: true };
}

/**
 * Update a kit assignment for a gig
 */
export async function updateGigKitAssignment(assignmentId: string, updates: { notes?: string }) {
  return updateRecord<DbGigKitAssignment>('gig_kit_assignments', assignmentId, updates, { context: 'update kit assignment' });
}

/**
 * Update all kit assignments for a gig.
 *
 * `loadedIds` are the ids of the assignments the caller loaded (or last
 * saved). Only those no longer in `assignments` are deleted: a row someone
 * else added since is left alone, and with no `loadedIds` nothing is deleted
 * (issue #92).
 *
 * Returns `ids`, parallel to `assignments`: each row's database id, including
 * the ids of rows this call inserted.
 */
export async function updateGigKitAssignments(gigId: string, organizationId: string, assignments: Array<{
  id?: string;
  kit_id: string;
  notes?: string | null;
}>, loadedIds: string[] = []) {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    const { data: existingAssignments, error: fetchError } = await supabase
      .from('gig_kit_assignments')
      .select('id, kit_id')
      .eq('gig_id', gigId)
      .eq('organization_id', organizationId);

    if (fetchError) throw fetchError;

    const existingIds = existingAssignments?.map(a => a.id) || [];
    const incomingIds = assignments.filter(a => a.id && UUID_REGEX.test(a.id)).map(a => a.id!);

    const assignmentIdsToDelete = existingIds.filter(id => loadedIds.includes(id) && !incomingIds.includes(id));
    if (assignmentIdsToDelete.length > 0) {
      await supabase.from('gig_kit_assignments').delete().in('id', assignmentIdsToDelete);
    }

    const ids: Array<string | undefined> = [];
    for (const assignment of assignments) {
      const isDbId = assignment.id && UUID_REGEX.test(assignment.id);
      const assignmentData = {
        gig_id: gigId,
        kit_id: assignment.kit_id,
        organization_id: organizationId,
        notes: assignment.notes || null,
      };

      if (isDbId) {
        await supabase.from('gig_kit_assignments').update(assignmentData).eq('id', assignment.id!);
        ids.push(assignment.id);
      } else {
        const { data: inserted } = await supabase.from('gig_kit_assignments')
          .insert({ ...assignmentData, assigned_by: user.id }).select('id').single();
        ids.push(inserted?.id);
      }
    }

    return { success: true, ids };
  } catch (err) {
    return handleApiError(err, 'update gig kit assignments');
  }
}

/**
 * Fetch kits assigned to a gig
 */
export async function getGigKits(gigId: string, organizationId?: string) {
  return listRecords<any>('gig_kit_assignments', {
    select: `
        *,
        kit:kits(
          id,
          name,
          category,
          tag_number,
          rental_value,
          organization_id,
          kit_components!kit_assets_kit_id_fkey(
            quantity,
            notes,
            asset:assets(*)
          )
        )
      `,
    filters: [
      { column: 'gig_id', operator: 'eq', value: gigId },
      ...(organizationId ? [{ column: 'organization_id', operator: 'eq' as const, value: organizationId }] : []),
    ],
    order: { column: 'assigned_at', ascending: false },
    context: 'fetch gig kits',
  });
}


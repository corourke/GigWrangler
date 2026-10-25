import { getSupabase, getCurrentUser } from './base/dataAccess';
import { verifyGigAccess } from './gigService.shared';
import {
  GigStatus,
  GigAccountingSummary,
  PaymentHealth,
  OrganizationRole,
} from '../utils/supabase/types';
import { handleApiError } from '../utils/api-error-utils';
import { deleteCalendarEvent } from './googleCalendar.service';
// createGig calls createGigFinancial internally (financial record on import).
import { createGigFinancial } from './gigFinancial.service';
// updateGig calls updateGigParticipants internally.
import { updateGigParticipants } from './gigParticipant.service';
// updateGig calls updateGigStaffSlots internally.
import { updateGigStaffSlots } from './gigStaff.service';
import { writeActivity, actorNameOf } from './writeActivity';
import { toDateInTimeZone } from '../utils/dateUtils';
import { summarizeMoney, moneyInBadge, type MoneyRow } from '../utils/moneyFlow';
import { projectedStaffCost } from '../utils/rateEstimate';

// Kit-assignment operations live in gigKit.service.ts (Step 4 split); re-export
// them here so existing `services/gig.service` imports keep working.
export {
  assignKitToGig,
  removeKitFromGig,
  updateGigKitAssignment,
  updateGigKitAssignments,
  getGigKits,
} from './gigKit.service';

// Financial / bid operations live in gigFinancial.service.ts (Step 4 split).
export type { GigExportAggregates } from './gigFinancial.service';
export {
  getGigFinancials,
  getGigFinancialsByPurchaseId,
  getPurchaseIdsWithLedgerEntry,
  getGigProfitabilitySummary,
  getGigExportAggregates,
  createGigFinancial,
  updateGigFinancial,
  recordGigFinancialPayment,
  deleteGigFinancial,
} from './gigFinancial.service';
export type { GigFinancialInput, GigFinancialPatch, GigMoneySummary } from './gigFinancial.service';

// Participant / venue / act operations live in gigParticipant.service.ts.
export {
  getGigParticipants,
  updateGigParticipants,
} from './gigParticipant.service';

// Staff-slot / assignment operations live in gigStaff.service.ts.
export {
  updateGigStaffSlots,
  completeStaffAssignment,
  unfinalizeStaffAssignment,
  completeAllStaffAssignments,
  updateStaffAssignmentStatus,
} from './gigStaff.service';

// Schedule-entry operations live in gigSchedule.service.ts.
import { updateGigScheduleEntries, duplicateGigScheduleEntries } from './gigSchedule.service';
export {
  getGigScheduleEntries,
  updateGigScheduleEntries,
  duplicateGigScheduleEntries,
} from './gigSchedule.service';

const SYNC_DEBOUNCE_MS = 30_000;
const pendingSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

function debouncedSyncGigToAllCalendars(gigId: string): void {
  const existing = pendingSyncTimers.get(gigId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingSyncTimers.delete(gigId);
    syncGigToAllCalendars(gigId).catch(err =>
      console.error('Debounced sync failed for gig:', gigId, err)
    );
  }, SYNC_DEBOUNCE_MS);
  pendingSyncTimers.set(gigId, timer);
}

async function syncGigToAllCalendars(gigId: string): Promise<void> {
  try {
    const supabase = getSupabase();
    
    // Call the edge function to handle multi-user sync server-side (bypassing RLS)
    const { data, error } = await supabase.functions.invoke(
      'server/integrations/google-calendar/sync-gig-all-users',
      {
        method: 'POST',
        body: { 
          gig_id: gigId,
          origin: window.location.origin
        },
      }
    );

    if (error) {
      console.error('Error triggering server-side gig sync:', error);
    } else {
      console.log('Server-side gig sync triggered successfully:', data);
    }
  } catch (error) {
    console.error('Error in syncGigToAllCalendars:', error);
  }
}

/**
 * The Google Calendar events synced for a gig. Read before the gig is
 * deleted: its sync rows are deleted with it (#175).
 */
async function getGigCalendarEvents(gigId: string): Promise<Array<{ user_id: string; google_event_id: string }>> {
  try {
    const { data, error } = await getSupabase()
      .from('gig_sync_status')
      .select('user_id, google_event_id')
      .eq('gig_id', gigId)
      .not('google_event_id', 'is', null);
    if (error) throw error;
    return (data ?? []) as Array<{ user_id: string; google_event_id: string }>;
  } catch (error) {
    console.error('Error fetching sync statuses for deletion:', error);
    return [];
  }
}

/**
 * Remove a deleted gig's events from each user's Google Calendar. A failure
 * is logged and doesn't fail the delete, which already happened.
 */
async function removeGigCalendarEvents(gigId: string, events: Array<{ user_id: string; google_event_id: string }>): Promise<void> {
  await Promise.allSettled(events.map(async (event) => {
    try {
      await deleteCalendarEvent(event.user_id, event.google_event_id);
    } catch (deleteError) {
      console.error(`Failed to delete gig ${gigId} from user ${event.user_id}'s calendar:`, deleteError);
    }
  }));
}

/**
 * Fetch gigs for a specific organization
 */
export async function getGigsForOrganization(organizationId: string) {
  const supabase = getSupabase();
  try {
    // 1. Get IDs of gigs this organization is participating in
    const { data: participatingGigs, error: participantError } = await supabase
      .from('gig_participants')
      .select('gig_id')
      .eq('organization_id', organizationId);

    if (participantError) throw participantError;
    if (!participatingGigs?.length) return [];

    const gigIds = participatingGigs.map(pg => pg.gig_id);

    // 2. Fetch those gigs with their participants in one query
    const { data: gigs, error } = await supabase
      .from('gigs')
      .select(`
        *,
        participants:gig_participants(
          *,
          organization:organization_id(*)
        )
      `)
      .in('id', gigIds)
      .order('start', { ascending: false });

    if (error) throw error;

    // 3. Map venue and act organizations for UI convenience
    const gigsWithParticipants = (gigs || []).map((gig: any) => {
      const venue = gig.participants?.find((p: any) => p.role === 'Venue')?.organization;
      const act = gig.participants?.find((p: any) => p.role === 'Act')?.organization;

      return {
        ...gig,
        venue,
        act,
      };
    });

    return gigsWithParticipants;
  } catch (err) {
    return handleApiError(err, 'fetch gigs for organization');
  }
}

export interface GigOption {
  id: string;
  title: string;
  start: string;
  venue?: { name?: string } | null;
  act?: { name?: string } | null;
}

/** Default half-width of the date window used to scope gig pickers, in days. */
export const GIG_PICKER_WINDOW_DAYS = 21;

/**
 * Lightweight gig list for pickers (comboboxes, summary name maps).
 *
 * Two things make this cheaper than `getGigsForOrganization`:
 *  - it selects only the columns a picker renders (`id`, `title`, `start`) plus
 *    the venue/act name, not `gigs.*` and full participant/organization rows;
 *  - when `aroundDate` is given it only returns gigs whose `start` falls within
 *    ±`windowDays` of that date, so linking an expense doesn't pull the org's
 *    entire gig history (the source of the ~45s dropdown stall).
 *
 * `ensureGigId`, when supplied, is always included even if it's outside the
 * window, so an already-linked gig still renders its label.
 */
export async function getGigOptionsForOrganization(
  organizationId: string,
  opts: { aroundDate?: string | null; windowDays?: number; ensureGigId?: string | null } = {}
): Promise<GigOption[]> {
  const supabase = getSupabase();
  try {
    const { data: participatingGigs, error: participantError } = await supabase
      .from('gig_participants')
      .select('gig_id')
      .eq('organization_id', organizationId);

    if (participantError) throw participantError;
    if (!participatingGigs?.length) return [];

    const gigIds = participatingGigs.map((pg: any) => pg.gig_id);

    let query = supabase
      .from('gigs')
      .select('id, title, start, participants:gig_participants(role, organization:organization_id(name))')
      .in('id', gigIds);

    const { aroundDate, windowDays = GIG_PICKER_WINDOW_DAYS, ensureGigId } = opts;
    const center = aroundDate ? new Date(aroundDate) : null;
    if (center && !Number.isNaN(center.getTime())) {
      const lo = new Date(center);
      lo.setUTCDate(lo.getUTCDate() - windowDays);
      lo.setUTCHours(0, 0, 0, 0);
      const hi = new Date(center);
      hi.setUTCDate(hi.getUTCDate() + windowDays);
      hi.setUTCHours(23, 59, 59, 999);
      const inWindow = `and(start.gte.${lo.toISOString()},start.lte.${hi.toISOString()})`;
      query = query.or(ensureGigId ? `${inWindow},id.eq.${ensureGigId}` : inWindow);
    }

    const { data: gigs, error } = await query.order('start', { ascending: false });
    if (error) throw error;

    return (gigs || []).map((gig: any) => ({
      id: gig.id,
      title: gig.title,
      start: gig.start,
      venue: gig.participants?.find((p: any) => p.role === 'Venue')?.organization ?? null,
      act: gig.participants?.find((p: any) => p.role === 'Act')?.organization ?? null,
    }));
  } catch (err) {
    return handleApiError(err, 'fetch gig options for organization');
  }
}

/**
 * Fetch a single gig with all its details (participants, staff slots, assignments, kits, bids)
 */
export async function getGig(gigId: string) {
  const supabase = getSupabase();
  try {
    const { data: gig, error } = await supabase
      .from('gigs')
      .select(`
        *,
        participants:gig_participants(
          *,
          organization:organization_id(*)
        ),
        schedule_entries:gig_schedule_entries(
          *,
          act_participant:act_participant_id(
            id,
            role,
            organization:organization_id(id, name)
          )
        ),
        staff_slots:gig_staff_slots(
          *,
          role_info:staff_roles(name),
          assignments:gig_staff_assignments(
            *,
            user:user_id(id, email, first_name, last_name, phone)
          )
        ),
        kit_assignments:gig_kit_assignments(*),
        financials:gig_financials(*)
      `)
      .eq('id', gigId)
      .single();

    if (error) throw error;
    if (!gig) throw new Error('Gig not found');

    // Post-process to maintain existing interface
    const processedSlots = (gig.staff_slots || []).map((slot: any) => ({
      ...slot,
      role: slot.role_info?.name || '',
      count: slot.required_count,
      staff_assignments: (slot.assignments || []).map((assignment: any) => ({
        ...assignment,
        user: assignment.user
      }))
    }));

    const sortedScheduleEntries = ((gig as any).schedule_entries || []).sort(
      (a: any, b: any) => a.sort_order - b.sort_order || new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    return {
      ...gig,
      tags: gig.tags ?? [],
      staff_slots: processedSlots,
      schedule_entries: sortedScheduleEntries,
    };
  } catch (err) {
    return handleApiError(err, 'fetch gig details');
  }
}

/**
 * Create a new gig
 */
export async function createGig(gigData: any, options?: { skipActivityLog?: boolean }) {
  const supabase = getSupabase();
  try {
    const { 
      primary_organization_id,
      parent_gig_id,
      hierarchy_depth = 0,
      participants = [],
      staff_slots = [],
      amount,
      ...restGigData
    } = gigData;

    // Call the complex creation RPC for atomic operation
    const { data, error } = await supabase.rpc('create_gig_complex', {
      p_gig_data: {
        ...restGigData,
        primary_organization_id,
        parent_gig_id,
        hierarchy_depth
      },
      p_participants: participants,
      p_staff_slots: staff_slots
    });

    if (error) throw error;
    if (!data?.[0]?.id) throw new Error('Gig creation failed to return an ID');

    const newGigId = data[0].id;

    // If amount is provided, create a financial record
    if (amount !== undefined && amount !== null && parseFloat(amount) > 0) {
      try {
        // Use gig start date for the financial record, or current date if no start date,
        // as a calendar date in the gig's time zone (#93)
        const finDate = toDateInTimeZone(restGigData.start || new Date(), restGigData.timezone);
          
        await createGigFinancial({
          gig_id: newGigId,
          organization_id: primary_organization_id,
          direction: 'in',
          stage: 'paid',
          amount: parseFloat(amount),
          amount_settled: parseFloat(amount),
          date: finDate,
          paid_at: finDate,
          description: 'Payment from import'
        });
      } catch (finError) {
        // If financial creation fails, delete the gig to maintain consistency. Only an Admin of
        // the owner can delete a gig (#175); when the rollback can't run, say plainly that the
        // gig was created without its payment.
        console.error('Financial creation failed, rolling back gig creation:', finError);
        try {
          await deleteGig(newGigId);
        } catch (deleteError) {
          console.error('Failed to rollback gig creation:', deleteError);
          const reason = (finError as any)?.message || 'unknown error';
          throw new Error(`The gig was created, but its payment couldn't be saved (${reason}). Add the payment on the gig's Financials.`);
        }
        // Re-throw the original financial error
        throw finError;
      }
    }

    // Fetch the full gig details for the response
    const createdGig = await getGig(newGigId);

    if (!options?.skipActivityLog) {
      try {
        const user = await getCurrentUser();
        const actorDisplayName = actorNameOf(user);
        
        const { data: orgRow } = await supabase.from('organizations').select('name').eq('id', primary_organization_id).single();
        const actorOrgName = (orgRow as any)?.name ?? '';

        await writeActivity({
          organization_id: primary_organization_id,
          event_type: 'gig.created',
          entity_type: 'gig',
          entity_id: newGigId,
          gig_id: newGigId,
          actor_display_name: actorDisplayName,
          actor_org_name: actorOrgName,
          context: { gig_title: restGigData.title },
        });
      } catch (e) {
        console.error('Activity log failed:', e);
      }
    }

    debouncedSyncGigToAllCalendars(newGigId);

    return createdGig;
  } catch (err) {
    return handleApiError(err, 'create gig');
  }
}

/**
 * Compares two ISO-ish datetime strings by the instant they represent rather
 * than by raw string equality, since the same instant can round-trip through
 * different string forms (e.g. Postgres' `+00:00` vs. JS `Date#toISOString`'s
 * `Z`), which otherwise makes an unchanged value look like a real edit.
 */
function datesRepresentSameInstant(a?: string | null, b?: string | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();
  return !Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime === bTime;
}

/**
 * Update gig details
 */
export async function updateGig(gigId: string, gigData: {
  title?: string;
  start?: string;
  end?: string;
  timezone?: string;
  status?: GigStatus;
  tags?: string[];
  notes?: string | null;
  participants?: Array<{
    id?: string;
    organization_id: string;
    role: OrganizationRole;
    notes?: string | null;
    is_client?: boolean;
  }>;
  staff_slots?: Array<{
    id?: string;
    role: string;
    count?: number;
    notes?: string | null;
    assignments?: Array<{
      id?: string;
      user_id: string;
      status?: string;
      rate?: number | null;
      rate_unit?: string;
      fee?: number | null;
      notes?: string | null;
    }>;
  }>;
  schedule_entries?: Array<{
    id?: string;
    activity_type: string;
    label?: string | null;
    start_time: string;
    end_time?: string | null;
    act_participant_id?: string | null;
    notes?: string | null;
  }>;
}) {
  try {
    const { user, primaryOrgId: primary_organization_id } = await verifyGigAccess(gigId, 'update gigs');
    const supabase = getSupabase();

    const { data: orgRow } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', primary_organization_id)
      .single();
    const actorOrgName: string = (orgRow as any)?.name ?? '';
    const actorDisplayName = actorNameOf(user);

    const { participants, staff_slots, schedule_entries, ...restGigData } = gigData;

    const { data: preGig, error: preFetchError } = await supabase
      .from('gigs')
      .select('status, start, end, title, notes')
      .eq('id', gigId)
      .single();
    if (preFetchError) throw preFetchError;

    const { data: updatedRows, error: updateError } = await supabase
      .from('gigs')
      .update({
        ...restGigData,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gigId)
      .select('id');

    if (updateError) throw updateError;
    if (!updatedRows || updatedRows.length === 0) {
      throw new Error('Failed to save gig — you may not have permission to edit this gig.');
    }

    const gigEntry = {
      organization_id: primary_organization_id, entity_type: 'gig', entity_id: gigId, gig_id: gigId,
      actor_display_name: actorDisplayName, actor_org_name: actorOrgName,
    };
    const gig_title = (preGig as any)?.title ?? '';

    if (gigData.status && gigData.status !== (preGig as any)?.status) {
      await writeActivity({ ...gigEntry, event_type: 'gig.status_changed', context: { gig_title, from_status: (preGig as any).status, to_status: gigData.status } });
    }

    const startChanged = gigData.start !== undefined && !datesRepresentSameInstant(gigData.start, (preGig as any)?.start);
    const endChanged = gigData.end !== undefined && !datesRepresentSameInstant(gigData.end, (preGig as any)?.end);
    if (startChanged || endChanged) {
      await writeActivity({ ...gigEntry, event_type: 'gig.rescheduled', context: { gig_title, from: { start: (preGig as any).start, end: (preGig as any).end }, to: { start: gigData.start ?? (preGig as any).start, end: gigData.end ?? (preGig as any).end } } });
    }

    if (gigData.title !== undefined && gigData.title !== (preGig as any)?.title) {
      await writeActivity({ ...gigEntry, event_type: 'gig.renamed', context: { gig_title, from_title: (preGig as any).title, to_title: gigData.title } });
    }

    if (gigData.notes !== undefined && gigData.notes !== (preGig as any)?.notes) {
      await writeActivity({ ...gigEntry, event_type: 'gig.notes_updated', context: { gig_title, notes_changed: true } });
    }

    // These pass no loaded ids, so they add and update rows but delete none (#92).
    if (participants !== undefined && Array.isArray(participants)) {
      await updateGigParticipants(gigId, participants, { organization_id: primary_organization_id, actor_display_name: actorDisplayName, actor_org_name: actorOrgName, gig_title: (preGig as any)?.title ?? '' });
    }

    if (staff_slots !== undefined && Array.isArray(staff_slots)) {
      await updateGigStaffSlots(gigId, staff_slots.map(s => ({...s, organization_id: primary_organization_id})), { organization_id: primary_organization_id, actor_display_name: actorDisplayName, actor_org_name: actorOrgName, gig_title: (preGig as any)?.title ?? '' });
    }

    if (schedule_entries !== undefined && Array.isArray(schedule_entries)) {
      await updateGigScheduleEntries(gigId, schedule_entries as any);
    }

    const updatedGig = await getGig(gigId);

    if (updatedGig.start && updatedGig.end && new Date(updatedGig.end) > new Date(updatedGig.start)) {
      debouncedSyncGigToAllCalendars(gigId);
    }

    return updatedGig;
  } catch (err) {
    return handleApiError(err, 'update gig');
  }
}

/** How many child gigs a gig has (#175: a parent can't be deleted). */
export async function countChildGigs(gigId: string): Promise<number> {
  try {
    const { count, error } = await getSupabase()
      .from('gigs')
      .select('id', { count: 'exact', head: true })
      .eq('parent_gig_id', gigId);
    if (error) throw error;
    return count ?? 0;
  } catch (err) {
    return handleApiError(err, 'count child gigs');
  }
}

/**
 * Why the database refused to delete a gig (#175): it has child gigs, another
 * claimed organization is on it, or the user isn't an Admin of its owner.
 */
async function deleteRefusalReason(gigId: string): Promise<string> {
  const supabase = getSupabase();
  const { data: gig } = await supabase.from('gigs').select('id, owner_organization_id').eq('id', gigId).maybeSingle();
  if (!gig) return 'Gig not found, or you do not have permission to delete it.';

  const { data: children } = await supabase.from('gigs').select('id').eq('parent_gig_id', gigId).limit(1);
  if ((children ?? []).length > 0) {
    return 'This gig has child gigs, so it can\'t be deleted. Delete its child gigs first, or cancel it instead.';
  }

  const { data: participants } = await supabase
    .from('gig_participants')
    .select('organization_id, organization:organization_id(claimed)')
    .eq('gig_id', gigId);
  const othersOn = (participants ?? []).some((p: any) =>
    p.organization_id !== (gig as any).owner_organization_id && p.organization?.claimed);
  if (othersOn) {
    return 'Other organizations are on this gig, so it can\'t be deleted. Cancel it instead.';
  }
  return 'Only an Admin of the gig\'s owner organization can delete it.';
}

/**
 * Delete a gig
 */
export async function deleteGig(gigId: string) {
  const supabase = getSupabase();
  try {
    // The calendar events are removed only once the gig is gone (#175); their
    // ids are read first because the sync rows are deleted with the gig.
    const calendarEvents = await getGigCalendarEvents(gigId);

    // .select() so we can tell whether a row was actually removed. RLS denies
    // silently (0 rows, no error), so without this a non-Admin's delete would
    // report false success.
    const { data, error } = await supabase.from('gigs').delete().eq('id', gigId).select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error(await deleteRefusalReason(gigId));
    }
    await removeGigCalendarEvents(gigId, calendarEvents);
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'delete gig');
  }
}

/**
 * Duplicate an existing gig
 */
export async function duplicateGig(gigId: string, newTitle?: string) {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    const originalGig = await getGig(gigId);

    if (!originalGig.start || !originalGig.end) {
      throw new Error('Original gig missing start or end dates');
    }

    // Only the owner's Admins and Managers duplicate a gig, and the copy is the owner's (#175).
    const { data: managesOwner, error: ownerError } = await supabase.rpc('user_manages_gig_owner', {
      p_gig_id: gigId,
      p_user: user.id,
    });
    if (ownerError) throw ownerError;
    if (managesOwner !== true) {
      throw new Error("Only the gig owner's Admins and Managers can duplicate it.");
    }

    // A copy gets only the original's active participants (#175).
    const participants = (originalGig.participants || []).filter((gp: any) => !gp.inactive).map((gp: any) => ({
      organization_id: gp.organization_id,
      role: gp.role,
      notes: gp.notes,
    }));

    // The copy belongs to the gig's owner organization (#175).
    const primaryOrgId = originalGig.owner_organization_id;

    // Staff slots, kit assignments and financials belong to one org each; copy
    // only the owner's. The caller must manage the owner to create the gig (#61).
    // create_gig_complex reads the role *name* as `role` and ignores assignments,
    // so the copy (usually on a new date) starts unstaffed (#102).
    const staffSlots = (originalGig.staff_slots || [])
      .filter((slot: any) => slot.organization_id === primaryOrgId)
      .map((slot: any) => ({
        role: slot.role,
        organization_id: slot.organization_id,
        required_count: slot.required_count,
        notes: slot.notes,
      }));

    const { data, error } = await supabase.rpc('create_gig_complex', {
      p_gig_data: {
        title: newTitle || `${originalGig.title} (Copy)`,
        start: originalGig.start,
        end: originalGig.end,
        timezone: originalGig.timezone,
        status: 'Proposed',
        tags: originalGig.tags || [],
        notes: originalGig.notes,
        primary_organization_id: primaryOrgId,
      },
      p_participants: participants,
      p_staff_slots: staffSlots,
    });

    if (error) throw error;
    if (!data?.[0]?.id) throw new Error('Gig duplication failed to return an ID');

    const newGigId = data[0].id;
    // Parts of the copy the database refused (e.g. a locked tax year), reported at the end.
    const notCopied: string[] = [];

    const ownFinancials = (originalGig.financials || [])
      .filter((fin: any) => fin.organization_id === primaryOrgId);
    if (ownFinancials.length > 0) {
      // The copy is a new deal: carry the agreed terms, not their progress.
      // Rows past acceptance start over at accepted; ended ones are left out.
      const financials = ownFinancials
        .filter((fin: any) => fin.stage !== 'declined' && fin.stage !== 'cancelled')
        .map((fin: any) => ({
        gig_id: newGigId,
        organization_id: fin.organization_id,
        amount: fin.amount,
        date: fin.date,
        direction: fin.direction,
        stage: ['requested', 'quoted', 'accepted'].includes(fin.stage) ? fin.stage : 'accepted',
        category: fin.category,
        reference_number: fin.reference_number,
        counterparty_id: fin.counterparty_id,
        external_entity_name: fin.external_entity_name,
        currency: fin.currency,
        description: fin.description,
        notes: fin.notes,
        created_by: user.id,
      }));
      const { error: finError } = await supabase.from('gig_financials').insert(financials);
      if (finError) notCopied.push(`financials (${finError.message})`);
    }

    const ownKitAssignments = (originalGig.kit_assignments || [])
      .filter((gka: any) => gka.organization_id === primaryOrgId);
    if (ownKitAssignments.length > 0) {
      const kitAssignments = ownKitAssignments.map((gka: any) => ({
        gig_id: newGigId,
        kit_id: gka.kit_id,
        organization_id: gka.organization_id,
        notes: gka.notes,
        assigned_by: user.id,
      }));
      const { error: kitError } = await supabase.from('gig_kit_assignments').insert(kitAssignments);
      if (kitError) notCopied.push(`kit assignments (${kitError.message})`);
    }

    // Duplicate schedule entries with remapped act participant IDs
    if (originalGig.schedule_entries && originalGig.schedule_entries.length > 0) {
      const { data: newParticipants } = await supabase
        .from('gig_participants')
        .select('id, organization_id, role')
        .eq('gig_id', newGigId);

      const participantIdMap = new Map<string, string>();
      for (const oldP of (originalGig.participants || [])) {
        const newP = (newParticipants || []).find(
          (np: any) => np.organization_id === oldP.organization_id && np.role === oldP.role
        );
        if (newP && oldP.id) {
          participantIdMap.set(oldP.id, newP.id);
        }
      }

      await duplicateGigScheduleEntries(gigId, newGigId, participantIdMap);
    }

    const duplicatedGig = await getGig(newGigId);

    try {
      const actorDisplayName = actorNameOf(user);
      const { data: orgRow } = await supabase.from('organizations').select('name').eq('id', primaryOrgId).single();
      const actorOrgName = (orgRow as any)?.name ?? '';

      await writeActivity({
        organization_id: primaryOrgId,
        event_type: 'gig.created',
        entity_type: 'gig',
        entity_id: newGigId,
        gig_id: newGigId,
        actor_display_name: actorDisplayName,
        actor_org_name: actorOrgName,
        context: { gig_title: newTitle || originalGig.title + ' (Copy)' },
      });
    } catch (e) {
      console.error('Activity log failed:', e);
    }

    if (notCopied.length > 0) {
      throw new Error(`The gig was copied, but these parts couldn't be: ${notCopied.join('; ')}. Add them on the copy.`);
    }
    return duplicatedGig;
  } catch (err) {
    return handleApiError(err, 'duplicate gig');
  }
}

export async function getAllGigAccountingSummaries(
  organizationId: string
): Promise<GigAccountingSummary[]> {
  const supabase = getSupabase();
  try {
    const { data: participants, error: partError } = await supabase
      .from('gig_participants')
      .select('gig_id')
      .eq('organization_id', organizationId);

    if (partError) throw partError;

    if (!participants || participants.length === 0) return [];

    const gigIds = participants.map((p: { gig_id: string }) => p.gig_id);

    const { data: gigs, error: gigsError } = await supabase
      .from('gigs')
      .select('id, title, status, start, end, timezone')
      .in('id', gigIds);

    if (gigsError) throw gigsError;

    const { data: financials, error: finError } = await supabase
      .from('gig_financials')
      .select('id, gig_id, direction, stage, amount, amount_settled, due_date, paid_at')
      .in('gig_id', gigIds)
      .eq('organization_id', organizationId);

    if (finError) throw finError;

    const { data: assignments, error: staffError } = await supabase
      .from('gig_staff_assignments')
      .select(`
        id,
        fee,
        rate,
        rate_unit,
        status,
        completed_at,
        slot:gig_staff_slots!inner(gig_id, organization_id)
      `)
      .in('slot.gig_id', gigIds)
      .eq('slot.organization_id', organizationId);

    if (staffError) throw staffError;

    type RawFinancial = MoneyRow & { id: string; gig_id: string };

    type RawAssignment = {
      id: string;
      fee: number | null;
      rate: number | null;
      rate_unit: string | null;
      status: string;
      completed_at: string | null;
      slot: { gig_id: string; organization_id: string };
    };

    const financialsByGig = new Map<string, RawFinancial[]>();
    for (const f of (financials || []) as RawFinancial[]) {
      const list = financialsByGig.get(f.gig_id) ?? [];
      list.push(f);
      financialsByGig.set(f.gig_id, list);
    }

    const assignmentsByGig = new Map<string, RawAssignment[]>();
    for (const a of (assignments || []) as RawAssignment[]) {
      const gigId = (a.slot as { gig_id: string }).gig_id;
      const list = assignmentsByGig.get(gigId) ?? [];
      list.push(a);
      assignmentsByGig.set(gigId, list);
    }

    const now = new Date();
    return (gigs || []).map((gig: { id: string; title: string; status: string; start: string; end: string; timezone?: string | null }) => {
      const gigFinancials = financialsByGig.get(gig.id) ?? [];
      const gigAssignments = assignmentsByGig.get(gig.id) ?? [];
      const money = summarizeMoney(gigFinancials, gig.end, now);

      // Staff booked but not yet finalized; a finalized assignment is a
      // money-out row (owed until marked paid) and already in `money`. A rate
      // is estimated over the gig's hours or days (#213).
      let expectedStaffCosts = 0;
      for (const a of gigAssignments) {
        if ((a.status === 'Confirmed' || a.status === 'Requested') && !a.completed_at) {
          expectedStaffCosts += projectedStaffCost(a, gig).amount;
        }
      }

      const contractAmount = money.expectedIn;
      const outstandingRevenue = money.outstandingIn;
      const paymentsToMake = money.outstandingOut;
      const totalCosts = money.expectedOut + expectedStaffCosts;
      const profit = contractAmount - totalCosts;
      const margin = contractAmount > 0 ? (profit / contractAmount) * 100 : 0;

      let paymentHealth: PaymentHealth;
      if (outstandingRevenue === 0 && paymentsToMake === 0) {
        paymentHealth = 'all-clear';
      } else if (outstandingRevenue > 0 && paymentsToMake === 0) {
        paymentHealth = 'revenue-outstanding';
      } else if (outstandingRevenue === 0 && paymentsToMake > 0) {
        paymentHealth = 'payments-due';
      } else {
        paymentHealth = 'both';
      }

      return {
        gigId: gig.id,
        gigTitle: gig.title,
        gigStatus: gig.status as GigStatus,
        gigStart: gig.start,
        gigEnd: gig.end,
        contractAmount,
        received: money.receivedIn,
        outstandingRevenue,
        dueRevenue: money.dueIn,
        actualCosts: money.paidOut,
        expectedStaffCosts,
        expectedSubContractCosts: money.outstandingOut,
        totalCosts,
        paymentsToMake,
        paymentsDue: money.dueOut,
        profit,
        margin,
        paymentHealth,
        moneyInBadge: moneyInBadge(gigFinancials, gig.end, now),
      } satisfies GigAccountingSummary;
    });
  } catch (err) {
    return handleApiError(err, 'get all gig accounting summaries') as never;
  }
}

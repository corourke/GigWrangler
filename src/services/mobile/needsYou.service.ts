/**
 * Today's "Needs you" counts (#445): each is one query or server call, under the person's own
 * access. The definitions are in utils/needsYou.
 */
import { getSupabase } from '../base/dataAccess';
import { getOrgAccessRequests } from '../accessRequest.service';
import { listScanQueue, type ScanQueueItem } from '../purchaseScanQueue.service';
import { CREW_SPOTS_DAYS, UNPAID_STAGES, isPendingInvite, isReceiptToReview, openCrewSpots, paymentsDue } from '../../utils/needsYou';
import type { DayOfShowGig } from './dayOfShow.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const GIG_COLUMNS = 'id, title, start, end, timezone, all_day, status';

const asGig = (g: any): DayOfShowGig => ({
  id: g.id,
  title: g.title ?? '',
  start: g.start,
  end: g.end ?? null,
  timezone: g.timezone ?? null,
  all_day: g.all_day ?? null,
  status: g.status ?? null,
});

export interface Invite {
  assignmentId: string;
  role: string | null;
  gig: DayOfShowGig;
}

/** The signed-in person's invites to reply to, in any organization, soonest first. */
export async function fetchMyInvites(now: Date = new Date()): Promise<Invite[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('gig_staff_assignments')
    .select(`id, status, slot:gig_staff_slots!inner(organization_id, staff_role:staff_roles(name), gig:gigs!inner(${GIG_COLUMNS}))`)
    .eq('user_id', user.id)
    .in('status', ['Requested', 'Invited']);
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter((a) => a.slot?.gig && isPendingInvite({ status: a.status, gig: a.slot.gig }, now))
    .map((a) => ({ assignmentId: a.id, role: a.slot.staff_role?.name ?? null, gig: asGig(a.slot.gig) }))
    .sort((a, b) => String(a.gig.start).localeCompare(String(b.gig.start)));
}

/** The organization's open crew spots on gigs in the next 14 days. */
export async function fetchOpenCrewSpots(orgId: string, now: Date = new Date()) {
  const { data, error } = await getSupabase()
    .from('gig_staff_slots')
    .select(`required_count, gig:gigs!inner(${GIG_COLUMNS}), assignments:gig_staff_assignments(status)`)
    .eq('organization_id', orgId)
    .gte('gig.start', now.toISOString())
    .lte('gig.start', new Date(now.getTime() + CREW_SPOTS_DAYS * DAY_MS).toISOString());
  if (error) throw error;
  const slots = ((data ?? []) as any[]).map((s) => ({ required_count: s.required_count ?? 0, gig: asGig(s.gig), assignments: s.assignments ?? [] }));
  return openCrewSpots(slots, now);
}

export interface PaymentLine {
  id: string;
  gigId: string;
  gigTitle: string;
  direction: 'in' | 'out';
  due_date: string;
}

/** The organization's unpaid lines due today or overdue (Admins: they can read the money). */
export async function fetchPaymentsDue(orgId: string, today: string): Promise<{ due: number; overdue: number; lines: PaymentLine[] }> {
  const { data, error } = await getSupabase()
    .from('gig_financials')
    .select('id, due_date, stage, direction, gig:gigs(id, title)')
    .eq('organization_id', orgId)
    .lte('due_date', today)
    .in('stage', [...UNPAID_STAGES]);
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const lines = rows
    .map((r) => ({ id: r.id, gigId: r.gig?.id ?? '', gigTitle: r.gig?.title ?? '', direction: r.direction, due_date: r.due_date }))
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return { ...paymentsDue(rows, today), lines };
}

/** Pending access requests the person can decide (the server filters by role). */
export async function fetchAccessRequestCount(orgId: string): Promise<number> {
  return (await getOrgAccessRequests(orgId)).length;
}

/** Receipts still in the organization's scan queue. */
export async function fetchReceiptsToReview(orgId: string): Promise<ScanQueueItem[]> {
  return (await listScanQueue(orgId)).filter(isReceiptToReview);
}

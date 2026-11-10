/**
 * The day-of-show sheet (§3e): one gig's schedule, venue, contacts, crew and documents, saved on
 * the phone so it still opens at a venue with poor signal. The device copy holds only what the
 * signed-in person could already read (RLS) and no money, rates, fees or notes; it is cleared with
 * the rest of the offline copy at sign-out (offlineOwner).
 */
import { idbStore } from '../../utils/idb/store';
import { getGig } from '../gig.service';
import { getAllGigContacts, type GigParticipantContact } from '../gigParticipantContacts.service';
import { getEntityAttachments } from '../attachment.service';
import { loadMyUpcomingAssignments } from './myAssignments.service';
import { packingListService } from './packingList.service';
import { removeSavedDocumentsForGig } from './dayOfShowFiles.service';
import { pickTodayGigs, type TodayGigLike } from '../../utils/todayGig';
import type { UserRole } from '../../utils/supabase/types';

export interface DayOfShowGig extends TodayGigLike {
  title: string;
}

export interface DayOfShowPlace {
  name: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  phone_number?: string | null;
}

export interface DayOfShowScheduleEntry {
  id: string;
  activity_type: string;
  label?: string | null;
  start_time: string;
  end_time?: string | null;
  act_name?: string | null;
}

export interface DayOfShowPerson {
  key: string;
  name: string;
  /** A contact's title, or a crew member's role. */
  title?: string | null;
  phone?: string | null;
  email?: string | null;
  /** For a contact: the participating organization and its role on the gig. */
  org_name?: string | null;
  org_role?: string | null;
}

export interface DayOfShowDocument {
  id: string;
  file_name: string;
  file_path: string;
}

export interface DayOfShowSheet {
  gig_id: string;
  /** When this copy was fetched (ms since epoch). */
  saved_at: number;
  gig: DayOfShowGig;
  venue: DayOfShowPlace | null;
  schedule: DayOfShowScheduleEntry[];
  contacts: DayOfShowPerson[];
  crew: (DayOfShowPerson & { role: string })[];
  documents: DayOfShowDocument[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const fullName = (u?: { first_name?: string | null; last_name?: string | null } | null) =>
  u ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : '';

const place = (org: any): DayOfShowPlace | null =>
  org
    ? {
        name: org.name ?? '',
        address_line1: org.address_line1 ?? null,
        address_line2: org.address_line2 ?? null,
        city: org.city ?? null,
        state: org.state ?? null,
        postal_code: org.postal_code ?? null,
        phone_number: org.phone_number ?? null,
      }
    : null;

/**
 * The sheet from a gig as getGig returns it, its contacts and its attachments. Picks fields one by
 * one, so nothing else the gig carries (financials, rates, fees, notes) is saved on the phone.
 */
export function buildDayOfShowSheet(
  gig: any,
  contacts: GigParticipantContact[],
  attachments: any[],
  savedAt: number = Date.now(),
): DayOfShowSheet {
  const participants: any[] = gig.participants ?? [];
  const orgById = new Map<string, any>(participants.map((p) => [p.organization_id, p]));

  const schedule: DayOfShowScheduleEntry[] = [...(gig.schedule_entries ?? [])]
    .sort((a: any, b: any) => String(a.start_time).localeCompare(String(b.start_time)))
    .map((e: any) => ({
      id: e.id,
      activity_type: e.activity_type,
      label: e.label ?? null,
      start_time: e.start_time,
      end_time: e.end_time ?? null,
      act_name: e.act_participant?.organization?.name ?? null,
    }));

  const people: DayOfShowPerson[] = (contacts ?? [])
    .filter((c) => c.user)
    .map((c) => {
      const p = orgById.get(c.organization_id);
      return {
        key: c.id,
        name: fullName(c.user),
        title: c.title ?? null,
        phone: c.user.phone ?? null,
        email: c.user.email ?? null,
        org_name: p?.organization?.name ?? null,
        org_role: p?.role ?? null,
      };
    });

  const crew = (gig.staff_slots ?? []).flatMap((slot: any) => {
    const role = slot.role || slot.role_info?.name || 'Crew';
    return (slot.staff_assignments ?? slot.assignments ?? [])
      .filter((a: any) => a.user_id && a.user && a.status !== 'Declined')
      .map((a: any) => ({
        key: String(a.id),
        name: fullName(a.user),
        role,
        title: role,
        phone: a.user.phone ?? null,
        email: a.user.email ?? null,
      }));
  });

  return {
    gig_id: gig.id,
    saved_at: savedAt,
    gig: {
      id: gig.id,
      title: gig.title ?? '',
      start: gig.start,
      end: gig.end ?? null,
      timezone: gig.timezone ?? null,
      all_day: gig.all_day ?? null,
      status: gig.status ?? null,
    },
    venue: place(participants.find((p) => p.role === 'Venue')?.organization),
    schedule,
    contacts: people,
    crew,
    documents: (attachments ?? []).map((a: any) => ({ id: a.id, file_name: a.file_name, file_path: a.file_path })),
  };
}

/** Removes saved sheets, and their saved documents, whose gig ended more than a day ago. */
export async function pruneDayOfShow(now: number = Date.now()): Promise<void> {
  const saved = await idbStore.getAllDayOfShow();
  for (const sheet of saved) {
    const end = new Date(sheet.gig?.end ?? sheet.gig?.start ?? 0).getTime();
    if (Number.isNaN(end) || end < now - DAY_MS) {
      await idbStore.deleteDayOfShow(sheet.gig_id);
      await removeSavedDocumentsForGig(sheet.gig_id).catch(() => {});
    }
  }
}

/**
 * Hands the device copy to `onCached` straight away, then (online) fetches a fresh sheet, saves
 * it and returns it. Offline, or when the server can't be reached, returns the device copy; with
 * no device copy, null offline, or the error online.
 */
export async function loadDayOfShowSheet(
  gigId: string,
  onCached: (cached: DayOfShowSheet) => void,
): Promise<DayOfShowSheet | null> {
  const cached = ((await idbStore.getDayOfShow(gigId).catch(() => undefined)) ?? null) as DayOfShowSheet | null;
  if (cached) onCached(cached);
  if (!navigator.onLine) return cached;

  let fresh: DayOfShowSheet;
  try {
    const [gig, contacts, attachments] = await Promise.all([
      getGig(gigId),
      getAllGigContacts(gigId),
      getEntityAttachments('gig', gigId),
    ]);
    fresh = buildDayOfShowSheet(gig, contacts, attachments ?? []);
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
  await idbStore.putDayOfShow(fresh).catch(() => {});
  await pruneDayOfShow().catch(() => {});
  return fresh;
}

/** Whether to save a gig's sheet ahead of time: it is on today, or starts within 24 hours. */
export function shouldSaveAhead(gig: TodayGigLike, now: Date = new Date()): boolean {
  if (gig.status === 'Cancelled') return false;
  if (pickTodayGigs([gig], now).today.length > 0) return true;
  const start = new Date(gig.start).getTime();
  return start > now.getTime() && start - now.getTime() <= DAY_MS;
}

const asCandidate = (g: any): DayOfShowGig => ({
  id: g.id,
  title: g.title ?? '',
  start: g.start,
  end: g.end ?? null,
  timezone: g.timezone ?? null,
  all_day: g.all_day ?? null,
  status: g.status ?? null,
});

const inOrg = (orgId: string) => (g: any) =>
  (g.participants ?? []).some((p: any) => p.organization_id === orgId);

/**
 * The gigs the Today tab chooses from. Staff: their own assignments (My Schedule's list, next 7
 * days). Admin and Manager: the selected organization's gigs over the same days. The device copy
 * goes to `onCached` first; offline, or when the server can't be reached, it is the answer.
 */
export async function loadTodayCandidates(
  { role, orgId }: { role: UserRole | null | undefined; orgId: string },
  onCached: (cached: DayOfShowGig[]) => void,
): Promise<DayOfShowGig[]> {
  if (role === 'Staff') {
    const list = await loadMyUpcomingAssignments((cached) => onCached(cached.map((a) => asCandidate(a.gig))));
    return (list ?? []).map((a) => asCandidate(a.gig));
  }
  const onDevice = async () =>
    ((await idbStore.getGigs().catch(() => [])) as any[]).filter(inOrg(orgId)).map(asCandidate);
  if (!navigator.onLine) return onDevice();
  try {
    return ((await packingListService.fetchUpcomingGigs()) ?? []).filter(inOrg(orgId)).map(asCandidate);
  } catch (error) {
    const saved = await onDevice();
    if (saved.length > 0) return saved;
    throw error;
  }
}

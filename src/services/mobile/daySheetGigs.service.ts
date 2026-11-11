/**
 * "Choose another gig" for the day sheet (#445): the gigs a person can open a day sheet for.
 */
import { getSupabase } from '../base/dataAccess';
import { idbStore } from '../../utils/idb/store';
import type { DayOfShowGig } from './dayOfShow.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back a person's own gigs are listed. */
export const PAST_DAYS = 30;

/**
 * The signed-in person's gigs (their staff assignments, not declined) from 30 days ago on, soonest
 * first, each once, without cancelled gigs.
 */
export async function listMyDaySheetGigs(now: Date = new Date()): Promise<DayOfShowGig[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const since = new Date(now.getTime() - PAST_DAYS * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from('gig_staff_assignments')
    .select('slot:gig_staff_slots!inner(gig:gigs!inner(id, title, start, end, timezone, all_day, status))')
    .eq('user_id', user.id)
    .neq('status', 'Declined')
    .gte('slot.gig.start', since);
  if (error) throw error;
  const byId = new Map<string, DayOfShowGig>();
  for (const row of (data ?? []) as any[]) {
    const g = row.slot?.gig;
    if (!g || g.status === 'Cancelled' || byId.has(g.id)) continue;
    byId.set(g.id, {
      id: g.id,
      title: g.title ?? '',
      start: g.start,
      end: g.end ?? null,
      timezone: g.timezone ?? null,
      all_day: g.all_day ?? null,
      status: g.status ?? null,
    });
  }
  return [...byId.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

/** The gigs whose day sheet is saved on this phone. */
export async function listSavedSheetIds(): Promise<Set<string>> {
  try {
    const saved = (await idbStore.getAllDayOfShow()) as Array<{ gig_id: string }>;
    return new Set(saved.map((s) => s.gig_id));
  } catch {
    return new Set();
  }
}

const asGig = (g: any): DayOfShowGig => ({
  id: g.id,
  title: g.title ?? '',
  start: g.start,
  end: g.end ?? null,
  timezone: g.timezone ?? null,
  all_day: g.all_day ?? null,
  status: g.status ?? null,
});

/**
 * Offline, with nothing loaded yet: the organization's gigs on the phone (the saved gig list) and
 * the gigs whose day sheet is saved, each once.
 */
export async function listOfflineGigs(orgId: string): Promise<DayOfShowGig[]> {
  const [gigs, sheets] = await Promise.all([
    idbStore.getGigs().catch(() => [] as any[]),
    idbStore.getAllDayOfShow().catch(() => [] as any[]),
  ]);
  const byId = new Map<string, DayOfShowGig>();
  for (const g of gigs as any[]) {
    if ((g.participants ?? []).some((p: any) => p.organization_id === orgId)) byId.set(g.id, asGig(g));
  }
  for (const sheet of sheets as any[]) {
    if (sheet?.gig && !byId.has(sheet.gig_id)) byId.set(sheet.gig_id, asGig({ ...sheet.gig, id: sheet.gig_id }));
  }
  return [...byId.values()];
}

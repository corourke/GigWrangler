import { isGigAllDay, toDateInTimeZone } from './dateUtils';

/** The fields of a gig that decide whether it is "today" (day-of-show sheet, §3e). */
export interface TodayGigLike {
  id: string;
  title?: string;
  start: string;
  end?: string | null;
  timezone?: string | null;
  all_day?: boolean | null;
  status?: string | null;
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** Where a gig stands against `now`: on today (in its own time zone), still to come, or neither. */
function classify(gig: TodayGigLike, now: Date): { today: boolean; inProgress: boolean; upcoming: boolean } {
  const tz = gig.timezone || undefined;
  if (isGigAllDay(gig)) {
    // An all-day gig is its calendar dates (stored at noon UTC), compared with today's date where it is.
    const startDay = toDateInTimeZone(gig.start, 'UTC');
    const endDay = gig.end ? toDateInTimeZone(gig.end, 'UTC') : startDay;
    const todayThere = toDateInTimeZone(now, tz);
    const today = startDay <= todayThere && todayThere <= (endDay < startDay ? startDay : endDay);
    return { today, inProgress: today, upcoming: startDay > todayThere };
  }
  const start = ms(gig.start);
  const end = ms(gig.end);
  const t = now.getTime();
  const ended = !Number.isNaN(end) && end <= t;
  const inProgress = start <= t && !ended;
  const sameDay = toDateInTimeZone(gig.start, tz) === toDateInTimeZone(now, tz);
  return { today: inProgress || (sameDay && !ended), inProgress, upcoming: start > t };
}

/**
 * The gigs on the day-of-show sheet: those in progress now or starting later today (each by its
 * own time zone; an all-day gig by its dates), in progress first, then by start. With none today,
 * `next` is the earliest gig still to come. Cancelled gigs are left out.
 */
export function pickTodayGigs<T extends TodayGigLike>(gigs: T[], now: Date = new Date()): { today: T[]; next: T | null } {
  const seen = new Set<string>();
  const live = gigs.filter((g) => {
    if (!g?.id || g.status === 'Cancelled' || seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });
  const rated = live.map((g) => ({ g, c: classify(g, now) }));
  const byStart = (a: { g: T }, b: { g: T }) => ms(a.g.start) - ms(b.g.start);
  const today = rated
    .filter((r) => r.c.today)
    .sort((a, b) => Number(b.c.inProgress) - Number(a.c.inProgress) || byStart(a, b))
    .map((r) => r.g);
  const next = today.length > 0 ? null : (rated.filter((r) => r.c.upcoming).sort(byStart)[0]?.g ?? null);
  return { today, next };
}

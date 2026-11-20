import { formatInTimeZone } from './dateUtils';

/** A person's own arrival at a gig (#458), as the day sheet carries it. */
export interface MyArrival {
  /** The phone's time when it was tapped. */
  arrived_at: string;
  /** A Manager or Admin set it, so only a Manager or Admin can change it. */
  by_manager: boolean;
  /** Saved on the phone, not sent yet. */
  pending?: boolean;
}

export interface ArrivalCrew {
  user_id?: string | null;
  status?: string | null;
}

/** A person records their arrival from this long before the gig starts to this long after it ends. */
export const ARRIVAL_WINDOW_HOURS = 12;

export function arrivalWindowOpen(gig: { start: string; end?: string | null }, now: Date = new Date()): boolean {
  const hour = 60 * 60 * 1000;
  const start = new Date(gig.start).getTime();
  const end = new Date(gig.end ?? gig.start).getTime();
  const t = now.getTime();
  return t >= start - ARRIVAL_WINDOW_HOURS * hour && t <= end + ARRIVAL_WINDOW_HOURS * hour;
}

/** The signed-in person is on the crew with a Confirmed or Invited assignment (any of their slots). */
export function canCheckInOwn(crew: readonly ArrivalCrew[], userId: string | null | undefined): boolean {
  if (!userId) return false;
  return crew.some((c) => c.user_id === userId && (c.status === 'Confirmed' || c.status === 'Invited'));
}

/** "2:42 PM", in the gig's time zone. */
export function arrivalTimeLabel(iso: string, timezone?: string | null): string {
  return formatInTimeZone(new Date(iso), timezone || undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\u202f/g, ' ');
}

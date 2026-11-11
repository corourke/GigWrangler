/**
 * Today's "Needs you" counts (#445): what each one counts, apart from where the rows come from.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The days ahead "Open crew spots" looks at. */
export const CREW_SPOTS_DAYS = 14;

/** Payment stages that still owe money (the same as the payment reminders, migration 20261110120000). */
export const UNPAID_STAGES = ['accepted', 'contract_sent', 'contracted', 'invoiced'] as const;

/** Assignment statuses that take a crew spot. Declined doesn't. */
const FILLING = new Set(['Requested', 'Invited', 'Confirmed']);

/** Scan-queue statuses still waiting for someone (not yet saved or discarded). */
const TO_REVIEW = new Set(['queued', 'scanning', 'ready', 'failed']);

interface GigLike {
  id: string;
  title?: string;
  start: string;
  end?: string | null;
  status?: string | null;
}

/** An invite to reply to: Requested or Invited, on a gig that hasn't ended and isn't cancelled. */
export function isPendingInvite(a: { status: string; gig: GigLike }, now: Date = new Date()): boolean {
  if (a.status !== 'Requested' && a.status !== 'Invited') return false;
  if (a.gig.status === 'Cancelled') return false;
  return new Date(a.gig.end ?? a.gig.start).getTime() >= now.getTime();
}

export interface CrewSlotLike<G extends GigLike = GigLike> {
  required_count: number;
  gig: G;
  assignments: { status: string }[];
}

/**
 * Open crew spots on gigs starting in the next 14 days, not cancelled: per slot, the people still
 * needed (required minus Requested, Invited and Confirmed), summed; and the gigs that have some.
 */
export function openCrewSpots<G extends GigLike>(
  slots: CrewSlotLike<G>[],
  now: Date = new Date(),
): { spots: number; gigs: { gig: G; open: number }[] } {
  const from = now.getTime();
  const to = from + CREW_SPOTS_DAYS * DAY_MS;
  const byGig = new Map<string, { gig: G; open: number }>();
  for (const slot of slots) {
    const start = new Date(slot.gig.start).getTime();
    if (slot.gig.status === 'Cancelled' || start < from || start > to) continue;
    const filled = slot.assignments.filter((a) => FILLING.has(a.status)).length;
    const open = Math.max(0, slot.required_count - filled);
    if (open === 0) continue;
    const entry = byGig.get(slot.gig.id) ?? { gig: slot.gig, open: 0 };
    entry.open += open;
    byGig.set(slot.gig.id, entry);
  }
  const gigs = [...byGig.values()].sort((a, b) => String(a.gig.start).localeCompare(String(b.gig.start)));
  return { spots: gigs.reduce((sum, g) => sum + g.open, 0), gigs };
}

/** Unpaid lines due today, and overdue (due before today). `today` is a YYYY-MM-DD date. */
export function paymentsDue(lines: { due_date: string | null; stage: string }[], today: string): { due: number; overdue: number } {
  let due = 0;
  let overdue = 0;
  for (const line of lines) {
    if (!line.due_date || !(UNPAID_STAGES as readonly string[]).includes(line.stage)) continue;
    if (line.due_date === today) due++;
    else if (line.due_date < today) overdue++;
  }
  return { due, overdue };
}

/** Receipts still in the scan queue. */
export function receiptsToReview(items: { status: string }[]): number {
  return items.filter((i) => TO_REVIEW.has(i.status)).length;
}

export const isReceiptToReview = (i: { status: string }) => TO_REVIEW.has(i.status);

/** The days ahead "Equipment conflicts" looks at. */
export const CONFLICT_DAYS = 7;

/** Gigs that haven't ended, start within the next 7 days and aren't cancelled. */
export function gigsThisWeek<G extends GigLike>(gigs: G[], now: Date = new Date()): G[] {
  const from = now.getTime();
  const to = from + CONFLICT_DAYS * DAY_MS;
  return gigs.filter((g) => {
    if (g.status === 'Cancelled') return false;
    const start = new Date(g.start).getTime();
    const end = new Date(g.end ?? g.start).getTime();
    return end >= from && start <= to;
  });
}

interface ConflictLike {
  level: string;
  type: string;
  gig_id: string;
  gig_title: string;
  start: string;
  details: { other_gig_title?: string };
}

export interface EquipmentConflictGig {
  gigId: string;
  title: string;
  start: string;
  /** The titles of the gigs it clashes with. */
  others: string[];
}

/**
 * Equipment conflicts among a set of gigs, from the conflict check: the gigs that have one, each
 * once (the check reports a clash for both gigs of a pair), soonest first, with what they clash with.
 */
export function equipmentConflicts(conflicts: ConflictLike[]): { count: number; gigs: EquipmentConflictGig[] } {
  const byGig = new Map<string, EquipmentConflictGig>();
  for (const c of conflicts) {
    if (c.type !== 'equipment' || c.level !== 'conflict') continue;
    const entry = byGig.get(c.gig_id) ?? { gigId: c.gig_id, title: c.gig_title, start: c.start, others: [] };
    const other = c.details?.other_gig_title;
    if (other && !entry.others.includes(other)) entry.others.push(other);
    byGig.set(c.gig_id, entry);
  }
  const gigs = [...byGig.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { count: gigs.length, gigs };
}

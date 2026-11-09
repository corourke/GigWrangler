/**
 * Gig money, as stored in gig_financials since the 2026-10 redesign: every row
 * is money coming in or going out (`direction`) and sits at one `stage`.
 * Every stage except `paid` is optional: a verbal agreement goes straight from
 * accepted to paid, a mileage expense is paid when it is recorded.
 *
 * These helpers are the one place that decides what a row counts toward, so
 * the gig page, the accounting report and the exports always agree.
 */

import { money } from './money';

export type FinDirection = 'in' | 'out';

export type FinStage =
  | 'requested'
  | 'quoted'
  | 'accepted'
  | 'contract_sent'
  | 'contracted'
  | 'invoiced'
  | 'paid'
  | 'declined'
  | 'cancelled';

/** The forward path, in order. Declined and cancelled end a row off this path. */
export const STAGE_PATH: FinStage[] = [
  'requested',
  'quoted',
  'accepted',
  'contract_sent',
  'contracted',
  'invoiced',
  'paid',
];

export const ALL_STAGES: FinStage[] = [...STAGE_PATH, 'declined', 'cancelled'];

/** Stages offered in pickers: money in has no "bid requested" step. */
export function stagesFor(direction: FinDirection): FinStage[] {
  return direction === 'in' ? ALL_STAGES.filter((s) => s !== 'requested') : ALL_STAGES;
}

export const STAGE_LABELS: Record<FinDirection, Record<FinStage, string>> = {
  in: {
    requested: 'Bid requested',
    quoted: 'Quoted',
    accepted: 'Accepted',
    contract_sent: 'Contract sent',
    contracted: 'Contracted',
    invoiced: 'Invoiced',
    paid: 'Paid',
    declined: 'Declined',
    cancelled: 'Cancelled',
  },
  out: {
    requested: 'Bid requested',
    quoted: 'Bid received',
    accepted: 'Accepted',
    contract_sent: 'Contract sent',
    contracted: 'Contracted',
    invoiced: 'Owed',
    paid: 'Paid',
    declined: 'Declined',
    cancelled: 'Cancelled',
  },
};

export function stageLabel(direction: FinDirection, stage: FinStage): string {
  return STAGE_LABELS[direction]?.[stage] ?? stage;
}

/**
 * A stage as offered in a picker. A verbal or informal agreement is the
 * accepted stage, so the money-in option says so.
 */
export function stagePickerLabel(direction: FinDirection, stage: FinStage): string {
  if (direction === 'in' && stage === 'accepted') return 'Accepted (incl. verbal / informal)';
  return stageLabel(direction, stage);
}

/** The fields the calculations need; DB rows and form rows both fit. */
export interface MoneyRow {
  direction: FinDirection;
  stage: FinStage;
  amount: number | string | null;
  amount_settled?: number | string | null;
  due_date?: string | null;
  paid_at?: string | null;
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? parseFloat(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
};

/** Stages that commit money: accepted or later on the forward path. */
export function isCommitted(stage: FinStage): boolean {
  return ['accepted', 'contract_sent', 'contracted', 'invoiced', 'paid'].includes(stage);
}

/** What the row is expected to bring in or cost. A paid row counts what actually moved. */
export function expectedAmount(row: MoneyRow): number {
  if (!isCommitted(row.stage)) return 0;
  return row.stage === 'paid' ? num(row.amount_settled ?? row.amount) : num(row.amount);
}

/** What has actually been received or paid. */
export function settledAmount(row: MoneyRow): number {
  return row.stage === 'paid' ? num(row.amount_settled ?? row.amount) : 0;
}

/** Committed but not yet paid. */
export function outstandingAmount(row: MoneyRow): number {
  return isCommitted(row.stage) && row.stage !== 'paid' ? num(row.amount) : 0;
}

/** YYYY-MM-DD for a Date, in local time. */
export function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Whether an unpaid row is due now: on or after its due date, or, with no due
 * date, once the gig is over (`gigEnd` in the past).
 */
export function isDue(row: MoneyRow, gigEnd: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (outstandingAmount(row) <= 0) return false;
  if (row.due_date) return row.due_date <= toDateKey(now);
  if (!gigEnd) return false;
  return new Date(gigEnd).getTime() < now.getTime();
}

export interface MoneySummary {
  /** Money in, accepted or later (paid rows at what was received). */
  expectedIn: number;
  receivedIn: number;
  /** Money in, committed and not yet received. */
  outstandingIn: number;
  /** Part of outstandingIn that is due now. */
  dueIn: number;
  expectedOut: number;
  paidOut: number;
  outstandingOut: number;
  dueOut: number;
  /** expectedIn − expectedOut. */
  net: number;
}

export function summarizeMoney(
  rows: MoneyRow[],
  gigEnd?: string | Date | null,
  now: Date = new Date(),
): MoneySummary {
  const s: MoneySummary = {
    expectedIn: 0, receivedIn: 0, outstandingIn: 0, dueIn: 0,
    expectedOut: 0, paidOut: 0, outstandingOut: 0, dueOut: 0, net: 0,
  };
  for (const r of rows) {
    const due = isDue(r, gigEnd, now) ? outstandingAmount(r) : 0;
    if (r.direction === 'in') {
      s.expectedIn += expectedAmount(r);
      s.receivedIn += settledAmount(r);
      s.outstandingIn += outstandingAmount(r);
      s.dueIn += due;
    } else {
      s.expectedOut += expectedAmount(r);
      s.paidOut += settledAmount(r);
      s.outstandingOut += outstandingAmount(r);
      s.dueOut += due;
    }
  }
  // Whole cents: float sums of stored amounts carry noise (B16).
  for (const k of Object.keys(s) as (keyof MoneySummary)[]) s[k] = money(s[k]);
  s.net = money(s.expectedIn - s.expectedOut);
  return s;
}

const formatShortDate = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export type MoneyBadgeTone = 'attention' | 'pending' | 'done' | 'muted';

export interface MoneyBadge {
  label: string;
  tone: MoneyBadgeTone;
}

/**
 * The gig's money-in status at a glance, from its least advanced unpaid
 * money-in row: "Payment due", "Invoiced, due Oct 26", "Accepted", "Paid".
 * Null when the gig has no money-in rows.
 */
export function moneyInBadge(
  rows: MoneyRow[],
  gigEnd?: string | Date | null,
  now: Date = new Date(),
): MoneyBadge | null {
  const incoming = rows.filter((r) => r.direction === 'in');
  if (incoming.length === 0) return null;

  const open = incoming.filter((r) => outstandingAmount(r) > 0);
  if (open.length > 0) {
    if (open.some((r) => isDue(r, gigEnd, now))) {
      const overdue = open.some((r) => r.due_date && r.due_date < toDateKey(now));
      return { label: overdue ? 'Overdue' : 'Payment due', tone: 'attention' };
    }
    const least = open.reduce((a, b) => (STAGE_PATH.indexOf(b.stage) < STAGE_PATH.indexOf(a.stage) ? b : a));
    const label = stageLabel('in', least.stage);
    return { label: least.due_date ? `${label}, due ${formatShortDate(least.due_date)}` : label, tone: 'pending' };
  }
  if (incoming.some((r) => r.stage === 'paid')) return { label: 'Paid', tone: 'done' };
  const quoted = incoming.find((r) => r.stage === 'quoted' || r.stage === 'requested');
  if (quoted) return { label: stageLabel('in', quoted.stage), tone: 'pending' };
  return { label: stageLabel('in', incoming[0].stage), tone: 'muted' };
}

/** The next stage on the forward path, or null at paid / off the path. */
export function nextStage(stage: FinStage): FinStage | null {
  const i = STAGE_PATH.indexOf(stage);
  return i >= 0 && i < STAGE_PATH.length - 1 ? STAGE_PATH[i + 1] : null;
}

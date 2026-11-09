import { RATE_UNITS, rateUnit, type RateUnit } from '../components/gig/view/staffRows';
import { isGigAllDay, toDateInTimeZone } from './dateUtils';

/**
 * Projected staff cost for a rate that isn't finalized yet (#213).
 *
 * A rate is paid per hour, day or half day (#171). Until the assignment is
 * finalized with the units actually worked, its cost is estimated from the
 * gig's own times. Every place that shows a projected staff cost uses this
 * one helper, so they agree.
 */

export interface GigTimes {
  start?: string | null;
  end?: string | null;
  timezone?: string | null;
  all_day?: boolean | null;
}

export interface RateUnitEstimate {
  /** How many of the rate's unit the gig is estimated to take. */
  units: number;
  /** The units in words: "9 hr", "2 days", "1 half day", or "1 hr (no end time)". */
  label: string;
}

/**
 * An end before this local time belongs to the day before: a gig that runs
 * past midnight and ends at 02:00 is still one day. Same cut-off as the
 * Google Calendar sync uses for overnight gigs (#201).
 */
const OVERNIGHT_CUTOFF_MINUTES = 6 * 60;

const COUNT_NAMES: Record<RateUnit, [string, string]> = {
  hour: ['hr', 'hr'],
  day: ['day', 'days'],
  half_day: ['half day', 'half days'],
};

const count = (n: number, unit: RateUnit) => `${n} ${COUNT_NAMES[unit][n === 1 ? 0 : 1]}`;

/** "$1,234.50": two decimals, like the staffing footer and the Financials tab. */
export const dollars = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Minutes past local midnight of `date` in `timeZone` (browser local when unset or invalid). */
function localMinutes(date: Date, timeZone?: string | null): number {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      return (part('hour') % 24) * 60 + part('minute');
    } catch {
      // Invalid time zone: fall through to local time
    }
  }
  return date.getHours() * 60 + date.getMinutes();
}

/** Whole days from one YYYY-MM-DD date to another. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The valid start and end instants of a gig; `end` is null unless it is after the start. */
function gigInstants(gig: GigTimes | null | undefined): { start: Date | null; end: Date | null } {
  const start = gig?.start ? new Date(gig.start) : null;
  if (!start || isNaN(start.getTime())) return { start: null, end: null };
  const end = gig?.end ? new Date(gig.end) : null;
  return { start, end: end && !isNaN(end.getTime()) && end.getTime() > start.getTime() ? end : null };
}

/**
 * The calendar days a gig spans in its own timezone, start day through end
 * day inclusive, at least 1. An end before 06:00 local counts toward the day
 * before, so an overnight gig ending at 02:00 is one day. A date-only gig
 * (stored at noon UTC) counts its UTC dates.
 */
function gigDays(gig: GigTimes | null | undefined): number {
  const { start, end } = gigInstants(gig);
  if (!start || !end) return 1;
  if (isGigAllDay(gig!)) {
    return Math.max(1, daysBetween(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)) + 1);
  }
  const tz = gig?.timezone;
  const firstDay = toDateInTimeZone(start, tz);
  const lastDay = toDateInTimeZone(end, tz);
  const overnight = localMinutes(end, tz) < OVERNIGHT_CUTOFF_MINUTES ? 1 : 0;
  return Math.max(1, daysBetween(firstDay, lastDay) - overnight + 1);
}

/**
 * Estimate how many of a rate's unit a gig takes:
 *  - per hour: the hours from the gig's start to its end, rounded to the
 *    nearest quarter hour. With no end, an end not after the start, or a
 *    date-only gig, it's a 1-hour placeholder and the label says so;
 *  - per day: the gig's calendar days (see gigDays);
 *  - per half day: one per gig day.
 */
export function estimateRateUnits(gig: GigTimes | null | undefined, unit?: string | null): RateUnitEstimate {
  const u = rateUnit(unit);
  if (u === 'hour') {
    const { start, end } = gigInstants(gig);
    if (start && isGigAllDay(gig!)) return { units: 1, label: '1 hr (no times)' };
    if (!start || !end) return { units: 1, label: '1 hr (no end time)' };
    const hours = Math.max(0.25, Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 4) / 4);
    return { units: hours, label: count(hours, u) };
  }
  const days = gigDays(gig);
  return { units: days, label: count(days, u) };
}

export interface ProjectedStaffCost {
  amount: number;
  /** "est. 9 hr × $35.00 / hr = $315.00" for a rate; the amount for a fee. */
  label: string;
  /** How the amount is reached, without the amount: "est. 9 hr × $35.00 / hr" for a rate, "Fee" for a fee. */
  basis: string;
}

/**
 * What a booked, not yet finalized assignment is projected to cost: a fee at
 * its flat amount, a rate times the units estimated from the gig. (Once
 * finalized, the cost is the rate times the units entered instead.)
 */
export function projectedStaffCost(
  a: { fee?: number | string | null; rate?: number | string | null; rate_unit?: string | null },
  gig: GigTimes | null | undefined,
): ProjectedStaffCost {
  if (a.fee != null) {
    const fee = Number(a.fee) || 0;
    return { amount: fee, label: dollars(fee), basis: 'Fee' };
  }
  if (a.rate == null) return { amount: 0, label: dollars(0), basis: '' };
  const rate = Number(a.rate) || 0;
  const estimate = estimateRateUnits(gig, a.rate_unit);
  const amount = Math.round(rate * estimate.units * 100) / 100;
  const per = RATE_UNITS.find((r) => r.value === rateUnit(a.rate_unit))!.label;
  const basis = `est. ${estimate.label} × ${dollars(rate)} ${per}`;
  return { amount, label: `${basis} = ${dollars(amount)}`, basis };
}

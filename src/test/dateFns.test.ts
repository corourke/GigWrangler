/**
 * A17 (date-fns 3 → 4): pins every date-fns call the app makes, with the patterns it uses, in two
 * time zones, so the upgrade can't quietly change a date the app shows, stores or exports.
 * Dates are built from local parts after setting TZ, so each case reads the same on any machine.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { format, parseISO, formatDistanceToNow, addDays, subDays, startOfWeek, parse, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { dateFnsLocalizer } from 'react-big-calendar';
import { formatDateOnly, parseDateOnly } from '../utils/dateOnly';
import { formatShort, formatLong } from '../components/gig/financials/format';
import { formatScannedAt } from '../components/mobile/inventory/inventoryModel';
import { applyDateFilter } from '../components/gigs/gigDateFilter';
import { ACTIVITY_EVENTS } from '../utils/activityLog.events';

const ZONES = ['America/Los_Angeles', 'Europe/London'] as const;
let originalTZ: string | undefined;
beforeAll(() => { originalTZ = process.env.TZ; });
afterAll(() => { process.env.TZ = originalTZ; });
afterEach(() => vi.useRealTimers());

describe.each(ZONES)('date-fns as the app uses it (TZ %s)', (zone) => {
  beforeAll(() => { process.env.TZ = zone; });

  // 2026-03-07 19:05 local: a Saturday evening, the day before US clocks change.
  const evening = () => new Date(2026, 2, 7, 19, 5);

  it.each([
    ['MMM d, yyyy', 'Mar 7, 2026'],
    ['yyyy-MM-dd', '2026-03-07'],
    ['MMM d, h:mm a', 'Mar 7, 7:05 PM'],
    ['MMM d', 'Mar 7'],
    ['MMM dd', 'Mar 07'],
    ['MMM d, yyyy h:mm a', 'Mar 7, 2026 7:05 PM'],
    ['dd MMM yyyy HH:mm', '07 Mar 2026 19:05'],
    ['EEE, MMM d • h:mm a', 'Sat, Mar 7 • 7:05 PM'],
    ['EEE, MMM d · h:mm a', 'Sat, Mar 7 · 7:05 PM'],
    ['EEE MMM d, h:mm a', 'Sat Mar 7, 7:05 PM'],
    ['PPP', 'March 7th, 2026'],
    ['PPp', 'Mar 7, 2026, 7:05 PM'],
    ['PPPp', 'March 7th, 2026 at 7:05 PM'],
    ['PPP p', 'March 7th, 2026 7:05 PM'],
  ])('format(…, %j) → %j', (pattern, expected) => {
    expect(format(evening(), pattern)).toBe(expected);
  });

  it('format throws on an invalid date (callers catch it and show the raw value)', () => {
    expect(() => format(new Date('not a date'), 'MMM d')).toThrow(RangeError);
  });

  it('parseISO reads a date-only string as local midnight, and an offset as that instant', () => {
    const day = parseISO('2026-03-01');
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2026, 2, 1, 0]);
    expect(parseISO('2026-03-01T18:00:00Z').toISOString()).toBe('2026-03-01T18:00:00.000Z');
    expect(Number.isNaN(parseISO('nope').getTime())).toBe(true);
  });

  it('addDays/subDays keep the wall-clock time across the US clock change', () => {
    const next = addDays(evening(), 1);
    expect(format(next, 'yyyy-MM-dd HH:mm')).toBe('2026-03-08 19:05');
    expect(format(subDays(next, 7), 'yyyy-MM-dd HH:mm')).toBe('2026-03-01 19:05');
  });

  it('formatDistanceToNow with a suffix, as the activity feed and notifications show it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 7, 19, 5));
    expect(formatDistanceToNow(new Date(2026, 2, 7, 19, 0), { addSuffix: true })).toBe('5 minutes ago');
    expect(formatDistanceToNow(new Date(2026, 2, 6, 19, 5), { addSuffix: true })).toBe('1 day ago');
    expect(formatDistanceToNow(new Date(2026, 2, 7, 21, 5), { addSuffix: true })).toBe('in about 2 hours');
  });

  it('the calendar localizer (format, parse, startOfWeek, getDay with en-US)', () => {
    expect(startOfWeek(evening(), { locale: enUS }).getDate()).toBe(1); // Sunday Mar 1
    expect(getDay(evening())).toBe(6);
    const parsed = parse('03/07/2026', 'MM/dd/yyyy', new Date(2026, 0, 1), { locale: enUS });
    expect(format(parsed, 'yyyy-MM-dd')).toBe('2026-03-07');
    const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales: { 'en-US': enUS } });
    expect(localizer.format(evening(), 'MMM d', 'en-US')).toBe('Mar 7');
    expect(localizer.startOfWeek('en-US')).toBe(0);
  });

  it('calendar days (date columns) keep their day in every zone', () => {
    expect(formatDateOnly('2026-03-01')).toBe('Mar 1, 2026');
    expect(formatDateOnly('2026-03-01', 'yyyy-MM-dd')).toBe('2026-03-01');
    expect(formatDateOnly('')).toBe('');
    expect(parseDateOnly('2026-12-31')!.getDate()).toBe(31);
    expect(formatShort('2026-10-03')).toBe('Oct 3');
    expect(formatShort('2026-10-03T23:30:00Z')).toBe('Oct 3');
    expect(formatLong('2026-10-03')).toBe('Oct 3, 2026');
    expect(formatLong('bad')).toBe('bad');
  });

  it('a scan time reads in the local zone', () => {
    expect(formatScannedAt(new Date(2026, 2, 7, 19, 5).toISOString())).toBe('Mar 7, 2026 7:05 PM');
    expect(formatScannedAt(undefined)).toBe('—');
    expect(formatScannedAt('garbage')).toBe('garbage');
  });

  it('the activity log states a reschedule in local time', () => {
    const from = new Date(2026, 2, 7, 19, 5).toISOString();
    const to = new Date(2026, 2, 14, 20, 0).toISOString();
    expect(ACTIVITY_EVENTS['gig.rescheduled'].format({ from: { start: from }, to: { start: to } } as any))
      .toBe('Rescheduled from 07 Mar 2026 19:05 to 14 Mar 2026 20:00');
  });

  it('the gig list date filter (addDays/subDays from now)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 7, 12, 0));
    const at = (d: number) => ({ start: new Date(2026, 2, d, 20, 0).toISOString() });
    const gigs = [at(1), at(6), at(10), at(15)];
    expect(applyDateFilter(gigs, 'future-7', 'none')).toEqual([at(10)]);
    expect(applyDateFilter(gigs, 'none', 'past-7')).toEqual([at(1), at(6)]);
  });
});

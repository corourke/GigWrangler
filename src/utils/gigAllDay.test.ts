import { describe, it, expect } from 'vitest';
import {
  isGigAllDay,
  formatDateTimeDisplay,
  formatGigDay,
  formatGigDateTimeForDisplay,
  formatGigDateTimeForInput,
} from './dateUtils';
import { isGigPast } from './gigTimeframe';
import { estimateRateUnits } from './rateEstimate';
import { effectiveRange } from '../services/conflictDetection.service';
import { buildCalendarEvent } from '../../supabase/functions/server/lib/pure/calendarEvent';
import { validateGigRow } from './csvImport';
import { formatExportDate } from './gigExport';

// A12: whether a gig is all-day is its all_day flag, not a 12:00 UTC start. A timed gig that
// starts at 12:00 UTC (5 AM in Los Angeles, 2 AM next day in Kiritimati) is shown with its times.
const NOON = '2026-05-01T12:00:00.000Z';
const THREE_PM = '2026-05-01T15:00:00.000Z';

describe('isGigAllDay', () => {
  it('is the flag when the gig has one', () => {
    expect(isGigAllDay({ start: NOON, all_day: false })).toBe(false);
    expect(isGigAllDay({ start: '2026-05-01T20:00:00.000Z', all_day: true })).toBe(true);
  });

  it('falls back to the 12:00 UTC start for a gig loaded without the flag (an old cached copy)', () => {
    expect(isGigAllDay({ start: NOON })).toBe(true);
    expect(isGigAllDay({ start: THREE_PM })).toBe(false);
    expect(isGigAllDay({ start: NOON, all_day: null })).toBe(true);
  });
});

describe('display and input helpers take the flag', () => {
  it('a timed gig at 12:00 UTC shows its times', () => {
    expect(formatDateTimeDisplay(NOON, THREE_PM, 'UTC', false)).toMatch(/12:00 PM - 3:00 PM/);
    expect(formatDateTimeDisplay(NOON, NOON, 'UTC', false)).toMatch(/12:00 PM/);
    expect(formatGigDateTimeForDisplay(NOON, 'UTC', false)).toMatch(/12:00 PM/);
    expect(formatGigDateTimeForInput(NOON, 'UTC', false)).toBe('2026-05-01T12:00');
  });

  it('an all-day gig shows its dates only', () => {
    expect(formatDateTimeDisplay(NOON, '2026-05-03T12:00:00.000Z', 'Pacific/Kiritimati', true)).toBe('May 1, 2026 - May 3, 2026');
    expect(formatGigDateTimeForDisplay(NOON, 'Pacific/Kiritimati', true)).toBe('05/01/2026');
    expect(formatGigDateTimeForInput(NOON, 'Pacific/Kiritimati', true)).toBe('2026-05-01');
  });

  it("a timed gig's day is in its time zone; an all-day gig's day is its date", () => {
    expect(formatGigDay(NOON, 'Pacific/Kiritimati', false)).toBe('May 2, 2026');
    expect(formatGigDay(NOON, 'Pacific/Kiritimati', true)).toBe('May 1, 2026');
  });

  it('without the flag, the old rule holds', () => {
    expect(formatGigDateTimeForInput(NOON, 'UTC')).toBe('2026-05-01');
  });
});

describe('isGigPast', () => {
  it("a timed gig at 12:00 UTC ends on its local day", () => {
    // 12:00 UTC on May 1 is 02:00 on May 2 in Kiritimati (UTC+14); at 00:30 May 2 local it is not past.
    const now = new Date('2026-05-01T10:30:00.000Z');
    expect(isGigPast({ start: NOON, end: NOON, timezone: 'Pacific/Kiritimati', all_day: false }, now)).toBe(false);
    // As all-day, its day is May 1, which is over at that moment in Kiritimati.
    expect(isGigPast({ start: NOON, end: NOON, timezone: 'Pacific/Kiritimati', all_day: true }, now)).toBe(true);
  });
});

describe('estimateRateUnits', () => {
  it('counts the hours of a timed gig at 12:00 UTC', () => {
    expect(estimateRateUnits({ start: NOON, end: THREE_PM, timezone: 'UTC', all_day: false }, 'hour').units).toBe(3);
  });

  it('an all-day gig has no hours', () => {
    expect(estimateRateUnits({ start: NOON, end: NOON, timezone: 'UTC', all_day: true }, 'hour').label).toBe('1 hr (no times)');
  });
});

describe('conflict ranges', () => {
  it('a timed gig at 12:00 UTC covers exactly its times', () => {
    const r = effectiveRange(NOON, THREE_PM, 'America/Los_Angeles', false);
    expect(r.effectiveStart.toISOString()).toBe(NOON);
    expect(r.effectiveEnd.toISOString()).toBe(THREE_PM);
  });

  it('an all-day gig covers its whole local day', () => {
    const r = effectiveRange(NOON, NOON, 'America/Los_Angeles', true);
    expect(r.effectiveStart.toISOString()).toBe('2026-05-01T07:00:00.000Z');
  });
});

describe('Google Calendar event', () => {
  it('a timed gig at 12:00 UTC gets its times line', () => {
    const event = buildCalendarEvent({ title: 'Load in', start: NOON, end: THREE_PM, timezone: 'UTC', all_day: false }, null, 'https://x.test/gigs/1');
    expect(event.description.split('\n')[0]).toMatch(/12:00 PM/);
  });

  it('an all-day gig has none', () => {
    const event = buildCalendarEvent({ title: 'Festival', start: NOON, end: NOON, timezone: 'UTC', all_day: true }, null, 'https://x.test/gigs/1');
    expect(event.description).not.toMatch(/PM|AM/);
    expect(event.start).toEqual({ date: '2026-05-01' });
  });
});

describe('CSV import all_day', () => {
  const base = { title: 'Show', status: 'Booked', timezone: 'America/Los_Angeles' };

  it('with no all_day column, a date-only gig is all-day and a timed one is not (as before)', () => {
    expect(validateGigRow({ ...base, start: '2026-05-01' }, 0).data.all_day).toBe(true);
    expect(validateGigRow({ ...base, start: '2026-05-01T20:00', end: '2026-05-01T23:00' }, 0).data.all_day).toBe(false);
  });

  it('all_day yes makes it all-day', () => {
    const row = validateGigRow({ ...base, start: '2026-05-01', end: '2026-05-02', all_day: 'yes' }, 0);
    expect(row.errors).toEqual([]);
    expect(row.data.all_day).toBe(true);
  });

  it('all_day no with a date-only start is an error: a timed gig needs a time', () => {
    const row = validateGigRow({ ...base, start: '2026-05-01', all_day: 'no' }, 0);
    expect(row.errors.map((e) => e.field)).toContain('all_day');
  });

  it('an unknown all_day value is an error', () => {
    const row = validateGigRow({ ...base, start: '2026-05-01', all_day: 'maybe' }, 0);
    expect(row.errors.map((e) => e.field)).toContain('all_day');
  });
});

describe('CSV export dates', () => {
  it("an all-day gig exports its date, not the time-zone shifted one", () => {
    expect(formatExportDate(NOON, 'Pacific/Kiritimati', true)).toBe('2026-05-01');
    expect(formatExportDate(NOON, 'Pacific/Kiritimati', false)).toBe('2026-05-02');
  });
});

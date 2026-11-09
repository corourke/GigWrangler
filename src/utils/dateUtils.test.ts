import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  isNoonUTC,
  formatGigDay,
  formatInTimeZone,
  formatDateTimeDisplay,
  parseLocalToUTC,
  formatForDateTimeInput,
  formatGigDateTimeForDisplay,
  formatGigDateTimeForInput,
  parseGigDateTimeFromInput,
  toDateInTimeZone,
  formatGigCardWhen,
  gigStartDay,
} from './dateUtils';

describe('isNoonUTC', () => {
  it('detects ISO noon UTC format', () => {
    expect(isNoonUTC('2026-02-27T12:00:00.000Z')).toBe(true);
  });

  it('detects PostgreSQL noon UTC format', () => {
    expect(isNoonUTC('2026-02-27 12:00:00+00')).toBe(true);
  });

  it('returns false for midnight UTC', () => {
    expect(isNoonUTC('2026-02-27T00:00:00.000Z')).toBe(false);
  });

  it('returns false for arbitrary times', () => {
    expect(isNoonUTC('2026-02-27T08:30:00.000Z')).toBe(false);
  });

  it('returns false for 1pm UTC (not noon)', () => {
    expect(isNoonUTC('2026-02-27T13:00:00.000Z')).toBe(false);
  });
});

describe('formatInTimeZone', () => {
  it('formats a date in Eastern time (UTC-5 in January)', () => {
    // 8 PM UTC = 3 PM EST
    const result = formatInTimeZone('2026-01-15T20:00:00.000Z', 'America/New_York', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    expect(result).toContain('3:00');
    expect(result.toLowerCase()).toContain('pm');
  });

  it('returns empty string for falsy input', () => {
    expect(formatInTimeZone('', 'America/New_York')).toBe('');
  });

  it('falls back gracefully for an invalid timezone without throwing', () => {
    expect(() =>
      formatInTimeZone('2026-01-15T20:00:00.000Z', 'Not/ATimezone', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    ).not.toThrow();
  });

  it('returns original string for an unparseable date string', () => {
    expect(formatInTimeZone('not-a-date', 'America/New_York')).toBe('not-a-date');
  });

  it('uses browser-local time when timezone is undefined', () => {
    // Should not throw; result is environment-dependent but should be a non-empty string
    const result = formatInTimeZone('2026-01-15T12:00:00.000Z', undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatDateTimeDisplay', () => {
  it('shows a single date for date-only entries where start equals end', () => {
    const result = formatDateTimeDisplay(
      '2026-03-15T12:00:00.000Z',
      '2026-03-15T12:00:00.000Z'
    );
    expect(result).toBe('Mar 15, 2026');
  });

  it('shows a date range for multi-day date-only entries', () => {
    const result = formatDateTimeDisplay(
      '2026-03-15T12:00:00.000Z',
      '2026-03-17T12:00:00.000Z'
    );
    expect(result).toBe('Mar 15, 2026 - Mar 17, 2026');
  });

  it('shows date with start-end time for sub-24h gig (same calendar day)', () => {
    // 8 PM UTC to 11 PM UTC, timezone UTC
    const result = formatDateTimeDisplay(
      '2026-03-15T20:00:00.000Z',
      '2026-03-15T23:00:00.000Z',
      'UTC'
    );
    expect(result).toContain('Mar 15, 2026');
    expect(result).toContain('8:00 PM');
    expect(result).toContain('11:00 PM');
  });

  it('shows start date with time range for sub-24h gig crossing midnight', () => {
    // 10 PM UTC to 2 AM UTC the next day (< 24h)
    const result = formatDateTimeDisplay(
      '2026-03-15T22:00:00.000Z',
      '2026-03-16T02:00:00.000Z',
      'UTC'
    );
    expect(result).toContain('Mar 15, 2026');
    expect(result).toContain('10:00 PM');
    expect(result).toContain('2:00 AM');
    // Should NOT show the end date separately for a sub-24h gig
    expect(result).not.toMatch(/Mar 16, 2026.*Mar 16, 2026/);
  });

  it('shows full date range for gigs >= 24 hours', () => {
    // 8 PM UTC Mar 15 to 2 AM UTC Mar 17 (30h)
    const result = formatDateTimeDisplay(
      '2026-03-15T20:00:00.000Z',
      '2026-03-17T02:00:00.000Z',
      'UTC'
    );
    expect(result).toContain('Mar 15, 2026');
    expect(result).toContain('Mar 17, 2026');
  });

  it('returns empty string for falsy start', () => {
    expect(formatDateTimeDisplay('', '2026-03-15T12:00:00.000Z')).toBe('');
  });

  it('handles identical start and end times (point-in-time gig)', () => {
    const t = '2026-03-15T20:00:00.000Z';
    const result = formatDateTimeDisplay(t, t, 'UTC');
    expect(result).toContain('Mar 15, 2026');
    expect(result).toContain('8:00 PM');
  });
});

describe('parseLocalToUTC', () => {
  it('returns empty string for empty input', () => {
    expect(parseLocalToUTC('', 'America/New_York')).toBe('');
  });

  it('returns an ISO string when no timezone is provided', () => {
    const result = parseLocalToUTC('2026-03-15T12:00', undefined);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('converts Eastern Standard Time (UTC-5) correctly', () => {
    // January is always EST (UTC-5, before DST). Noon ET = 5 PM UTC.
    const result = parseLocalToUTC('2026-01-15T12:00', 'America/New_York');
    expect(result).toBe('2026-01-15T17:00:00.000Z');
  });

  it('converts Tokyo time (UTC+9) correctly', () => {
    // Tokyo is always UTC+9. Noon Tokyo = 3 AM UTC.
    const result = parseLocalToUTC('2026-03-15T12:00', 'Asia/Tokyo');
    expect(result).toBe('2026-03-15T03:00:00.000Z');
  });

  it('round-trips: parseLocalToUTC then formatForDateTimeInput returns original value', () => {
    const localInput = '2026-06-20T14:30';
    const timezone = 'America/Chicago';
    const utc = parseLocalToUTC(localInput, timezone);
    const backToLocal = formatForDateTimeInput(utc, timezone);
    expect(backToLocal).toBe(localInput);
  });
});

describe('formatForDateTimeInput', () => {
  it('formats a UTC date into datetime-local format in Eastern time', () => {
    // January is always EST (UTC-5). 5 PM UTC = noon EST.
    const result = formatForDateTimeInput('2026-01-15T17:00:00.000Z', 'America/New_York');
    expect(result).toBe('2026-01-15T12:00');
  });

  it('returns empty string for empty input', () => {
    expect(formatForDateTimeInput('', 'America/New_York')).toBe('');
  });

  it('returns empty string for an invalid date string', () => {
    expect(formatForDateTimeInput('not-a-date', 'America/New_York')).toBe('');
  });

  it('does not throw for an invalid timezone (falls back to browser local)', () => {
    expect(() =>
      formatForDateTimeInput('2026-03-15T17:00:00.000Z', 'Invalid/TZ')
    ).not.toThrow();
  });
});

describe('formatGigDateTimeForDisplay', () => {
  it('returns empty string for empty input', () => {
    expect(formatGigDateTimeForDisplay('')).toBe('');
  });

  it('formats date-only entries (noon UTC) as MM/DD/YYYY', () => {
    expect(formatGigDateTimeForDisplay('2026-03-15T12:00:00.000Z')).toBe('03/15/2026');
  });

  it('formats PostgreSQL noon UTC as date-only', () => {
    expect(formatGigDateTimeForDisplay('2026-03-15 12:00:00+00')).toBe('03/15/2026');
  });

  it('formats timed entries with date and time in UTC', () => {
    const result = formatGigDateTimeForDisplay('2026-03-15T20:00:00.000Z', 'UTC');
    expect(result).toContain('03/15/2026');
    expect(result).toContain('08:00 PM');
  });
});

describe('formatGigDateTimeForInput', () => {
  it('returns empty string for empty input', () => {
    expect(formatGigDateTimeForInput('')).toBe('');
  });

  it('extracts YYYY-MM-DD for date-only entries (noon UTC)', () => {
    expect(formatGigDateTimeForInput('2026-03-15T12:00:00.000Z')).toBe('2026-03-15');
  });

  it('formats timed entries as datetime-local in the given timezone', () => {
    // January is always EST (UTC-5). 5 PM UTC = noon EST.
    const result = formatGigDateTimeForInput('2026-01-15T17:00:00.000Z', 'America/New_York');
    expect(result).toBe('2026-01-15T12:00');
  });

  it('accepts a Date object', () => {
    const date = new Date('2026-03-15T12:00:00.000Z');
    expect(formatGigDateTimeForInput(date)).toBe('2026-03-15');
  });
});

describe('parseGigDateTimeFromInput', () => {
  it('returns empty string for empty input', () => {
    expect(parseGigDateTimeFromInput('')).toBe('');
  });

  it('converts a date-only string (YYYY-MM-DD) to noon UTC', () => {
    expect(parseGigDateTimeFromInput('2026-03-15')).toBe('2026-03-15T12:00:00.000Z');
  });

  it('treats datetime input as date-only when isDateOnly flag is true', () => {
    expect(parseGigDateTimeFromInput('2026-03-15', undefined, true)).toBe(
      '2026-03-15T12:00:00.000Z'
    );
  });

  it('converts a datetime-local input using the provided timezone', () => {
    // January is always EST (UTC-5). Noon ET = 5 PM UTC.
    const result = parseGigDateTimeFromInput('2026-01-15T12:00', 'America/New_York');
    expect(result).toBe('2026-01-15T17:00:00.000Z');
  });

  it('round-trips with formatGigDateTimeForInput', () => {
    const original = '2026-06-20T14:30';
    const timezone = 'America/Chicago';
    // Parse to UTC
    const utc = parseGigDateTimeFromInput(original, timezone);
    // Format back to local input
    const backToLocal = formatGigDateTimeForInput(utc, timezone);
    expect(backToLocal).toBe(original);
  });
});

describe('toDateInTimeZone (#93)', () => {
  // 8 PM Pacific (PDT) on March 14 is 03:00 UTC on March 15.
  const eightPmPacific = '2026-03-15T03:00:00.000Z';

  it('gives the calendar date in the given time zone, not the UTC date', () => {
    expect(toDateInTimeZone(eightPmPacific, 'America/Los_Angeles')).toBe('2026-03-14');
    expect(toDateInTimeZone(eightPmPacific, 'UTC')).toBe('2026-03-15');
    expect(toDateInTimeZone(new Date(eightPmPacific), 'Asia/Tokyo')).toBe('2026-03-15');
  });

  it('keeps 6 PM Pacific on the last day of the month in that month', () => {
    expect(toDateInTimeZone('2026-04-01T01:00:00.000Z', 'America/Los_Angeles')).toBe('2026-03-31');
  });

  it('keeps a date-only gig (noon UTC) on its own day', () => {
    expect(toDateInTimeZone('2026-03-14T12:00:00.000Z', 'America/Los_Angeles')).toBe('2026-03-14');
    expect(toDateInTimeZone('2026-03-14T12:00:00.000Z', 'Pacific/Auckland')).toBe('2026-03-15');
  });

  it('uses the local date when there is no time zone or it is invalid', () => {
    const d = new Date(eightPmPacific);
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(toDateInTimeZone(d)).toBe(local);
    expect(toDateInTimeZone(d, null)).toBe(local);
    expect(toDateInTimeZone(d, 'Not/AZone')).toBe(local);
  });
});

describe('formatGigDay (#230 follow-up)', () => {
  it('a date-only gig (noon UTC) is its calendar date in any time zone', () => {
    expect(formatGigDay('2026-10-10T12:00:00.000Z', 'Pacific/Auckland')).toBe('Oct 10, 2026');
    expect(formatGigDay('2026-10-10T12:00:00.000Z', 'Pacific/Honolulu')).toBe('Oct 10, 2026');
  });

  it('a timed gig is the day it starts in its time zone', () => {
    expect(formatGigDay('2026-10-11T03:00:00Z', 'America/Los_Angeles')).toBe('Oct 10, 2026');
  });
});

// Round B: mobile gig cards read a gig's day and time in the gig's own zone, not the device's.
describe.each(['America/Los_Angeles', 'Pacific/Kiritimati'])('mobile gig card dates (device TZ %s)', (zone) => {
  let originalTZ: string | undefined;
  beforeAll(() => { originalTZ = process.env.TZ; process.env.TZ = zone; });
  afterAll(() => { process.env.TZ = originalTZ; });

  const allDay = { start: '2026-12-05T12:00:00.000Z', timezone: 'America/New_York', all_day: true };
  // 8:00 PM on Saturday Dec 5 in New York (01:00 UTC on the 6th).
  const timed = { start: '2026-12-06T01:00:00.000Z', timezone: 'America/New_York', all_day: false };

  it('an all-day gig shows its date only', () => {
    expect(formatGigCardWhen(allDay)).toBe('Sat, Dec 5');
  });

  it("a timed gig shows its day and time in the gig's time zone", () => {
    expect(formatGigCardWhen(timed)).toMatch(/^Sat, Dec 5 · 8:00\sPM$/);
    expect(formatGigCardWhen(timed, '•')).toMatch(/^Sat, Dec 5 • 8:00\sPM$/);
  });

  it("a gig without all_day falls back to the 12:00 UTC convention", () => {
    expect(formatGigCardWhen({ start: allDay.start, timezone: 'America/New_York' })).toBe('Sat, Dec 5');
  });

  it("gigStartDay is the gig's own calendar day", () => {
    expect(gigStartDay(allDay)).toBe('2026-12-05');
    expect(gigStartDay(timed)).toBe('2026-12-05');
  });
});

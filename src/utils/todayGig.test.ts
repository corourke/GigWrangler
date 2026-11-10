import { describe, it, expect } from 'vitest';
import { pickTodayGigs, type TodayGigLike } from './todayGig';

const gig = (over: Partial<TodayGigLike> & { id: string }): TodayGigLike => ({
  title: over.id,
  start: '2026-11-10T20:00:00.000Z',
  end: '2026-11-10T23:00:00.000Z',
  timezone: 'America/Los_Angeles',
  all_day: false,
  status: 'Booked',
  ...over,
});

describe('pickTodayGigs', () => {
  it('picks a gig later today in its own time zone', () => {
    const now = new Date('2026-11-10T17:00:00Z'); // 9 AM in Los Angeles
    const { today, next } = pickTodayGigs([gig({ id: 'a' })], now);
    expect(today.map((g) => g.id)).toEqual(['a']);
    expect(next).toBeNull();
  });

  it("uses the gig's day, not the UTC day, for a late-evening gig", () => {
    // 11:30 PM Nov 9 in Los Angeles is Nov 10 in UTC.
    const late = gig({ id: 'late', start: '2026-11-10T07:30:00Z', end: '2026-11-10T09:00:00Z' });
    const now = new Date('2026-11-10T02:00:00Z'); // 6 PM Nov 9 in Los Angeles
    expect(pickTodayGigs([late], now).today.map((g) => g.id)).toEqual(['late']);
  });

  it('does not count a gig tomorrow (in its zone) as today, but offers it as next', () => {
    const tomorrow = gig({ id: 't', start: '2026-11-11T20:00:00Z', end: '2026-11-11T23:00:00Z' });
    const now = new Date('2026-11-10T17:00:00Z');
    const { today, next } = pickTodayGigs([tomorrow], now);
    expect(today).toEqual([]);
    expect(next?.id).toBe('t');
  });

  it('counts a multi-day gig that is in progress', () => {
    const fest = gig({ id: 'fest', start: '2026-11-08T18:00:00Z', end: '2026-11-12T06:00:00Z' });
    const now = new Date('2026-11-10T17:00:00Z');
    expect(pickTodayGigs([fest], now).today.map((g) => g.id)).toEqual(['fest']);
  });

  it('leaves out a gig that already ended earlier today', () => {
    const morning = gig({ id: 'm', start: '2026-11-10T16:00:00Z', end: '2026-11-10T18:00:00Z' });
    const now = new Date('2026-11-10T20:00:00Z');
    const { today, next } = pickTodayGigs([morning], now);
    expect(today).toEqual([]);
    expect(next).toBeNull();
  });

  it('counts an all-day gig on its calendar date, whatever the hour', () => {
    const allDay = gig({ id: 'ad', start: '2026-11-10T12:00:00.000Z', end: '2026-11-10T12:00:00.000Z', all_day: true });
    // 11 PM Nov 10 in Los Angeles: past noon UTC and past the stored "end".
    const now = new Date('2026-11-11T07:00:00Z');
    expect(pickTodayGigs([allDay], now).today.map((g) => g.id)).toEqual(['ad']);
  });

  it('counts a multi-day all-day gig on its middle day', () => {
    const run = gig({ id: 'run', start: '2026-11-09T12:00:00.000Z', end: '2026-11-11T12:00:00.000Z', all_day: true });
    const now = new Date('2026-11-10T20:00:00Z');
    expect(pickTodayGigs([run], now).today.map((g) => g.id)).toEqual(['run']);
  });

  it('skips cancelled gigs', () => {
    const now = new Date('2026-11-10T17:00:00Z');
    const { today, next } = pickTodayGigs([gig({ id: 'c', status: 'Cancelled' })], now);
    expect(today).toEqual([]);
    expect(next).toBeNull();
  });

  it('lists several gigs today, the one in progress first, then by start', () => {
    const now = new Date('2026-11-10T19:00:00Z');
    const evening = gig({ id: 'evening', start: '2026-11-11T03:00:00Z', end: '2026-11-11T06:00:00Z' });
    const afternoon = gig({ id: 'afternoon', start: '2026-11-10T21:00:00Z', end: '2026-11-10T23:00:00Z' });
    const now_on = gig({ id: 'now', start: '2026-11-10T18:00:00Z', end: '2026-11-10T20:00:00Z' });
    expect(pickTodayGigs([evening, afternoon, now_on], now).today.map((g) => g.id)).toEqual(['now', 'afternoon', 'evening']);
  });

  it('offers the earliest upcoming gig as next when none is today', () => {
    const now = new Date('2026-11-10T17:00:00Z');
    const later = gig({ id: 'later', start: '2026-11-14T20:00:00Z', end: '2026-11-14T23:00:00Z' });
    const sooner = gig({ id: 'sooner', start: '2026-11-12T20:00:00Z', end: '2026-11-12T23:00:00Z' });
    expect(pickTodayGigs([later, sooner], now).next?.id).toBe('sooner');
  });

  it('removes duplicates of the same gig (two assignments on one gig)', () => {
    const now = new Date('2026-11-10T17:00:00Z');
    expect(pickTodayGigs([gig({ id: 'a' }), gig({ id: 'a' })], now).today).toHaveLength(1);
  });
});

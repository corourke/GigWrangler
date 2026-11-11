import { describe, it, expect } from 'vitest';
import { isPendingInvite, openCrewSpots, paymentsDue, receiptsToReview, UNPAID_STAGES, gigsThisWeek, equipmentConflicts } from './needsYou';

// Plan #445 (A2b): the definitions of Today's "Needs you" counts.
const NOW = new Date('2026-11-10T17:00:00Z');
const gig = (start: string, status = 'Booked', end = start) => ({ id: start, title: 't', start, end, status });

describe('isPendingInvite', () => {
  it('is a Requested or Invited assignment on a gig not over and not cancelled', () => {
    expect(isPendingInvite({ status: 'Requested', gig: gig('2026-11-12T20:00:00Z') }, NOW)).toBe(true);
    expect(isPendingInvite({ status: 'Invited', gig: gig('2026-11-12T20:00:00Z') }, NOW)).toBe(true);
    expect(isPendingInvite({ status: 'Confirmed', gig: gig('2026-11-12T20:00:00Z') }, NOW)).toBe(false);
    expect(isPendingInvite({ status: 'Declined', gig: gig('2026-11-12T20:00:00Z') }, NOW)).toBe(false);
    expect(isPendingInvite({ status: 'Requested', gig: gig('2026-11-12T20:00:00Z', 'Cancelled') }, NOW)).toBe(false);
    expect(isPendingInvite({ status: 'Requested', gig: gig('2026-11-09T20:00:00Z', 'Booked', '2026-11-09T23:00:00Z') }, NOW)).toBe(false);
    // Still on until it ends.
    expect(isPendingInvite({ status: 'Requested', gig: gig('2026-11-10T15:00:00Z', 'Booked', '2026-11-10T22:00:00Z') }, NOW)).toBe(true);
  });
});

describe('openCrewSpots', () => {
  const slot = (start: string, required: number, statuses: string[], status = 'Booked') =>
    ({ required_count: required, gig: gig(start, status), assignments: statuses.map((s) => ({ status: s })) });

  it('counts spots not taken by a Requested, Invited or Confirmed person, on gigs in the next 14 days', () => {
    const result = openCrewSpots([
      slot('2026-11-12T20:00:00Z', 3, ['Confirmed', 'Declined']), // 2 open: declined doesn't fill
      slot('2026-11-12T20:00:00Z', 1, ['Requested']), // full
      slot('2026-11-20T20:00:00Z', 2, ['Invited']), // 1 open
      slot('2026-11-25T20:00:00Z', 2, []), // past 14 days: not counted
      slot('2026-11-13T20:00:00Z', 2, [], 'Cancelled'), // cancelled
      slot('2026-11-09T20:00:00Z', 2, []), // already started
    ], NOW);
    expect(result.spots).toBe(3);
    expect(result.gigs.map((g) => [g.gig.start, g.open])).toEqual([['2026-11-12T20:00:00Z', 2], ['2026-11-20T20:00:00Z', 1]]);
  });

  it('never counts a slot as less than full', () => {
    expect(openCrewSpots([slot('2026-11-12T20:00:00Z', 1, ['Confirmed', 'Confirmed'])], NOW).spots).toBe(0);
  });
});

describe('paymentsDue', () => {
  const line = (due_date: string | null, stage: string) => ({ due_date, stage });
  it('counts unpaid lines due today and overdue', () => {
    const today = '2026-11-10';
    expect(paymentsDue([
      line('2026-11-10', 'invoiced'),
      line('2026-11-09', 'contracted'),
      line('2026-10-01', 'contract_sent'),
      line('2026-11-10', 'accepted'),
      line('2026-11-10', 'paid'),
      line('2026-11-11', 'invoiced'),
      line(null, 'invoiced'),
      line('2026-11-01', 'quoted'),
    ], today)).toEqual({ due: 2, overdue: 2 });
  });

  it('uses the same unpaid stages as the payment reminders', () => {
    expect([...UNPAID_STAGES]).toEqual(['accepted', 'contract_sent', 'contracted', 'invoiced']);
  });
});

describe('receiptsToReview', () => {
  it('counts what is still in the scan queue', () => {
    expect(receiptsToReview([{ status: 'queued' }, { status: 'scanning' }, { status: 'ready' }, { status: 'failed' }])).toBe(4);
    expect(receiptsToReview([])).toBe(0);
  });
});

// Plan #445 (A2c): equipment conflicts this week.
describe('gigsThisWeek', () => {
  const g = (id: string, start: string, end: string | null = start, status = 'Booked') => ({ id, title: id, start, end, status });
  it('keeps gigs that have not ended and start within 7 days, not cancelled', () => {
    const out = gigsThisWeek([
      g('now', '2026-11-10T15:00:00Z', '2026-11-10T22:00:00Z'),
      g('soon', '2026-11-14T20:00:00Z'),
      g('far', '2026-11-20T20:00:00Z'),
      g('over', '2026-11-09T20:00:00Z', '2026-11-09T23:00:00Z'),
      g('cancelled', '2026-11-12T20:00:00Z', '2026-11-12T23:00:00Z', 'Cancelled'),
    ], NOW);
    expect(out.map((x) => x.id)).toEqual(['now', 'soon']);
  });
});

describe('equipmentConflicts', () => {
  const c = (gig_id: string, other: string, type = 'equipment', level = 'conflict') =>
    ({ level, type, gig_id, gig_title: `Gig ${gig_id}`, start: gig_id === 'a' ? '2026-11-12T20:00:00Z' : '2026-11-13T20:00:00Z', end: '', details: { other_gig_id: other, other_gig_title: `Gig ${other}` } }) as any;

  it('counts the gigs with an equipment conflict, each once, soonest first, naming what they clash with', () => {
    const result = equipmentConflicts([c('b', 'a'), c('a', 'b'), c('a', 'c'), c('c', 'a')]);
    expect(result.count).toBe(3);
    expect(result.gigs.map((x) => x.gigId)).toEqual(['a', 'b', 'c']);
    expect(result.gigs[0]).toMatchObject({ gigId: 'a', others: ['Gig b', 'Gig c'] });
  });

  it('leaves out staff and venue conflicts and warnings', () => {
    expect(equipmentConflicts([c('a', 'b', 'staff'), c('a', 'b', 'venue'), c('a', 'b', 'equipment', 'warning')]).count).toBe(0);
  });
});

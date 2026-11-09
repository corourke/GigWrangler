import { describe, it, expect } from 'vitest';
import type { GigAccountingSummary } from './supabase/types';
import { classifyGig, gigStatusText, inTimeframe, owedToYou, timeframeRange } from './gigAccountingSections';

const now = new Date(2026, 9, 5, 12, 0); // Oct 5, 2026, local noon

const gig = (o: Partial<GigAccountingSummary>): GigAccountingSummary => ({
  gigId: 'g',
  gigTitle: 'G',
  gigStatus: 'Completed',
  gigStart: '2026-10-03T19:00:00Z',
  gigEnd: '2026-10-03T23:00:00Z',
  contractAmount: 1000,
  received: 0,
  outstandingRevenue: 1000,
  dueRevenue: 1000,
  actualCosts: 0,
  expectedStaffCosts: 0,
  expectedSubContractCosts: 0,
  totalCosts: 0,
  paymentsToMake: 0,
  paymentsDue: 0,
  profit: 1000,
  margin: 100,
  paymentHealth: 'revenue-outstanding',
  moneyInBadge: { label: 'Payment due', tone: 'attention' },
  ...o,
});

describe('classifyGig', () => {
  it('puts a played, unpaid gig in Needs attention (St. Raymond)', () => {
    expect(classifyGig(gig({}), now)).toBe('needs-attention');
  });

  it('puts a gig in Needs attention when you owe money now', () => {
    expect(classifyGig(gig({ outstandingRevenue: 0, dueRevenue: 0, paymentsToMake: 200, paymentsDue: 200 }), now)).toBe('needs-attention');
  });

  it('puts an invoice not yet due in Upcoming, even after the gig (Computer History Museum)', () => {
    expect(classifyGig(gig({ dueRevenue: 0, moneyInBadge: { label: 'Invoiced, due Oct 26', tone: 'pending' } }), now)).toBe('upcoming');
  });

  it('puts a future booked gig in Upcoming', () => {
    expect(classifyGig(gig({ gigStatus: 'Booked', gigStart: '2026-12-04T20:00:00Z', gigEnd: '2026-12-05T00:00:00Z', dueRevenue: 0 }), now)).toBe('upcoming');
  });

  it('puts a played gig with nothing outstanding in Settled', () => {
    expect(classifyGig(gig({ gigStatus: 'Settled', received: 1000, outstandingRevenue: 0, dueRevenue: 0 }), now)).toBe('settled');
  });

  it('flags a completed gig with no money in recorded', () => {
    expect(classifyGig(gig({ contractAmount: 0, outstandingRevenue: 0, dueRevenue: 0, moneyInBadge: null }), now)).toBe('needs-attention');
  });

  it('leaves out a cancelled gig where nothing moved (Cheeseballs Sep 6)', () => {
    expect(classifyGig(gig({ gigStatus: 'Cancelled', contractAmount: 0, outstandingRevenue: 0, dueRevenue: 0, profit: 0 }), now)).toBeNull();
  });

  it('keeps a cancelled gig that still has money owed', () => {
    expect(classifyGig(gig({ gigStatus: 'Cancelled', contractAmount: 0, outstandingRevenue: 0, dueRevenue: 0, paymentsToMake: 150, paymentsDue: 150 }), now)).toBe('needs-attention');
  });
});

describe('gigStatusText', () => {
  it('combines the money-in badge with what you owe', () => {
    expect(gigStatusText(gig({ paymentsToMake: 600 }))).toBe('Payment due · You owe $600');
    expect(gigStatusText(gig({ paymentsToMake: 200, paymentsDue: 200 }))).toBe('Payment due · You owe $200 now');
  });
  it('says when a completed gig has no money in', () => {
    expect(gigStatusText(gig({ contractAmount: 0, moneyInBadge: null }))).toBe('No money in recorded');
  });
});

describe('timeframes', () => {
  it('turns presets into inclusive date ranges', () => {
    expect(timeframeRange('this-year', now)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(timeframeRange('last-year', now)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(timeframeRange('last-30', now)).toEqual({ from: '2026-09-05', to: '2026-10-05' });
    expect(timeframeRange('all', now)).toEqual({ from: '', to: '' });
    expect(timeframeRange('custom', now, { from: '2026-06-01', to: '' })).toEqual({ from: '2026-06-01', to: '' });
  });

  it('filters on the gig start date', () => {
    // 7pm local on Oct 3: the filter reads the start as a local calendar date, so build it locally
    // (19:00Z is already Oct 4 east of UTC+5).
    const g = gig({ gigStart: new Date(2026, 9, 3, 19, 0).toISOString() });
    expect(inTimeframe(g, { from: '2026-10-01', to: '2026-10-31' })).toBe(true);
    expect(inTimeframe(g, { from: '2026-10-04', to: '' })).toBe(false);
    expect(inTimeframe(g, { from: '', to: '' })).toBe(true);
  });
});

describe('owedToYou (Cameron, 10-08)', () => {
  const base = { outstandingRevenue: 1200 };
  it('is what is still owed on a Completed or Settled gig', () => {
    expect(owedToYou({ ...base, gigStatus: 'Completed' })).toBe(1200);
    expect(owedToYou({ ...base, gigStatus: 'Settled' })).toBe(1200);
  });
  it("is nothing on a gig that hasn't been completed", () => {
    for (const gigStatus of ['DateHold', 'Proposed', 'Booked', 'Cancelled'] as const) {
      expect(owedToYou({ ...base, gigStatus })).toBe(0);
    }
  });
});

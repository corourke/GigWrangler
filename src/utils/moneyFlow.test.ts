import { describe, it, expect } from 'vitest';
import {
  expectedAmount,
  isDue,
  moneyInBadge,
  nextStage,
  outstandingAmount,
  settledAmount,
  stageLabel,
  stagePickerLabel,
  stagesFor,
  summarizeMoney,
  type MoneyRow,
} from './moneyFlow';

const now = new Date(2026, 9, 4, 12, 0); // Oct 4, 2026, local noon

const row = (r: Partial<MoneyRow>): MoneyRow => ({
  direction: 'in',
  stage: 'accepted',
  amount: 100,
  amount_settled: null,
  due_date: null,
  paid_at: null,
  ...r,
});

describe('moneyFlow', () => {
  it('counts quoted, declined and cancelled rows toward nothing', () => {
    for (const stage of ['requested', 'quoted', 'declined', 'cancelled'] as const) {
      const r = row({ stage, amount: 500 });
      expect(expectedAmount(r)).toBe(0);
      expect(outstandingAmount(r)).toBe(0);
      expect(settledAmount(r)).toBe(0);
    }
  });

  it('counts a paid row at what actually moved (overpaid fee)', () => {
    const r = row({ stage: 'paid', amount: 300, amount_settled: 450, paid_at: '2026-06-04' });
    expect(expectedAmount(r)).toBe(450);
    expect(settledAmount(r)).toBe(450);
    expect(outstandingAmount(r)).toBe(0);
  });

  it('treats an accepted fee with no due date as due once the gig is over', () => {
    const fee = row({ stage: 'accepted', amount: 1000 });
    expect(isDue(fee, '2026-10-03T20:00:00Z', now)).toBe(true);
    expect(isDue(fee, '2026-12-04T20:00:00Z', now)).toBe(false);
  });

  it('lets an invoice due date win over the gig being over', () => {
    const invoice = row({ stage: 'invoiced', amount: 750, due_date: '2026-10-26' });
    expect(isDue(invoice, '2026-09-17T22:00:00Z', now)).toBe(false);
    expect(isDue(invoice, '2026-09-17T22:00:00Z', new Date(2026, 9, 26, 9))).toBe(true);
  });

  it('summarizes St. Raymond: $1,000 owed and due, $279.52 paid out', () => {
    const rows: MoneyRow[] = [
      row({ stage: 'accepted', amount: 1000 }),
      row({ direction: 'out', stage: 'paid', amount: 200, amount_settled: 200 }),
      row({ direction: 'out', stage: 'paid', amount: 78.02, amount_settled: 78.02 }),
      row({ direction: 'out', stage: 'paid', amount: '1.50', amount_settled: '1.50' }),
    ];
    const s = summarizeMoney(rows, '2026-10-03T20:00:00Z', now);
    expect(s.expectedIn).toBe(1000);
    expect(s.receivedIn).toBe(0);
    expect(s.outstandingIn).toBe(1000);
    expect(s.dueIn).toBe(1000);
    expect(s.paidOut).toBeCloseTo(279.52);
    expect(s.net).toBeCloseTo(720.48);
  });

  it('counts an owed sub-contractor as expected and outstanding, a declined bid not at all', () => {
    const rows: MoneyRow[] = [
      row({ direction: 'out', stage: 'invoiced', amount: 600, due_date: '2026-12-20' }),
      row({ direction: 'out', stage: 'declined', amount: 850 }),
    ];
    const s = summarizeMoney(rows, '2026-12-10T20:00:00Z', now);
    expect(s.expectedOut).toBe(600);
    expect(s.outstandingOut).toBe(600);
    expect(s.dueOut).toBe(0);
  });

  describe('moneyInBadge', () => {
    it('is null without money in', () => {
      expect(moneyInBadge([row({ direction: 'out', stage: 'paid', amount_settled: 5 })], null, now)).toBeNull();
    });
    it('says payment due when the gig is over and unpaid', () => {
      expect(moneyInBadge([row({ stage: 'accepted' })], '2026-10-03T20:00:00Z', now))
        .toEqual({ label: 'Payment due', tone: 'attention' });
    });
    it('says overdue once a due date has passed', () => {
      expect(moneyInBadge([row({ stage: 'invoiced', due_date: '2026-10-01' })], '2026-09-01T20:00:00Z', now))
        .toEqual({ label: 'Overdue', tone: 'attention' });
    });
    it('shows the least advanced unpaid row with its due date', () => {
      const badge = moneyInBadge(
        [
          row({ stage: 'paid', amount_settled: 500 }),
          row({ stage: 'invoiced', due_date: '2027-01-09' }),
        ],
        '2027-01-20T20:00:00Z',
        now,
      );
      expect(badge?.tone).toBe('pending');
      expect(badge?.label).toMatch(/^Invoiced, due /);
    });
    it('says paid when everything committed is paid', () => {
      expect(moneyInBadge([row({ stage: 'paid', amount_settled: 100 })], null, now))
        .toEqual({ label: 'Paid', tone: 'done' });
    });
  });

  it('names informal agreements in the money-in stage picker', () => {
    expect(stagePickerLabel('in', 'accepted')).toBe('Accepted (incl. verbal / informal)');
    expect(stagePickerLabel('out', 'accepted')).toBe('Accepted');
    expect(stagePickerLabel('in', 'invoiced')).toBe('Invoiced');
  });

  it('offers no bid-requested step for money in', () => {
    expect(stagesFor('in')).not.toContain('requested');
    expect(stagesFor('out')).toContain('requested');
  });

  it('labels stages by direction', () => {
    expect(stageLabel('in', 'invoiced')).toBe('Invoiced');
    expect(stageLabel('out', 'invoiced')).toBe('Owed');
    expect(stageLabel('out', 'quoted')).toBe('Bid received');
    expect(stageLabel('in', 'quoted')).toBe('Quoted');
  });

  it('walks the forward path', () => {
    expect(nextStage('accepted')).toBe('contract_sent');
    expect(nextStage('invoiced')).toBe('paid');
    expect(nextStage('paid')).toBeNull();
    expect(nextStage('declined')).toBeNull();
  });
});

// Sums are rounded to cents (B16): adding stored amounts in floating point leaves noise like
// 0.30000000000000004, which reached CSV cells that aren't formatted.
describe('summarizeMoney rounds to cents', () => {
  it('sums and net are whole cents', () => {
    const s = summarizeMoney([
      row({ direction: 'in', stage: 'accepted', amount: '0.1' }),
      row({ direction: 'in', stage: 'accepted', amount: '0.2' }),
      row({ direction: 'out', stage: 'paid', amount: '0.7', amount_settled: '0.7' }),
      row({ direction: 'out', stage: 'paid', amount: '0.1', amount_settled: '0.1' }),
    ], null, now);
    expect(s.expectedIn).toBe(0.3);
    expect(s.outstandingIn).toBe(0.3);
    expect(s.paidOut).toBe(0.8);
    expect(s.expectedOut).toBe(0.8);
    expect(s.net).toBe(-0.5);
  });
});

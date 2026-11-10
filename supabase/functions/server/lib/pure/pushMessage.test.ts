import { describe, it, expect } from 'vitest';
import { pushMessage, switchFor, pushOutcome } from './pushMessage';

const n = (type: string, payload: Record<string, unknown>) => ({ id: 'n1', type, payload });
const show = { hideDetails: false };

// Push notifications (plan approved 11-10): what each notification says on the phone.
describe('pushMessage', () => {
  it('an assignment invite names the role, the day and the gig, and opens the gig', () => {
    const m = pushMessage(n('assignment.requested', { gig_id: 'g1', gig_title: 'Spring Show', gig_date: 'Sat, Oct 10', role_name: 'Sound Tech' }), show);
    expect(m).toEqual({ title: 'New gig request', body: "You've been asked to work Sound Tech · Sat, Oct 10 · Spring Show", url: '/gigs/g1', tag: 'gig-g1' });
  });

  it('accept and decline replies name the person and the role', () => {
    expect(pushMessage(n('assignment.accepted', { gig_id: 'g1', gig_title: 'Spring Show', role_name: 'Sound Tech', first_name: 'Avery' }), show)?.body)
      .toBe('Avery accepted Sound Tech · Spring Show');
    expect(pushMessage(n('assignment.declined', { gig_id: 'g1', gig_title: 'Spring Show', role_name: 'Sound Tech', first_name: 'Avery' }), show)?.body)
      .toBe('Avery declined Sound Tech · Spring Show');
  });

  it('a gig change lists what changed, in one notification', () => {
    expect(pushMessage(n('gig.changed', { gig_id: 'g1', gig_title: 'Spring Show', kinds: ['date', 'venue'] }), show)?.body)
      .toBe('Spring Show: date and venue changed');
    expect(pushMessage(n('gig.changed', { gig_id: 'g1', gig_title: 'Spring Show', kinds: ['time'] }), show)?.body)
      .toBe('Spring Show: time changed');
    expect(pushMessage(n('gig.changed', { gig_id: 'g1', gig_title: 'Spring Show', kinds: ['date', 'time', 'venue'] }), show)?.body)
      .toBe('Spring Show: date, time and venue changed');
  });

  it('a cancelled gig says so', () => {
    expect(pushMessage(n('gig.changed', { gig_id: 'g1', gig_title: 'Spring Show', kinds: ['date', 'cancelled'] }), show)?.body)
      .toBe('Spring Show was cancelled');
  });

  it('a join or access request opens the team screen', () => {
    expect(pushMessage(n('access_request.created', { organization_name: 'Northside Audio', requester_name: 'Sam Lee', requested_role: 'Viewer' }), show))
      .toMatchObject({ title: 'New access request', body: 'Sam Lee asked to join Northside Audio', url: '/team' });
    expect(pushMessage(n('access_request.created', { organization_name: 'Northside Audio', requester_name: 'Sam Lee', requested_role: 'Manager' }), show)?.body)
      .toBe('Sam Lee asked for Manager access in Northside Audio');
  });

  it('payments say only how many, never an amount or a client', () => {
    const m = pushMessage(n('payment.reminder', { due_count: 2, overdue_count: 1, amount: 1234.5, client_name: 'Example Client' }), show)!;
    expect(m.body).toBe('2 payments are due today · 1 is overdue. Open GigWrangler for details.');
    expect(m.url).toBe('/financials');
    expect(JSON.stringify(m)).not.toMatch(/1234|Example Client/);
    expect(pushMessage(n('payment.reminder', { due_count: 1, overdue_count: 0 }), show)?.body)
      .toBe('A payment is due today. Open GigWrangler for details.');
    expect(pushMessage(n('payment.reminder', { due_count: 0, overdue_count: 1 }), show)?.body)
      .toBe('A payment is overdue. Open GigWrangler for details.');
    expect(pushMessage(n('payment.reminder', { due_count: 0, overdue_count: 3 }), show)?.body)
      .toBe('3 payments are overdue. Open GigWrangler for details.');
  });

  it('never carries amounts, rates or contact details from the payload', () => {
    const payload = { gig_id: 'g1', gig_title: 'Spring Show', gig_date: 'Sat, Oct 10', role_name: 'Sound Tech', first_name: 'Avery',
      rate: 45, fee: 300, amount: 1234.5, email: 'avery@example.test', phone: '+1 555 0100', kinds: ['date'] };
    for (const type of ['assignment.requested', 'assignment.accepted', 'assignment.declined', 'gig.changed']) {
      expect(JSON.stringify(pushMessage(n(type, payload), show))).not.toMatch(/45|300|1234|example\.test|555/);
    }
  });

  it('hides the details on the lock screen when the person asked', () => {
    const m = pushMessage(n('assignment.requested', { gig_id: 'g1', gig_title: 'Spring Show', gig_date: 'Sat, Oct 10', role_name: 'Sound Tech' }), { hideDetails: true });
    expect(m).toEqual({ title: 'GigWrangler', body: 'You have a new notification.', url: '/gigs/g1', tag: 'gig-g1' });
  });

  it('keeps long or multi-line values to one short line', () => {
    const body = pushMessage(n('gig.changed', { gig_id: 'g1', gig_title: `Line one\nline two ${'x'.repeat(200)}`, kinds: ['date'] }), show)!.body;
    expect(body).not.toContain('\n');
    expect(body.length).toBeLessThanOrEqual(120);
  });

  it('sends nothing for notifications that are not push events', () => {
    for (const type of ['invitation.accepted', 'access_request.outcome', 'health_check.failure', 'something.else']) {
      expect(pushMessage(n(type, {}), show)).toBeNull();
    }
  });
});

describe('switchFor', () => {
  it('maps each notification to the switch a person can turn off', () => {
    expect(switchFor('assignment.requested')).toBe('assignment_invites');
    expect(switchFor('assignment.accepted')).toBe('assignment_replies');
    expect(switchFor('assignment.declined')).toBe('assignment_replies');
    expect(switchFor('gig.changed')).toBe('gig_changes');
    expect(switchFor('access_request.created')).toBe('join_requests');
    expect(switchFor('payment.reminder')).toBe('payments');
    expect(switchFor('invitation.accepted')).toBeNull();
  });
});

describe('pushOutcome', () => {
  it('sorts the push service answer', () => {
    expect(pushOutcome(201)).toBe('sent');
    expect(pushOutcome(200)).toBe('sent');
    expect(pushOutcome(404)).toBe('gone');
    expect(pushOutcome(410)).toBe('gone');
    expect(pushOutcome(429)).toBe('retry');
    expect(pushOutcome(503)).toBe('retry');
    expect(pushOutcome(400)).toBe('failed');
    expect(pushOutcome(413)).toBe('failed');
  });
});

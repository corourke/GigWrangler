import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GigPrintSheet from './GigPrintSheet';
import { getGigParticipantContacts } from '../../../services/gigParticipantContacts.service';
import { getGigProfitabilitySummary } from '../../../services/gigFinancial.service';

vi.mock('../../../services/gigParticipantContacts.service', () => ({
  getGigParticipantContacts: vi.fn(async (_gig: string, orgId: string) => ({
    'o-venue': [{ id: 'c1', user_id: 'u-dana', is_primary_contact: true, title: 'Production Mgr', user: { id: 'u-dana', first_name: 'Dana', last_name: 'Ortiz', phone: '(503) 555-0142', email: 'dana@riverside.example' } }],
    'o-act': [{ id: 'c2', user_id: 'u-marcus', is_primary_contact: true, title: 'Manager', user: { id: 'u-marcus', first_name: 'Marcus', last_name: 'Bell', phone: '(503) 555-0199', email: 'mgmt@lowtides.example' } }],
  } as Record<string, unknown[]>)[orgId] ?? []),
}));
vi.mock('../../../services/attachment.service', () => ({
  getEntityAttachments: vi.fn().mockResolvedValue([{ id: 'a1', file_name: 'Stage plot.pdf' }, { id: 'a2', file_name: 'Input list.pdf' }]),
}));
vi.mock('../../../services/gigFinancial.service', () => ({
  getGigProfitabilitySummary: vi.fn().mockResolvedValue({
    expectedIn: 6500, receivedIn: 3250, outstandingIn: 3250, dueIn: 0, expectedOut: 480, paidOut: 480,
    outstandingOut: 0, dueOut: 0, net: 6020, projectedStaffCosts: 730, totalCosts: 1210, profit: 5290, margin: 81.4,
  }),
  getGigFinancials: vi.fn().mockResolvedValue([
    { id: 'f1', date: '2026-05-02', direction: 'in', stage: 'contracted', description: 'Performance agreement', reference_number: 'AGR-0412', paid_at: null, due_date: null, category: null, amount: 6500, amount_settled: null },
    { id: 'f2', date: '2026-07-10', direction: 'out', stage: 'paid', description: 'Box truck rental', reference_number: null, paid_at: '2026-07-10T00:00:00Z', due_date: null, category: 'Rent or lease', amount: 420, amount_settled: 420 },
  ]),
}));

const gig = {
  id: 'g1', title: 'Riverside Summer Series', status: 'Booked', start: '2026-07-12T19:00:00Z', end: '2026-07-13T06:30:00Z',
  timezone: 'America/Los_Angeles', tags: [], notes: 'Crew parking in Lot C',
  participants: [
    { id: 'p1', role: 'Venue', organization_id: 'o-venue', organization: { id: 'o-venue', name: 'Riverside Amphitheater', address_line1: '1200 Waterfront Dr', city: 'Portland', state: 'OR', postal_code: '97209', phone_number: '(503) 555-0100' } },
    { id: 'p2', role: 'Act', organization_id: 'o-act', organization: { id: 'o-act', name: 'The Low Tides' } },
  ],
  schedule_entries: [
    { id: 's2', activity_type: 'Set', label: null, start_time: '2026-07-13T02:00:00Z', end_time: '2026-07-13T03:30:00Z', act_participant_id: 'p2', notes: null },
    { id: 's1', activity_type: 'Load-In', label: null, start_time: '2026-07-12T19:00:00Z', end_time: null, act_participant_id: null, notes: 'Dock B' },
  ],
};
const slots = [{
  id: 'sl1', organization_id: 'org-1', role: 'A1 Audio Engineer', count: 2,
  staff_assignments: [{ id: 'a1', user_id: 'u1', status: 'Confirmed', fee: 450, user: { first_name: 'Jordan', last_name: 'Lee', phone: '(503) 555-0121', email: 'jordan@example.com' } }],
}];

function renderSheet(props: Partial<React.ComponentProps<typeof GigPrintSheet>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onReady = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <GigPrintSheet gig={gig as any} organization={{ id: 'org-1', name: 'Northwest Sound Co' } as any} slots={slots as any}
        includeFinancials={false} onReady={onReady} {...props} />
    </QueryClientProvider>,
  );
  return { onReady };
}
const page = (name: RegExp) => screen.getByRole('region', { name });

beforeEach(() => vi.clearAllMocks());

describe('GigPrintSheet (#12)', () => {
  it('prints the gig sheet: venue, schedule, participants, crew contacts, notes and attachments', async () => {
    const { onReady } = renderSheet();
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const sheet = page(/gig sheet/i);
    expect(within(sheet).getByText('Riverside Summer Series')).toBeInTheDocument();
    expect(within(sheet).getByText('Northwest Sound Co', { exact: false })).toBeInTheDocument();
    // Venue: address, main line and main contact.
    expect(within(sheet).getByText('1200 Waterfront Dr')).toBeInTheDocument();
    expect(within(sheet).getByText('Portland, OR 97209')).toBeInTheDocument();
    expect(within(sheet).getByText(/^Contact:/).textContent).toMatch(/Dana Ortiz, Production Mgr\(503\) 555-0142 · dana@riverside\.example/);
    // Schedule in time order, in the gig's time zone.
    const schedule = within(sheet).getByRole('table', { name: 'Schedule' });
    const rows = within(schedule).getAllByRole('row').map((r) => r.textContent);
    expect(rows[0]).toMatch(/12:00 PM.*Load-In.*Dock B/);
    expect(rows[1]).toMatch(/7:00 PM – 8:30 PM.*Set.*The Low Tides/);
    // Participants with their primary contact; crew with phone and email, and open places.
    const participants = within(sheet).getByRole('table', { name: 'Participants' });
    expect(within(participants).getByText('mgmt@lowtides.example')).toBeInTheDocument();
    const crew = within(sheet).getByRole('table', { name: 'Crew' });
    expect(within(crew).getByText('(503) 555-0121')).toBeInTheDocument();
    expect(within(crew).getByText('(open)')).toBeInTheDocument();
    expect(within(sheet).getByText('Crew parking in Lot C')).toBeInTheDocument();
    expect(within(sheet).getByText(/Stage plot\.pdf · Input list\.pdf/)).toBeInTheDocument();
    // No pay on the gig sheet, and no financials page unless asked for.
    expect(within(sheet).queryByText(/\$450/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /financials/i })).not.toBeInTheDocument();
    expect(getGigParticipantContacts).toHaveBeenCalledWith('g1', 'o-venue');
  });

  it('prints the notes as Markdown, without raw HTML (#169)', async () => {
    const { onReady } = renderSheet({ gig: { ...gig, notes: '**Load in** at noon\n\n- Dock B\n\n<img src="x" onerror="alert(1)">' } as any });
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const sheet = page(/gig sheet/i);
    expect(within(sheet).getByText('Load in').tagName).toBe('STRONG');
    expect(within(sheet).getByRole('listitem').textContent).toBe('Dock B');
    expect(sheet.querySelector('img')).toBeNull();
  });

  it('adds the financials page when asked', async () => {
    const { onReady } = renderSheet({ includeFinancials: true });
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const fin = page(/financials/i);
    expect(within(fin).getAllByText('$6,500')).toHaveLength(2); // the Revenue total and the contract row
    expect(within(fin).getByText('$5,290')).toBeInTheDocument();
    const moneyIn = within(within(fin).getByRole('table', { name: 'Money in' }));
    expect(moneyIn.getByText('AGR-0412')).toBeInTheDocument();
    expect(moneyIn.getByText('Contracted')).toBeInTheDocument();
    const moneyOut = within(within(fin).getByRole('table', { name: 'Money out' }));
    expect(moneyOut.getByText('Box truck rental')).toBeInTheDocument();
    expect(moneyOut.getByText('Paid Jul 10')).toBeInTheDocument();
    const staff = within(fin).getByRole('table', { name: 'Staff costs' });
    expect(within(staff).getByText('Jordan Lee')).toBeInTheDocument();
    expect(within(staff).getByText('$450')).toBeInTheDocument();
  });

  it("prints a rate's basis in its unit (#171)", async () => {
    const daySlots = [{ ...slots[0], staff_assignments: [{ ...slots[0].staff_assignments[0], fee: null, rate: 400, rate_unit: 'day', units_completed: 3, completed_at: '2026-07-14T00:00:00Z' }] }];
    const { onReady } = renderSheet({ includeFinancials: true, slots: daySlots as any });
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const staff = within(page(/financials/i)).getByRole('table', { name: 'Staff costs' });
    expect(within(staff).getByText('3 days × $400 / day')).toBeInTheDocument();
    expect(within(staff).getByText('$1,200')).toBeInTheDocument();
  });
  describe('staff costs use the estimate (#219)', () => {
    // 14:00-23:30 in Los Angeles: 9.5 hours
    const longGig = { ...gig, start: '2026-10-11T21:00:00Z', end: '2026-10-12T06:30:00Z' };
    const rateSlots = (assignment: Record<string, unknown>) => [{
      id: 'sl2', organization_id: 'org-1', role: 'Stage Hand', count: 1,
      staff_assignments: [{ id: 'a9', user_id: 'u9', status: 'Confirmed', fee: null, rate: 35, rate_unit: 'hour', user: { first_name: 'Sam', last_name: 'Whitfield' }, ...assignment }],
    }];
    const amountOf = (text: string | null) => Number((text ?? '').replace(/[^0-9.]/g, ''));

    it('shows a booked rate with the estimated basis and amount, and the rows add up to the summary Staff figure', async () => {
      vi.mocked(getGigProfitabilitySummary).mockResolvedValueOnce({
        expectedIn: 0, receivedIn: 0, outstandingIn: 0, dueIn: 0, expectedOut: 0, paidOut: 0,
        outstandingOut: 0, dueOut: 0, net: 0, projectedStaffCosts: 332.5, totalCosts: 332.5, profit: -332.5, margin: 0,
      });
      const { onReady } = renderSheet({ includeFinancials: true, gig: longGig as any, slots: rateSlots({}) as any });
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
      const fin = page(/financials/i);
      const staff = within(fin).getByRole('table', { name: 'Staff costs' });
      expect(within(staff).getByText('est. 9.5 hr × $35.00 / hr')).toBeInTheDocument();
      expect(within(staff).getByText('$332.50')).toBeInTheDocument();
      const total = within(staff).getAllByRole('row').slice(1).reduce((t, r) => t + amountOf(r.lastElementChild!.textContent), 0);
      expect(within(fin).getByText(/Staff \$332\.50/).textContent).toContain(`Staff $${total.toFixed(2)}`);
    });

    it('keeps the units entered for a finalized rate, and a fee as it is', async () => {
      const both = [{
        id: 'sl2', organization_id: 'org-1', role: 'Stage Hand', count: 2,
        staff_assignments: [
          { ...rateSlots({})[0].staff_assignments[0], completed_at: '2026-10-13T00:00:00Z', units_completed: 4 },
          { id: 'a10', user_id: 'u10', status: 'Confirmed', fee: 450, rate: null, user: { first_name: 'Jordan', last_name: 'Lee' } },
        ],
      }];
      const { onReady } = renderSheet({ includeFinancials: true, gig: longGig as any, slots: both as any });
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
      const staff = within(page(/financials/i)).getByRole('table', { name: 'Staff costs' });
      expect(within(staff).getByText('4 hours × $35 / hr')).toBeInTheDocument();
      expect(within(staff).getByText('$140')).toBeInTheDocument();
      expect(within(staff).getByText('Fee')).toBeInTheDocument();
      expect(within(staff).getByText('$450')).toBeInTheDocument();
    });
  });
});

// Plan #466 part 3 (Cameron 11-20): the printed Crew table lists other organizations' crew too,
// with their phone and email, an Organization column, and no pay.
describe('GigPrintSheet: other organizations\' crew (#466)', () => {
  const other = { key: 'roster-z1', name: 'Sam Rivera', role: 'Monitor Engineer', title: 'Monitor Engineer', phone: '(503) 555-0177', email: 'sam@example.test', org_name: 'Harbor Sound', user_id: 'u9', status: 'Confirmed', organization_id: 'org-9' };

  it('adds an Organization column and their rows, with phone and email', async () => {
    const { onReady } = renderSheet({ otherCrew: [other] } as any);
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const crew = within(page(/gig sheet/i)).getByRole('table', { name: 'Crew' });
    expect(within(crew).getByRole('columnheader', { name: 'Organization' })).toBeInTheDocument();
    const sam = within(crew).getByText('Sam Rivera').closest('tr') as HTMLElement;
    expect(sam.textContent).toMatch(/Monitor Engineer/);
    expect(sam.textContent).toMatch(/Harbor Sound/);
    expect(sam.textContent).toMatch(/\(503\) 555-0177/);
    expect(sam.textContent).toMatch(/sam@example\.test/);
    // This organization's own crew carry its name.
    expect((within(crew).getByText('Jordan Lee').closest('tr') as HTMLElement).textContent).toMatch(/Northwest Sound Co/);
  });

  it('prints no pay for them, even with the financials page', async () => {
    const { onReady } = renderSheet({ otherCrew: [other], includeFinancials: true } as any);
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const crew = within(page(/gig sheet/i)).getByRole('table', { name: 'Crew' });
    expect(crew.textContent).not.toMatch(/\$|fee|rate/i);
    const financials = page(/gig financials/i);
    expect(within(financials).queryByText(/Sam Rivera/)).not.toBeInTheDocument();
  });

  it('leaves the table as it was when there are none', async () => {
    const { onReady } = renderSheet({ otherCrew: [] } as any);
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const crew = within(page(/gig sheet/i)).getByRole('table', { name: 'Crew' });
    expect(within(crew).queryByRole('columnheader', { name: 'Organization' })).not.toBeInTheDocument();
  });
});


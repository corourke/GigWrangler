import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderWithQuery as render } from '../../test/renderWithQuery';

// Plan #445 (A2b): Today's "Needs you" counts, each opening its list.
const auth = { user: { id: 'u1' }, selectedOrganization: { id: 'org-1' }, userRole: 'Admin' as string };
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../services/mobile/needsYou.service', () => ({
  fetchMyInvites: vi.fn(),
  fetchOpenCrewSpots: vi.fn(),
  fetchPaymentsDue: vi.fn(),
  fetchAccessRequestCount: vi.fn(),
  fetchReceiptsToReview: vi.fn(),
  fetchEquipmentConflicts: vi.fn(),
}));
vi.mock('../../services/mobile/myAssignments.service', () => ({ setMyAssignmentStatus: vi.fn(async () => {}) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import * as svc from '../../services/mobile/needsYou.service';
import { setMyAssignmentStatus } from '../../services/mobile/myAssignments.service';
import NeedsYou from './NeedsYou';

const gig = (id: string, title: string) => ({ id, title, start: '2026-11-12T20:00:00Z', end: '2026-11-12T23:00:00Z', timezone: 'UTC', all_day: false, status: 'Booked' });
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true });

function everythingHas() {
  vi.mocked(svc.fetchMyInvites).mockResolvedValue([{ assignmentId: 'a1', role: 'FOH', gig: gig('g1', 'Spring Gala') }]);
  vi.mocked(svc.fetchOpenCrewSpots).mockResolvedValue({ spots: 3, gigs: [{ gig: gig('g2', 'Autumn Ball'), open: 3 }] });
  vi.mocked(svc.fetchAccessRequestCount).mockResolvedValue(1);
  vi.mocked(svc.fetchEquipmentConflicts).mockResolvedValue({ count: 2, gigs: [
    { gigId: 'g5', title: 'Spring Gala', start: '2026-11-12T20:00:00Z', others: ['Gala Load-in'] },
    { gigId: 'g6', title: 'Gala Load-in', start: '2026-11-12T21:00:00Z', others: ['Spring Gala'] },
  ] });
  vi.mocked(svc.fetchReceiptsToReview).mockResolvedValue([{ id: 'q1', status: 'ready', file_name: 'fuel.jpg', created_at: '2026-11-10T10:00:00Z' } as any]);
  vi.mocked(svc.fetchPaymentsDue).mockResolvedValue({ due: 2, overdue: 1, lines: [{ id: 'f1', gigId: 'g3', gigTitle: 'Winter Fair', direction: 'in', due_date: '2026-11-10' }] });
}
const week = [gig('g5', 'Spring Gala'), gig('g6', 'Gala Load-in')];
const props = (): any => ({ onViewGigDetail: vi.fn(), weekGigs: week });
const rows = () => within(screen.getByRole('region', { name: 'Needs you' })).getAllByRole('button', { expanded: false }).map((b) => b.textContent);

beforeEach(() => { vi.clearAllMocks(); setOnline(true); everythingHas(); });
afterEach(() => setOnline(true));

describe('NeedsYou', () => {
  it('shows an Admin every count', async () => {
    auth.userRole = 'Admin';
    render(<NeedsYou {...props()} />);
    expect(await screen.findByRole('button', { name: /Payments due or overdue/ })).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(rows()).toEqual([
      expect.stringMatching(/1.*Invite to reply to/),
      expect.stringMatching(/3.*Open crew spots \(14 days\)/),
      expect.stringMatching(/1.*Access request/),
      expect.stringMatching(/2.*Equipment conflicts this week/),
      expect.stringMatching(/1.*Receipt to review/),
      expect.stringMatching(/2 due today · 1 overdue.*Payments due or overdue/),
    ]);
  });

  it('shows a Manager everything but payments', async () => {
    auth.userRole = 'Manager';
    render(<NeedsYou {...props()} />);
    await screen.findByRole('button', { name: /Receipt to review/ });
    expect(screen.queryByRole('button', { name: /Payments/ })).not.toBeInTheDocument();
    expect(svc.fetchPaymentsDue).not.toHaveBeenCalled();
  });

  it('shows Staff only their invites', async () => {
    auth.userRole = 'Staff';
    render(<NeedsYou {...props()} />);
    await screen.findByRole('button', { name: /Invite to reply to/ });
    expect(rows()).toHaveLength(1);
    expect(svc.fetchOpenCrewSpots).not.toHaveBeenCalled();
    expect(svc.fetchAccessRequestCount).not.toHaveBeenCalled();
    expect(svc.fetchReceiptsToReview).not.toHaveBeenCalled();
  });

  it('hides a count of zero, and the whole panel when nothing needs the person', async () => {
    auth.userRole = 'Manager';
    vi.mocked(svc.fetchMyInvites).mockResolvedValue([]);
    vi.mocked(svc.fetchOpenCrewSpots).mockResolvedValue({ spots: 0, gigs: [] });
    vi.mocked(svc.fetchAccessRequestCount).mockResolvedValue(0);
    vi.mocked(svc.fetchReceiptsToReview).mockResolvedValue([]);
    vi.mocked(svc.fetchEquipmentConflicts).mockResolvedValue({ count: 0, gigs: [] });
    render(<NeedsYou {...props()} />);
    await waitFor(() => expect(svc.fetchReceiptsToReview).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Needs you' })).not.toBeInTheDocument());
  });

  it("a count that fails doesn't hide the others", async () => {
    auth.userRole = 'Manager';
    vi.mocked(svc.fetchOpenCrewSpots).mockRejectedValue(new Error('boom'));
    render(<NeedsYou {...props()} />);
    expect(await screen.findByRole('button', { name: /Invite to reply to/ })).toBeInTheDocument();
    expect(await screen.findByText("Couldn't load open crew spots")).toBeInTheDocument();
  });

  it('offline, says the counts need a connection', async () => {
    setOnline(false);
    render(<NeedsYou {...props()} />);
    expect(await screen.findByText('Counts need a connection.')).toBeInTheDocument();
    expect(svc.fetchMyInvites).not.toHaveBeenCalled();
  });

  it('runs no count query once the phone has gone offline, even before the app has noticed', async () => {
    auth.userRole = 'Admin';
    const { queryClient } = render(<NeedsYou {...props()} />);
    await screen.findByRole('button', { name: /Open crew spots/ });
    await waitFor(() => expect(svc.fetchEquipmentConflicts).toHaveBeenCalled());
    const calls = () => [svc.fetchMyInvites, svc.fetchOpenCrewSpots, svc.fetchAccessRequestCount, svc.fetchReceiptsToReview, svc.fetchPaymentsDue, svc.fetchEquipmentConflicts]
      .map((f) => vi.mocked(f).mock.calls.length);
    const before = calls();
    setOnline(false); // no 'offline' event yet: the screen still thinks it is online
    await queryClient.invalidateQueries();
    expect(calls()).toEqual(before);
    setOnline(true);
  });

  it('invites open their list, with Accept and Decline', async () => {
    auth.userRole = 'Staff';
    render(<NeedsYou {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Invite to reply to/ }));
    const list = screen.getByRole('list', { name: 'Invites to reply to' });
    expect(list).toHaveTextContent('Spring Gala');
    expect(list).toHaveTextContent('FOH');
    fireEvent.click(within(list).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(setMyAssignmentStatus).toHaveBeenCalledWith('a1', 'Confirmed'));
  });

  it('open crew spots, receipts, access requests and payments open their lists', async () => {
    auth.userRole = 'Admin';
    const p = props();
    render(<NeedsYou {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: /Open crew spots/ }));
    fireEvent.click(within(screen.getByRole('list', { name: 'Open crew spots' })).getByRole('button', { name: /Autumn Ball/ }));
    expect(p.onViewGigDetail).toHaveBeenCalledWith('g2');

    fireEvent.click(screen.getByRole('button', { name: /Receipt to review/ }));
    expect(screen.getByRole('list', { name: 'Receipts to review' })).toHaveTextContent('fuel.jpg');
    expect(screen.getByText('Review them on a computer: Purchases → Scan invoices.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Access request/ }));
    // Phones have no Team screen: the request is decided on a computer.
    expect(screen.queryByRole('button', { name: 'Open Team' })).not.toBeInTheDocument();
    expect(screen.getByText('Decide them on a computer: Team → Access Requests.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Payments due or overdue/ }));
    const payments = within(screen.getByRole('list', { name: 'Payments due or overdue' }));
    // The short date the other rows use, not 2026-11-10.
    expect(payments.getByText('Money in · due Tue, Nov 10')).toBeInTheDocument();
    fireEvent.click(payments.getByRole('button', { name: /Winter Fair/ }));
    expect(p.onViewGigDetail).toHaveBeenCalledWith('g3');
  });
});

// Plan #445 (A2c): equipment conflicts this week, after the other counts, from the gigs Today has.
describe('NeedsYou: equipment conflicts', () => {
  it('shows Admins and Managers the gigs that clash, and opens a gig', async () => {
    auth.userRole = 'Manager';
    const p = props();
    render(<NeedsYou {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: /Equipment conflicts this week/ }));
    const list = screen.getByRole('list', { name: 'Equipment conflicts' });
    expect(list).toHaveTextContent('Clashes with Gala Load-in');
    fireEvent.click(within(list).getByRole('button', { name: /^Spring Gala/ }));
    expect(p.onViewGigDetail).toHaveBeenCalledWith('g5');
    expect(svc.fetchEquipmentConflicts).toHaveBeenCalledWith('org-1', week);
  });

  it('is not shown to Staff, and the check does not run', async () => {
    auth.userRole = 'Staff';
    render(<NeedsYou {...props()} />);
    await screen.findByRole('button', { name: /Invite to reply to/ });
    expect(svc.fetchEquipmentConflicts).not.toHaveBeenCalled();
  });

  it("waits for Today's gigs: the check doesn't run until they are in", async () => {
    auth.userRole = 'Manager';
    render(<NeedsYou {...props()} weekGigs={undefined} />);
    await screen.findByRole('button', { name: /Invite to reply to/ });
    expect(svc.fetchEquipmentConflicts).not.toHaveBeenCalled();
  });

  it("a failed check doesn't hide the others, and zero is hidden", async () => {
    auth.userRole = 'Manager';
    vi.mocked(svc.fetchEquipmentConflicts).mockRejectedValue(new Error('slow'));
    render(<NeedsYou {...props()} />);
    expect(await screen.findByText("Couldn't load equipment conflicts")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invite to reply to/ })).toBeInTheDocument();
  });
});


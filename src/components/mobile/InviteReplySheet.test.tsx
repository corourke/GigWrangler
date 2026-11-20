import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery as render } from '../../test/renderWithQuery';
import InviteReplySheet from './InviteReplySheet';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, selectedOrganization: { id: 'org-1' } }) }));
vi.mock('../../services/mobile/myAssignments.service', () => ({
  fetchMyAssignment: vi.fn(),
  setMyAssignmentStatus: vi.fn(),
}));
const markRead = vi.fn();
const notifications = [
  { id: 'n-9', type: 'assignment.requested', payload: { assignment_id: 'a-1' } },
  { id: 'n-8', type: 'assignment.requested', payload: { assignment_id: 'a-2' } },
  { id: 'n-7', type: 'gig.changed', payload: { assignment_id: 'a-1' } },
];
vi.mock('../../hooks/useNotifications', () => ({
  useNotifications: () => ({ data: notifications }),
  useMarkNotificationRead: () => ({ mutate: (...a: unknown[]) => markRead(...a) }),
}));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

import { fetchMyAssignment, setMyAssignmentStatus } from '../../services/mobile/myAssignments.service';

const gig = { id: 'g1', title: 'Spring Gala', start: '2026-12-12T20:00:00Z', end: '2026-12-12T23:00:00Z', timezone: 'UTC', all_day: false, status: 'Booked' };
const open = { state: 'open', role: 'FOH', gig };
const props = () => ({ assignmentId: 'a-1', onClose: vi.fn(), onViewGigDetail: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMyAssignment).mockResolvedValue(open as any);
  vi.mocked(setMyAssignmentStatus).mockResolvedValue(undefined);
});

// Plan #457 part 2 (Cameron 11-18): tapping an invite push opens this on Home.
describe('InviteReplySheet', () => {
  it('shows the role, the gig and the day, with Accept, Decline and Open gig', async () => {
    render(<InviteReplySheet {...props()} />);
    expect(await screen.findByText('FOH')).toBeInTheDocument();
    expect(screen.getByText('Gig invite')).toBeInTheDocument();
    expect(screen.getByText('Spring Gala')).toBeInTheDocument();
    expect(screen.getByText(/Dec 12/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  });

  it('Accept replies Confirmed, says so, and closes the sheet', async () => {
    const p = props();
    render(<InviteReplySheet {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(setMyAssignmentStatus).toHaveBeenCalledWith('a-1', 'Confirmed'));
    await waitFor(() => expect(p.onClose).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Accepted');
  });

  // Docs Lead smoke 11-19: a plain /today?invite= link doesn't clear the bell, so the sheet does.
  it("marks that invite's notification read when it is answered", async () => {
    render(<InviteReplySheet {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith('n-9'));
    expect(markRead).toHaveBeenCalledTimes(1); // not another invite's, nor another kind
  });

  it('Decline replies Declined', async () => {
    const p = props();
    render(<InviteReplySheet {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(setMyAssignmentStatus).toHaveBeenCalledWith('a-1', 'Declined'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Declined'));
    expect(p.onClose).toHaveBeenCalled();
  });

  it('a failed reply says so and stays open with the buttons', async () => {
    vi.mocked(setMyAssignmentStatus).mockRejectedValue(new Error('nope'));
    const p = props();
    render(<InviteReplySheet {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't send your reply. Try again."));
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });

  it('Open gig goes to the gig', async () => {
    const p = props();
    render(<InviteReplySheet {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open gig' }));
    expect(p.onViewGigDetail).toHaveBeenCalledWith('g1');
  });

  it('an invite already answered shows the answer, with no buttons', async () => {
    vi.mocked(fetchMyAssignment).mockResolvedValue({ ...open, state: 'Declined' } as any);
    render(<InviteReplySheet {...props()} />);
    expect(await screen.findByText('You declined this.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('a cancelled, over or removed invite says No longer needed, with no buttons', async () => {
    vi.mocked(fetchMyAssignment).mockResolvedValue({ state: 'closed', role: null, gig: null } as any);
    const p = props();
    render(<InviteReplySheet {...p} />);
    expect(await screen.findByText('No longer needed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it("when the invite can't be loaded (offline), says to connect and offers Close", async () => {
    vi.mocked(fetchMyAssignment).mockRejectedValue(new Error('Failed to fetch'));
    render(<InviteReplySheet {...props()} />);
    expect(await screen.findByText("Couldn't load this invite. Connect and try again.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });
});

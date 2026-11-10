import type { ReactElement } from 'react';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { makeUser, makeOrganization } from '../test/factories';
import * as notificationService from '../services/notification.service';

// src/test/setup.ts globally no-ops NotificationBell for every other screen
// test that renders AppHeader — undo that here since this file exercises
// the real component.
vi.unmock('./NotificationBell');
const { default: NotificationBell } = await import('./NotificationBell');

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const mockUseAuth = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockToTeam = vi.fn();
const mockToModeratorQueue = vi.fn();
const mockViewGig = vi.fn();
const mockToFinancials = vi.fn();
vi.mock('../routes/useNav', () => ({
  useNav: () => ({ toTeam: mockToTeam, toModeratorQueue: mockToModeratorQueue, viewGig: mockViewGig, toFinancials: mockToFinancials }),
}));

vi.mock('../services/notification.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/notification.service')>();
  return {
    ...actual,
    getMyNotifications: vi.fn().mockResolvedValue([]),
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
  };
});

const org = makeOrganization({ id: 'org-1', name: 'Acme Productions' });

// DropdownMenuContent (Radix) only mounts its items once the trigger opens. While it opens,
// Radix sets pointer-events: none on the body and turns the menu's own back on a render later;
// under load a click can land in between, so wait for the menu to take clicks.
async function openBell(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Notifications' }));
  await waitFor(() => expect(screen.getByRole('menu').style.pointerEvents).not.toBe('none'));
}

describe('NotificationBell (issue #52 — generic notifications)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([]);
    mockUseAuth.mockReturnValue({
      user: makeUser(),
      organizations: [],
      selectOrganization: vi.fn(),
    });
  });

  it('shows no badge when there are no unread notifications', async () => {
    render(<NotificationBell />);
    await waitFor(() => expect(notificationService.getMyNotifications).toHaveBeenCalled());
    expect(screen.queryByText(/\d/)).not.toBeInTheDocument();
  });

  it('badges an unread access-request outcome notice', async () => {
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([
      {
        id: 'notif-1',
        recipient_id: 'user-1',
        type: 'access_request.outcome',
        payload: {
          access_request_id: 'req-1',
          organization_id: 'org-1',
          organization_name: 'Acme Productions',
          requested_role: 'Admin',
          status: 'approved',
          response_message: null,
        },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      } as any,
    ]);

    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    await openBell(user);
    expect(screen.getByText(/was approved/)).toBeInTheDocument();
  });

  it('badges an unread access-request created notice and shows requester/role/org', async () => {
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([
      {
        id: 'notif-2',
        recipient_id: 'admin-1',
        type: 'access_request.created',
        payload: {
          access_request_id: 'req-2',
          organization_id: 'org-1',
          organization_name: 'Acme Productions',
          requester_name: 'Jamie Doe',
          requested_role: 'Manager',
        },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      } as any,
    ]);

    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    await openBell(user);
    expect(screen.getByText(/Jamie Doe/)).toBeInTheDocument();
  });

  it('clicking a created notice for an org the user administers marks it read and goes to Team', async () => {
    mockUseAuth.mockReturnValue({
      user: makeUser(),
      organizations: [{ organization: org, role: 'Admin' }],
      selectOrganization: vi.fn(),
    });
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([
      {
        id: 'notif-3',
        recipient_id: 'admin-1',
        type: 'access_request.created',
        payload: {
          access_request_id: 'req-3',
          organization_id: 'org-1',
          organization_name: 'Acme Productions',
          requester_name: 'Jamie Doe',
          requested_role: 'Manager',
        },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      } as any,
    ]);

    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    await openBell(user);
    await user.click(screen.getByText(/Jamie Doe/));

    await waitFor(() => expect(notificationService.markNotificationRead).toHaveBeenCalledWith('notif-3'));
    expect(mockToTeam).toHaveBeenCalled();
    expect(mockToModeratorQueue).not.toHaveBeenCalled();
  });

  it('clicking a created notice for an org the user does not administer goes to the moderator queue', async () => {
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([
      {
        id: 'notif-4',
        recipient_id: 'moderator-1',
        type: 'access_request.created',
        payload: {
          access_request_id: 'req-4',
          organization_id: 'org-unclaimed',
          organization_name: 'New Org',
          requester_name: 'Jamie Doe',
          requested_role: 'Admin',
        },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      } as any,
    ]);

    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    await openBell(user);
    await user.click(screen.getByText(/Jamie Doe/));

    await waitFor(() => expect(mockToModeratorQueue).toHaveBeenCalled());
    expect(mockToTeam).not.toHaveBeenCalled();
  });

  it('a request to join reads as one, and takes a Manager of that org to Team', async () => {
    mockUseAuth.mockReturnValue({
      user: makeUser(),
      organizations: [{ organization: org, role: 'Manager' }],
      selectOrganization: vi.fn(),
    });
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([
      {
        id: 'notif-join',
        recipient_id: 'manager-1',
        type: 'access_request.created',
        payload: {
          access_request_id: 'req-join',
          organization_id: 'org-1',
          organization_name: 'Acme Productions',
          requester_name: 'Robin Park',
          requested_role: 'Viewer',
        },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      } as any,
    ]);

    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    await openBell(user);
    expect(screen.getByText(/asked to join/)).toBeInTheDocument();
    await user.click(screen.getByText(/Robin Park/));

    await waitFor(() => expect(mockToTeam).toHaveBeenCalled());
    expect(mockToModeratorQueue).not.toHaveBeenCalled();
  });

  it('the outcome of a request to join reads as one', async () => {
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([
      {
        id: 'notif-join-outcome',
        recipient_id: 'user-1',
        type: 'access_request.outcome',
        payload: {
          access_request_id: 'req-join',
          organization_id: 'org-1',
          organization_name: 'Acme Productions',
          requested_role: 'Staff',
          status: 'approved',
          response_message: null,
        },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      } as any,
    ]);

    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    await openBell(user);
    expect(screen.getByText(/Your request to join/)).toBeInTheDocument();
  });

  it('does not query notifications when there is no user', async () => {
    mockUseAuth.mockReturnValue({ user: null, organizations: [], selectOrganization: vi.fn() });
    render(<NotificationBell />);
    expect(notificationService.getMyNotifications).not.toHaveBeenCalled();
  });

  it('badges an unread invitation-accepted notice and shows the accepted user/org', async () => {
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([
      {
        id: 'notif-5',
        recipient_id: 'inviter-1',
        type: 'invitation.accepted',
        payload: {
          invitation_id: 'inv-1',
          organization_id: 'org-1',
          organization_name: 'Acme Productions',
          accepted_user_name: 'Jordan Lee',
        },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      } as any,
    ]);

    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    await openBell(user);
    expect(screen.getByText(/Jordan Lee/)).toBeInTheDocument();
    expect(screen.getByText(/accepted your invitation/)).toBeInTheDocument();
  });

  it('clicking an invitation-accepted notice marks it read and selects that org before going to Team', async () => {
    const selectOrganization = vi.fn();
    mockUseAuth.mockReturnValue({
      user: makeUser(),
      organizations: [{ organization: org, role: 'Manager' }],
      selectOrganization,
    });
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([
      {
        id: 'notif-6',
        recipient_id: 'inviter-1',
        type: 'invitation.accepted',
        payload: {
          invitation_id: 'inv-2',
          organization_id: 'org-1',
          organization_name: 'Acme Productions',
          accepted_user_name: 'Jordan Lee',
        },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      } as any,
    ]);

    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    await openBell(user);
    await user.click(screen.getByText(/Jordan Lee/));

    await waitFor(() => expect(notificationService.markNotificationRead).toHaveBeenCalledWith('notif-6'));
    expect(selectOrganization).toHaveBeenCalledWith(org);
    expect(mockToTeam).toHaveBeenCalled();
  });

  it('badges an unread health-check failure and shows the failing check', async () => {
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([
      {
        id: 'notif-7',
        recipient_id: 'moderator-1',
        type: 'health_check.failure',
        payload: {
          check: 'sentry',
          detail: 'Synthetic event not retrievable within timeout',
          checked_at: '2026-01-01T00:00:00Z',
        },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      } as any,
    ]);

    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    await openBell(user);
    expect(screen.getByText(/Sentry/)).toBeInTheDocument();
    expect(screen.getByText(/health check failed/)).toBeInTheDocument();
    expect(screen.getByText(/Synthetic event not retrievable/)).toBeInTheDocument();
  });

  it('dismissing a health-check failure marks it read', async () => {
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue([
      {
        id: 'notif-8',
        recipient_id: 'moderator-1',
        type: 'health_check.failure',
        payload: { check: 'google_places', detail: null, checked_at: '2026-01-01T00:00:00Z' },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      } as any,
    ]);

    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    await openBell(user);
    await user.click(screen.getByText(/Google Places/));

    await waitFor(() => expect(notificationService.markNotificationRead).toHaveBeenCalledWith('notif-8'));
  });
});

// Push notifications, part 4: the bell shows the new kinds and opens their screen.
describe('NotificationBell: gigs, staffing and payments', () => {
  const selectOrganization = vi.fn();
  const note = (type: string, payload: Record<string, unknown>) => ({
    id: `n-${type}`, recipient_id: 'user-1', type, payload, read_at: null, created_at: '2026-01-01T00:00:00Z',
  }) as any;
  const gig = { gig_id: 'gig-1', gig_title: 'Spring Gala', organization_id: 'org-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: makeUser(),
      organizations: [{ organization: org, role: 'Staff' }],
      selectOrganization,
    });
  });

  async function open(notifications: unknown[]) {
    vi.mocked(notificationService.getMyNotifications).mockResolvedValue(notifications as any);
    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText(String(notifications.length))).toBeInTheDocument());
    await openBell(user);
    return user;
  }

  it('a request to work a gig opens the gig in its organization', async () => {
    const user = await open([note('assignment.requested', { ...gig, role_name: 'A1', gig_date: 'Sat 14 Nov', assignment_id: 'a-1' })]);
    const item = screen.getByRole('menuitem', { name: /You've been asked to work A1 on Spring Gala/ });
    expect(item).toHaveTextContent('Sat 14 Nov');
    await user.click(item);
    expect(notificationService.markNotificationRead).toHaveBeenCalledWith('n-assignment.requested');
    expect(selectOrganization).toHaveBeenCalledWith(org);
    expect(mockViewGig).toHaveBeenCalledWith('gig-1');
  });

  it('shows replies', async () => {
    await open([
      note('assignment.accepted', { ...gig, role_name: 'A1', first_name: 'Sam', assignment_id: 'a-1' }),
      note('assignment.declined', { ...gig, role_name: 'Lights', first_name: 'Robin', assignment_id: 'a-2' }),
    ]);
    expect(screen.getByRole('menuitem', { name: /Sam accepted A1 on Spring Gala/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Robin declined Lights on Spring Gala/ })).toBeInTheDocument();
  });

  it('shows gig changes and cancellations', async () => {
    await open([
      note('gig.changed', { ...gig, kinds: ['venue', 'date'] }),
      note('gig.changed', { ...gig, gig_id: 'gig-2', gig_title: 'Autumn Ball', kinds: ['cancelled'] }),
    ]);
    expect(screen.getByRole('menuitem', { name: /Spring Gala: the date and venue changed/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Autumn Ball was cancelled/ })).toBeInTheDocument();
  });

  it('payment reminders open Financials in their organization', async () => {
    const user = await open([note('payment.reminder', { organization_id: 'org-1', organization_name: 'Acme Productions', due_count: 2, overdue_count: 1 })]);
    const item = screen.getByRole('menuitem', { name: /Acme Productions: 2 payments are due today · 1 is overdue/ });
    await user.click(item);
    expect(selectOrganization).toHaveBeenCalledWith(org);
    expect(mockToFinancials).toHaveBeenCalled();
  });
});

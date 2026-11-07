import type { ReactElement } from 'react';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import AddTeamMemberDialog from './AddTeamMemberDialog';
import * as organizationService from '../../services/organization.service';
import * as userService from '../../services/user.service';

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

// Radix Select doesn't open under jsdom; render its items flat so the role
// options offered on each tab can be read directly.
vi.mock('../ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ value, children }: any) => <div role="option" aria-selected={false} data-value={value}>{children}</div>,
}));

const offeredRoles = () => screen.queryAllByRole('option').map((o) => o.getAttribute('data-value'));

vi.mock('../../services/user.service', () => ({
  searchPeople: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/organization.service', () => ({
  // Used by useTeamData's useTeamMutations — not exercised by these tests,
  // but must exist so the hook's useMutation() calls don't reference undefined.
  addExistingUserToOrganization: vi.fn(),
  inviteUserToOrganization: vi.fn(),
  updateMemberDetails: vi.fn(),
  removeMember: vi.fn(),
  cancelInvitation: vi.fn(),
  // Exercised by the new "No Account" tab.
  addOrganizationContact: vi.fn(),
  linkExistingPersonToOrganization: vi.fn(),
}));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  orgId: 'org-1',
  organizationName: 'Acme Productions',
  excludeUserIds: [],
};

describe('AddTeamMemberDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.searchPeople).mockResolvedValue([]);
  });

  it('renders all three tabs, including the new quick-add tab', () => {
    render(<AddTeamMemberDialog {...defaultProps} />);
    expect(screen.getByText('Existing User')).toBeInTheDocument();
    expect(screen.getByText('Invite New')).toBeInTheDocument();
    expect(screen.getByText('No Account')).toBeInTheDocument();
  });

  it('quick-adds a person without an account and without requiring email (issue #5)', async () => {
    vi.mocked(organizationService.addOrganizationContact).mockResolvedValue({ user_id: 'u1', member: {} } as any);
    render(<AddTeamMemberDialog {...defaultProps} />);

    fireEvent.mouseDown(screen.getByText('No Account'));
    fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Roadie' } });
    fireEvent.click(screen.getByText('Add to Team'));

    await waitFor(() => expect(organizationService.addOrganizationContact).toHaveBeenCalledWith('org-1', {
      firstName: 'Sam',
      lastName: 'Roadie',
      email: undefined,
      phone: undefined,
      role: 'Staff',
    }));
  });

  it('requires a name before quick-adding', async () => {
    render(<AddTeamMemberDialog {...defaultProps} />);

    fireEvent.mouseDown(screen.getByText('No Account'));
    fireEvent.click(screen.getByText('Add to Team'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('First and last name are required'));
    expect(organizationService.addOrganizationContact).not.toHaveBeenCalled();
  });

  it('searches system-wide (not scoped to this org) so a match on another org still surfaces', async () => {
    // Regression: this used to call a per-organization RPC that missed people who
    // are only members of a DIFFERENT organization — the same searchPeople path
    // the Existing User tab already uses must find them too.
    vi.mocked(userService.searchPeople).mockResolvedValue([
      { id: 'existing-1', first_name: 'Cameron', last_name: 'Orourke', matched_on: 'name' },
    ]);
    vi.mocked(organizationService.linkExistingPersonToOrganization).mockResolvedValue({ user_id: 'existing-1', member: {} } as any);

    render(<AddTeamMemberDialog {...defaultProps} />);

    fireEvent.mouseDown(screen.getByText('No Account'));
    fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Cam' } });

    await waitFor(() => expect(userService.searchPeople).toHaveBeenCalledWith('Cam', { email: '', phone: '' }));
    await waitFor(() => expect(screen.getByText(/Found a possible match/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Use this person'));

    await waitFor(() => expect(organizationService.linkExistingPersonToOrganization).toHaveBeenCalledWith('org-1', {
      userId: 'existing-1',
      role: 'Staff',
    }));
    expect(organizationService.addOrganizationContact).not.toHaveBeenCalled();
  });

  describe('role options', () => {
    const selectExistingUser = async () => {
      vi.mocked(userService.searchPeople).mockResolvedValue([
        { id: 'existing-1', first_name: 'Cameron', last_name: 'Orourke', matched_on: 'name' },
      ]);
      fireEvent.change(screen.getByLabelText('Search Users'), { target: { value: 'Cam' } });
      fireEvent.click(await screen.findByText('Cameron Orourke'));
    };

    it('does not offer Admin to a Manager on the Existing User tab', async () => {
      render(<AddTeamMemberDialog {...defaultProps} userRole="Manager" />);
      await selectExistingUser();
      expect(offeredRoles()).toEqual(['Manager', 'Staff', 'Viewer']);
    });

    it('does not offer Admin to a Manager on the Invite New tab', () => {
      render(<AddTeamMemberDialog {...defaultProps} userRole="Manager" />);
      fireEvent.mouseDown(screen.getByText('Invite New'));
      expect(offeredRoles()).toEqual(['Manager', 'Staff', 'Viewer']);
    });

    it('offers Admin to an Admin on both tabs', async () => {
      render(<AddTeamMemberDialog {...defaultProps} userRole="Admin" />);
      await selectExistingUser();
      expect(offeredRoles()).toEqual(['Admin', 'Manager', 'Staff', 'Viewer']);
      fireEvent.mouseDown(screen.getByText('Invite New'));
      expect(offeredRoles()).toEqual(['Admin', 'Manager', 'Staff', 'Viewer']);
    });

    it('offers only Staff and Viewer on the No Account tab', () => {
      render(<AddTeamMemberDialog {...defaultProps} userRole="Admin" />);
      fireEvent.mouseDown(screen.getByText('No Account'));
      expect(offeredRoles()).toEqual(['Staff', 'Viewer']);
    });
  });

  describe('Invite New', () => {
    const sendInvite = () => {
      fireEvent.mouseDown(screen.getByText('Invite New'));
      fireEvent.change(screen.getByLabelText('Email Address *'), { target: { value: 'new@example.com' } });
      fireEvent.click(screen.getByText('Send Invitation'));
    };

    it('does not show developer copy about production', () => {
      render(<AddTeamMemberDialog {...defaultProps} userRole="Admin" />);
      fireEvent.mouseDown(screen.getByText('Invite New'));
      expect(screen.queryByText(/In production/)).not.toBeInTheDocument();
      expect(screen.getByText(/We'll email them a link to join/)).toBeInTheDocument();
    });

    it('says "Invitation sent!" when the email went out', async () => {
      vi.mocked(organizationService.inviteUserToOrganization).mockResolvedValue({ invitation: {}, user: {}, email_sent: true });
      render(<AddTeamMemberDialog {...defaultProps} userRole="Admin" />);
      sendInvite();

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      render(vi.mocked(toast.success).mock.calls[0][0] as ReactElement);
      expect(screen.getByText('Invitation sent!')).toBeInTheDocument();
    });

    it('does not claim the invitation was sent when the email failed', async () => {
      vi.mocked(organizationService.inviteUserToOrganization).mockResolvedValue({ invitation: {}, user: {}, email_sent: false });
      render(<AddTeamMemberDialog {...defaultProps} userRole="Admin" />);
      sendInvite();

      await waitFor(() => expect(toast.warning).toHaveBeenCalled());
      expect(toast.success).not.toHaveBeenCalled();
      render(vi.mocked(toast.warning).mock.calls[0][0] as ReactElement);
      expect(screen.queryByText(/Invitation (re)?sent!/)).not.toBeInTheDocument();
      expect(screen.getByText("Invitation created, but the email couldn't be sent")).toBeInTheDocument();
      expect(screen.getByText(/new@example\.com/)).toBeInTheDocument();
    });
  });
});

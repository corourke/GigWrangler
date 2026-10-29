import type { ReactElement } from 'react';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EditMemberDialog from './EditMemberDialog';
import * as organizationService from '../../services/organization.service';
import type { UserRole } from '../../utils/supabase/types';
import type { OrganizationMember } from './useTeamData';

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/organization.service', () => ({
  addExistingUserToOrganization: vi.fn(),
  inviteUserToOrganization: vi.fn(),
  updateMemberDetails: vi.fn(),
  removeMember: vi.fn(),
  cancelInvitation: vi.fn(),
}));

// Radix Select doesn't open under jsdom; render its items flat so the
// offered roles can be read directly.
vi.mock('../ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children, id }: any) => <div data-testid={id}>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ value, children }: any) => <div role="option" aria-selected={false} data-value={value}>{children}</div>,
}));

const member = (role: UserRole): OrganizationMember =>
  ({
    id: 'm-1',
    role,
    default_staff_role_id: null,
    user: { id: 'other', first_name: 'Sam', last_name: 'Roadie', email: 'sam@example.com' },
  }) as unknown as OrganizationMember;

const offeredOrgRoles = () =>
  Array.from(screen.getByTestId('role').parentElement!.querySelectorAll('[role="option"]')).map((o) =>
    o.getAttribute('data-value'),
  );

const renderDialog = (memberRole: UserRole, currentUserRole: UserRole) =>
  render(
    <EditMemberDialog
      open
      onOpenChange={vi.fn()}
      orgId="org-1"
      member={member(memberRole)}
      currentUserId="me"
      currentUserRole={currentUserRole}
      staffRoles={[]}
    />,
  );

describe('EditMemberDialog — Organization Role', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not offer Admin to a Manager', () => {
    renderDialog('Staff', 'Manager');
    expect(offeredOrgRoles()).toEqual(['Manager', 'Staff', 'Viewer']);
  });

  it('offers Admin to an Admin', () => {
    renderDialog('Staff', 'Admin');
    expect(offeredOrgRoles()).toEqual(['Admin', 'Manager', 'Staff', 'Viewer']);
  });

  it("hides an Admin's role from a Manager and leaves it out of the save", async () => {
    vi.mocked(organizationService.updateMemberDetails).mockResolvedValue({} as any);
    renderDialog('Admin', 'Manager');
    expect(screen.queryByTestId('role')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(organizationService.updateMemberDetails).toHaveBeenCalled());
    const data = vi.mocked(organizationService.updateMemberDetails).mock.calls[0][2];
    expect(data.role).toBeUndefined();
  });
});

describe('EditMemberDialog — member with no email (#325)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the email blank and asks for it on save, rather than throwing', async () => {
    const { toast } = await import('sonner');
    const noEmail = { ...member('Staff'), user: { ...member('Staff').user, email: null } } as unknown as OrganizationMember;
    render(
      <EditMemberDialog open onOpenChange={vi.fn()} orgId="org-1" member={noEmail}
        currentUserId="me" currentUserRole="Admin" staffRoles={[]} />,
    );
    expect(screen.getByLabelText(/^Email/)).toHaveValue('');
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Please fill in all required fields'));
    expect(organizationService.updateMemberDetails).not.toHaveBeenCalled();
  });
});

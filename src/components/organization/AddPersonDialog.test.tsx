import type { ReactElement } from 'react';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import AddPersonDialog from './AddPersonDialog';
import * as organizationService from '../../services/organization.service';
import * as userService from '../../services/user.service';
import * as gigParticipantContactsService from '../../services/gigParticipantContacts.service';

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../services/user.service', () => ({
  searchPeople: vi.fn(),
}));

vi.mock('../../services/organization.service', () => ({
  addOrganizationContact: vi.fn(),
  linkExistingPersonToOrganization: vi.fn(),
}));

vi.mock('../../services/gigParticipantContacts.service', () => ({
  addGigParticipantContact: vi.fn(),
  createContactPerson: vi.fn(),
}));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  organizationId: 'org-1',
  organizationName: 'The Venue',
};

describe('AddPersonDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.searchPeople).mockResolvedValue([]);
  });

  it('does not require an email to add a new person (issue #5)', async () => {
    vi.mocked(organizationService.addOrganizationContact).mockResolvedValue({ user_id: 'u1', member: {} } as any);
    render(<AddPersonDialog {...defaultProps} />);

    fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Doe' } });
    fireEvent.click(screen.getByText('Add New Person'));

    await waitFor(() => expect(organizationService.addOrganizationContact).toHaveBeenCalledWith('org-1', {
      firstName: 'Jane',
      lastName: 'Doe',
      email: undefined,
      phone: undefined,
      title: undefined,
      isPrimary: false,
      role: 'Viewer',
    }));
  });

  it('blocks submit when name is missing', async () => {
    render(<AddPersonDialog {...defaultProps} />);

    fireEvent.click(screen.getByText('Add New Person'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('First and last name are required'));
    expect(organizationService.addOrganizationContact).not.toHaveBeenCalled();
  });

  it('searches system-wide for a match — not scoped to the current organization', async () => {
    vi.mocked(userService.searchPeople).mockResolvedValue([
      { id: 'existing-user-1', first_name: 'Jane', last_name: 'Doe', matched_on: 'name' },
    ]);
    vi.mocked(organizationService.linkExistingPersonToOrganization).mockResolvedValue({ user_id: 'existing-user-1', member: {} } as any);

    render(<AddPersonDialog {...defaultProps} />);

    fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Doe' } });

    await waitFor(() => expect(userService.searchPeople).toHaveBeenCalledWith('Jane Doe', { email: '', phone: '' }));
    await waitFor(() => expect(screen.getByText(/Found a possible match/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Use this person'));

    await waitFor(() => expect(organizationService.linkExistingPersonToOrganization).toHaveBeenCalledWith('org-1', {
      userId: 'existing-user-1',
      role: 'Viewer',
      title: undefined,
      isPrimary: false,
    }));
    // Picking an existing person must never also create a duplicate.
    expect(organizationService.addOrganizationContact).not.toHaveBeenCalled();
  });

  it('also looks for a match by phone, and says why it matched (#178)', async () => {
    vi.mocked(userService.searchPeople).mockResolvedValue([
      { id: 'existing-user-1', first_name: 'Jane', last_name: 'Doe', matched_on: 'phone' },
    ]);

    render(<AddPersonDialog {...defaultProps} />);

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '(555) 123-4567' } });

    await waitFor(() => expect(userService.searchPeople).toHaveBeenCalledWith('', { email: '', phone: '(555) 123-4567' }));
    expect(await screen.findByText('same phone')).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('creates a new person anyway when the user ignores a suggested match', async () => {
    vi.mocked(userService.searchPeople).mockResolvedValue([
      { id: 'existing-user-1', first_name: 'Jane', last_name: 'Doe', matched_on: 'name' },
    ]);
    vi.mocked(organizationService.addOrganizationContact).mockResolvedValue({ user_id: 'new-user-1', member: {} } as any);

    render(<AddPersonDialog {...defaultProps} />);

    fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Doe' } });

    await waitFor(() => expect(screen.getByText(/Found a possible match/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('Add New Person'));

    await waitFor(() => expect(organizationService.addOrganizationContact).toHaveBeenCalled());
    expect(organizationService.linkExistingPersonToOrganization).not.toHaveBeenCalled();
  });

  it('hides "set as primary contact" when hasPrimaryContact is not provided (e.g. staffing contexts)', () => {
    render(<AddPersonDialog {...defaultProps} />);
    expect(screen.queryByText('Set as primary contact')).not.toBeInTheDocument();
  });

  it('shows "set as primary contact" when hasPrimaryContact is provided (org-contact contexts)', () => {
    render(<AddPersonDialog {...defaultProps} hasPrimaryContact={false} />);
    expect(screen.getByText('Set as primary contact')).toBeInTheDocument();
  });

  describe('gig-contact mode (gigId provided)', () => {
    const gigProps = { ...defaultProps, gigId: 'gig-1', hasPrimaryContact: true };

    it('always shows the primary-contact option and hides Role, regardless of hasPrimaryContact', () => {
      render(<AddPersonDialog {...gigProps} />);
      expect(screen.getByText('Set as primary contact for this gig')).toBeInTheDocument();
      expect(screen.queryByLabelText('Role')).not.toBeInTheDocument();
    });

    it('creates a new person via createContactPerson + addGigParticipantContact, not org-membership calls', async () => {
      vi.mocked(gigParticipantContactsService.createContactPerson).mockResolvedValue('new-user-1');
      vi.mocked(gigParticipantContactsService.addGigParticipantContact).mockResolvedValue({ id: 'gpc-1', user_id: 'new-user-1' } as any);

      render(<AddPersonDialog {...gigProps} />);

      fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Jane' } });
      fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Doe' } });
      fireEvent.click(screen.getByText('Add New Person'));

      await waitFor(() => expect(gigParticipantContactsService.createContactPerson).toHaveBeenCalledWith({
        firstName: 'Jane',
        lastName: 'Doe',
        email: undefined,
        phone: undefined,
      }));
      expect(gigParticipantContactsService.addGigParticipantContact).toHaveBeenCalledWith('gig-1', 'org-1', expect.objectContaining({ userId: 'new-user-1' }));
      expect(organizationService.addOrganizationContact).not.toHaveBeenCalled();
    });

    it('links an existing match via addGigParticipantContact, not addOrganizationContact/linkExistingPersonToOrganization', async () => {
      vi.mocked(userService.searchPeople).mockResolvedValue([
        { id: 'existing-user-1', first_name: 'Jane', last_name: 'Doe', matched_on: 'name' },
      ]);
      vi.mocked(gigParticipantContactsService.addGigParticipantContact).mockResolvedValue({ id: 'gpc-1', user_id: 'existing-user-1' } as any);

      render(<AddPersonDialog {...gigProps} />);

      fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Jane' } });
      fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Doe' } });

      await waitFor(() => expect(screen.getByText(/Found a possible match/)).toBeInTheDocument());
      fireEvent.click(screen.getByText('Use this person'));

      await waitFor(() => expect(gigParticipantContactsService.addGigParticipantContact).toHaveBeenCalledWith('gig-1', 'org-1', {
        userId: 'existing-user-1',
        isPrimary: false,
        title: undefined,
      }));
      expect(organizationService.addOrganizationContact).not.toHaveBeenCalled();
      expect(organizationService.linkExistingPersonToOrganization).not.toHaveBeenCalled();
    });
  });
});

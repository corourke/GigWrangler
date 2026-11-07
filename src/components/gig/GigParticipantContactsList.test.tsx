import type { ReactElement } from 'react';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import GigParticipantContactsList from './GigParticipantContactsList';
import * as gigParticipantContactsService from '../../services/gigParticipantContacts.service';
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
    error: vi.fn(),
  },
}));

vi.mock('../../services/user.service', () => ({
  searchPeople: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/gigParticipantContacts.service', () => ({
  getGigParticipantContacts: vi.fn(),
  addGigParticipantContact: vi.fn(),
  setGigParticipantContactPrimary: vi.fn(),
  removeGigParticipantContact: vi.fn(),
  createContactPerson: vi.fn(),
}));

vi.mock('../../services/organization.service', () => ({
  addOrganizationContact: vi.fn(),
  linkExistingPersonToOrganization: vi.fn(),
}));

const defaultProps = {
  gigId: 'gig-1',
  organizationId: 'org-1',
  organizationName: 'The Venue',
  addDialogOpen: false,
  onAddDialogOpenChange: vi.fn(),
};

// This is the exact scenario reported: a real, active-status user (not a
// login-less "contact"-status person) was only showing up in the list
// because they were flagged is_primary_contact -- unstarring them must not
// make them disappear.
const REAL_USER_CONTACT_ROW = {
  id: 'gpc-1',
  gig_id: 'gig-1',
  organization_id: 'org-1',
  user_id: 'user-1',
  is_primary_contact: true,
  title: null,
  created_at: '2026-01-01',
  user: { id: 'user-1', first_name: 'Cameron', last_name: 'Orourke', email: 'cam@example.com', phone: null },
};

describe('GigParticipantContactsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a real active-status contact visible after unstarring them (regression)', async () => {
    vi.mocked(gigParticipantContactsService.getGigParticipantContacts).mockResolvedValue([REAL_USER_CONTACT_ROW] as any);
    vi.mocked(gigParticipantContactsService.setGigParticipantContactPrimary).mockResolvedValue(undefined);

    render(<GigParticipantContactsList {...defaultProps} />);

    await waitFor(() => expect(screen.getByText(/Cameron Orourke/)).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Click to unset primary contact for this gig'));

    await waitFor(() => expect(gigParticipantContactsService.setGigParticipantContactPrimary).toHaveBeenCalledWith(
      'gig-1', 'org-1', 'user-1', false,
    ));

    // The row must still be there — the old bug relied on is_primary_contact
    // to even qualify for display, so unstarring silently removed them.
    expect(screen.getByText(/Cameron Orourke/)).toBeInTheDocument();
  });

  it('removing a contact only removes the gig-contact link, not shown as touching org membership', async () => {
    vi.mocked(gigParticipantContactsService.getGigParticipantContacts).mockResolvedValue([REAL_USER_CONTACT_ROW] as any);
    vi.mocked(gigParticipantContactsService.removeGigParticipantContact).mockResolvedValue(undefined);

    render(<GigParticipantContactsList {...defaultProps} />);

    await waitFor(() => expect(screen.getByText(/Cameron Orourke/)).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Remove contact'));
    await waitFor(() => expect(screen.getByText('Remove contact?')).toBeInTheDocument());
    expect(screen.getByText(/does not affect their organization membership/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Remove'));

    await waitFor(() => expect(gigParticipantContactsService.removeGigParticipantContact).toHaveBeenCalledWith(
      'gig-1', 'org-1', 'user-1',
    ));
  });

  it('re-adding a person already linked as a gig contact does not error (upsert, not duplicate)', async () => {
    vi.mocked(gigParticipantContactsService.getGigParticipantContacts).mockResolvedValue([]);
    vi.mocked(userService.searchPeople).mockResolvedValue([
      { id: 'user-1', first_name: 'Cameron', last_name: 'Orourke', matched_on: 'name' },
    ]);
    vi.mocked(gigParticipantContactsService.addGigParticipantContact).mockResolvedValue({ id: 'gpc-1', user_id: 'user-1' } as any);

    render(<GigParticipantContactsList {...defaultProps} addDialogOpen />);

    await waitFor(() => expect(screen.getByLabelText('First Name *')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Cameron' } });

    await waitFor(() => expect(screen.getByText(/Found a possible match/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Use this person'));

    await waitFor(() => expect(gigParticipantContactsService.addGigParticipantContact).toHaveBeenCalledWith(
      'gig-1', 'org-1', expect.objectContaining({ userId: 'user-1' }),
    ));
    expect(toast.error).not.toHaveBeenCalled();
  });

  // #175: an organization Inactive on the gig is read-only on other organizations' contacts.
  it('read-only: no remove, and the primary star is fixed', async () => {
    vi.mocked(gigParticipantContactsService.getGigParticipantContacts).mockResolvedValue([REAL_USER_CONTACT_ROW] as any);

    render(<GigParticipantContactsList {...defaultProps} readOnly />);

    await waitFor(() => expect(screen.getByText(/Cameron Orourke/)).toBeInTheDocument());
    expect(screen.queryByTitle('Remove contact')).not.toBeInTheDocument();
    expect(screen.getByTitle('Primary contact for this gig')).toBeDisabled();
  });
});

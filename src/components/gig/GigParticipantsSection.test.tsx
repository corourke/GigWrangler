import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GigParticipantsSection from './GigParticipantsSection';
import { renderWithQuery } from '../../test/renderWithQuery';
import { getGig, updateGigParticipants } from '../../services/gig.service';
import { useEditSession } from '../../utils/hooks/editSession';
import { EditSessionProvider } from '../../utils/hooks/EditSessionProvider';
import { EditSaveStatus } from './edit/GigEditParts';

// The gig page in edit mode: the section inside the page's edit session, whose save
// state re-renders the page (and so the section) while a save runs.
function InEditSession({ children }: { children: ReactElement }) {
  const session = useEditSession();
  return <EditSessionProvider session={session}><EditSaveStatus state={session.state} />{children}</EditSessionProvider>;
}

// GigParticipantContactsList (rendered per participant row) uses TanStack
// Query, so renders need a QueryClientProvider. retry:false keeps tests
// deterministic and fast.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock('../../services/gig.service', () => ({
  getGig: vi.fn().mockResolvedValue({
    participants: [
      {
        id: 'participant-1',
        organization_id: 'org-1',
        organization_name: 'Test Org',
        role: 'Production',
        notes: 'Test notes',
        is_client: false,
      },
    ],
  }),
  updateGigParticipants: vi.fn().mockResolvedValue({}),
}));

// Radix Select doesn't open in jsdom; a native <select> lets tests pick a role.
vi.mock('../ui/select', () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select aria-label="Role" value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Role</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

vi.mock('../../services/gigParticipant.service', () => ({
  setGigParticipantInactive: vi.fn().mockResolvedValue({ success: true }),
  removeGigParticipant: vi.fn().mockResolvedValue({ success: true }),
}));
import { setGigParticipantInactive, removeGigParticipant } from '../../services/gigParticipant.service';
import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

vi.mock('../../services/organization.service', () => ({
  getOrganizationContacts: vi.fn().mockResolvedValue([]),
}));

// The real OrganizationSelector debounces a network search; stub it with a
// single button that reports a fixed pick, so tests can select an
// organization for a newly-added row deterministically and synchronously.
// Once a selection is made (selectedOrganization is set), just show its name,
// mirroring the real component's compact "selected" display closely enough
// for assertions that look for the organization name on screen.
vi.mock('../OrganizationSelector', () => ({
  default: ({ onSelect, selectedOrganization }: { onSelect: (org: any) => void; selectedOrganization: any }) =>
    selectedOrganization ? (
      <span>{selectedOrganization.name}</span>
    ) : (
      <button
        type="button"
        onClick={() => onSelect({ id: 'org-2', name: 'New Org', roles: ['Production'] })}
      >
        Mock Select Org
      </button>
    ),
}));

describe('GigParticipantsSection', () => {
  const mockProps = {
    userId: 'user-1',
    gigId: 'test-gig-id',
    currentOrganizationId: 'current-org-id',
    currentOrganizationName: 'Current Org',
    currentOrganizationRole: 'Production' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without throwing errors', () => {
    expect(() => {
      render(<GigParticipantsSection {...mockProps} />);
    }).not.toThrow();
  });

  it('displays loading state initially', () => {
    render(<GigParticipantsSection {...mockProps} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('loads and displays participants', async () => {
    render(<GigParticipantsSection {...mockProps} />);
    
    await waitFor(() => {
      expect(screen.getByText('Test Org')).toBeInTheDocument();
    });
  });

  it('renders add participant button', async () => {
    render(<GigParticipantsSection {...mockProps} />);
    
    await waitFor(() => {
      expect(screen.getByText('Add Participant')).toBeInTheDocument();
    });
  });

  it('does not render manual save button', async () => {
    render(<GigParticipantsSection {...mockProps} />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    });
  });

  it('shows the "More actions" menu for a newly added participant without reloading (regression for #28)', async () => {
    render(<GigParticipantsSection {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByText('Test Org')).toBeInTheDocument();
    });

    const before = screen.getAllByTitle('More actions').length;

    fireEvent.click(screen.getByText('Add Participant'));

    // The newly added row renders the (mocked) OrganizationSelector until an
    // organization is picked for it.
    fireEvent.click(await screen.findByText('Mock Select Org'));

    // Picking an organization goes through setValue(), which the fields[]
    // snapshot from useFieldArray does not pick up — only the reactive
    // watch()-derived form values do. The "More actions" menu (and the
    // contact list behind it) should appear right away, not after a reload.
    await waitFor(() => {
      expect(screen.getAllByTitle('More actions')).toHaveLength(before + 1);
    });
  });

  it('reuses the database ids from the first autosave, so later autosaves update rows instead of re-creating them (#69)', async () => {
    const dbIds: Record<string, string> = {
      'current-org-id': '22222222-2222-4222-8222-222222222222',
      'org-2': '33333333-3333-4333-8333-333333333333',
    };
    vi.mocked(updateGigParticipants).mockImplementation(async (_gigId, participants) => ({
      success: true,
      ids: participants.map((p) => p.id ?? dbIds[p.organization_id]),
    }));

    render(<GigParticipantsSection {...mockProps} />);
    await waitFor(() => expect(screen.getByText('Test Org')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Add Participant'));
    fireEvent.click(await screen.findByText('Mock Select Org'));
    const roleSelects = screen.getAllByLabelText('Role');
    fireEvent.change(roleSelects[roleSelects.length - 1], { target: { value: 'Venue' } });

    // First autosave: the new row (and the current-org placeholder) have no database id yet.
    await waitFor(() => expect(updateGigParticipants).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const first = vi.mocked(updateGigParticipants).mock.calls[0][1];
    expect(first.find((p) => p.organization_id === 'org-2')?.id).toBeUndefined();
    // History is logged against the org the user is working as (#103).
    expect(vi.mocked(updateGigParticipants).mock.calls[0][2]).toEqual({
      organization_id: 'current-org-id',
      actor_org_name: 'Current Org',
    });

    // A later edit to the same row (marking it as client) triggers another autosave.
    const stars = screen.getAllByTitle('Mark as client');
    fireEvent.click(stars[stars.length - 1]);

    await waitFor(() => expect(updateGigParticipants).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const second = vi.mocked(updateGigParticipants).mock.calls[1][1];
    expect(second.find((p) => p.organization_id === 'org-2')?.id).toBe(dbIds['org-2']);
    expect(second.find((p) => p.organization_id === 'current-org-id')?.id).toBe(dbIds['current-org-id']);
  });

  it('adds a new participant once, even when the save is slow (#107: four "participant added" entries)', async () => {
    const dbIds: Record<string, string> = {
      'current-org-id': '22222222-2222-4222-8222-222222222222',
      'org-2': '33333333-3333-4333-8333-333333333333',
    };
    // The first save takes a while (the service does several round trips), so
    // the form re-renders and edits arrive while it is still on its way.
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((r) => { releaseFirst = r; });
    vi.mocked(updateGigParticipants).mockImplementation(async (_gigId, participants) => {
      if (vi.mocked(updateGigParticipants).mock.calls.length === 1) await firstDone;
      return { success: true, ids: participants.map((p) => p.id ?? dbIds[p.organization_id]) };
    });

    render(<GigParticipantsSection {...mockProps} />);
    await waitFor(() => expect(screen.getByText('Test Org')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Add Participant'));
    fireEvent.click(await screen.findByText('Mock Select Org'));
    const roleSelects = screen.getAllByLabelText('Role');
    fireEvent.change(roleSelects[roleSelects.length - 1], { target: { value: 'Venue' } });
    await waitFor(() => expect(updateGigParticipants).toHaveBeenCalledTimes(1), { timeout: 3000 });

    // An edit to the new row while the first save is still running.
    const stars = screen.getAllByTitle('Mark as client');
    fireEvent.click(stars[stars.length - 1]);
    await new Promise((r) => setTimeout(r, 2500));

    releaseFirst();
    await new Promise((r) => setTimeout(r, 2500));

    // Only the first save may insert the new row; every later save must carry its database id.
    const calls = vi.mocked(updateGigParticipants).mock.calls.map((c) => c[1]);
    const inserts = calls.filter((rows) => rows.some((p) => p.organization_id === 'org-2' && p.id === undefined));
    expect(inserts).toHaveLength(1);
    expect(calls.at(-1)!.find((p) => p.organization_id === 'org-2')).toMatchObject({ id: dbIds['org-2'], is_client: true });
  }, 15000);

  it('picking the organization and then the role adds the participant once, with no remove (#108 follow-up)', async () => {
    // A stand-in for the real service: rows in a table, a fresh id per insert, and the
    // same added/removed events it logs. Each save takes a while, as the real one does.
    let n = 0;
    const table = [{ id: '11111111-1111-4111-8111-111111111111', organization_id: 'org-1' }];
    const events: string[] = [];
    vi.mocked(getGig).mockResolvedValueOnce({ participants: [{ ...table[0], organization_name: 'Test Org', role: 'Production', notes: '', is_client: false }] } as any);
    vi.mocked(updateGigParticipants).mockImplementation(async (_gigId, participants) => {
      const existing = table.map((r) => r.id);
      await new Promise((r) => setTimeout(r, 800)); // about half of a real save
      const keep = participants.map((p) => p.id).filter(Boolean);
      for (const id of existing.filter((id) => !keep.includes(id))) {
        events.push(`removed ${table.find((r) => r.id === id)!.organization_id}`);
        table.splice(table.findIndex((r) => r.id === id), 1);
      }
      const ids = participants.map((p) => {
        if (p.id && existing.includes(p.id)) return p.id;
        const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
        table.push({ id, organization_id: p.organization_id });
        events.push(`added ${p.organization_id}`);
        return id;
      });
      await new Promise((r) => setTimeout(r, 800)); // about half of a real save
      return { success: true, ids };
    });

    render(<InEditSession><GigParticipantsSection {...mockProps} currentOrganizationId="org-1" currentOrganizationName="Test Org" /></InEditSession>);
    await waitFor(() => expect(screen.getByText('Test Org')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Add Participant'));
    fireEvent.click(await screen.findByText('Mock Select Org'));
    // The role is picked about a second after the organization, as the first save starts.
    await new Promise((r) => setTimeout(r, 900));
    const roleSelects = screen.getAllByLabelText('Role');
    fireEvent.change(roleSelects[roleSelects.length - 1], { target: { value: 'Venue' } });
    await new Promise((r) => setTimeout(r, 8000));

    expect(events).toEqual(['added org-2']);
  }, 30000);
});

describe('GigParticipantsSection deletes only rows it loaded (#92)', () => {
  const MINE = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';
  const NEW = '33333333-3333-4333-8333-333333333333';
  const props = {
    userId: 'user-1',
    gigId: 'test-gig-id',
    currentOrganizationId: 'org-1',
    currentOrganizationName: 'Test Org',
    currentOrganizationRole: 'Production' as const,
  };
  const calls = () => vi.mocked(updateGigParticipants).mock.calls;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGig).mockResolvedValue({
      participants: [
        { id: MINE, organization_id: 'org-1', organization_name: 'Test Org', role: 'Production', notes: '', is_client: false },
        { id: OTHER, organization_id: 'org-3', organization_name: 'Venue Co', role: 'Venue', notes: '', is_client: false },
      ],
    } as any);
    vi.mocked(updateGigParticipants).mockImplementation(async (_gigId, participants) => ({
      success: true,
      ids: participants.map((p) => p.id ?? NEW),
    }));
  });

  // #175: a saved organization is removed right away (removeGigParticipant), and the
  // section's later saves don't try to delete it again.
  it('removes a saved organization right away, and later saves leave it out of the rows to delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GigParticipantsSection {...props} />);
    await waitFor(() => expect(screen.getByText('Venue Co')).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle('Remove participant')[1]);

    await waitFor(() => expect(removeGigParticipant).toHaveBeenCalledWith('test-gig-id', 'org-3'));
    await waitFor(() => expect(screen.queryByText('Venue Co')).not.toBeInTheDocument());
    // A save after the removal (if any) must not list the removed row among those it loaded.
    for (const call of calls()) expect(call[3]).not.toContain(OTHER);
  });

  it('removes a row it added on an earlier save right away too', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GigParticipantsSection {...props} />);
    await waitFor(() => expect(screen.getByText('Venue Co')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Add Participant'));
    fireEvent.click(await screen.findByText('Mock Select Org'));
    const roleSelects = screen.getAllByLabelText('Role');
    fireEvent.change(roleSelects[roleSelects.length - 1], { target: { value: 'Act' } });
    await waitFor(() => expect(updateGigParticipants).toHaveBeenCalledTimes(1), { timeout: 3000 });

    const removes = screen.getAllByTitle('Remove participant');
    fireEvent.click(removes[removes.length - 1]);

    await waitFor(() => expect(removeGigParticipant).toHaveBeenCalledWith('test-gig-id', 'org-2'));
  });

  // Coordinator follow-up: the service compares each row with what this section loaded or
  // last saved, so it sends only what the user changed.
  it('passes what it loaded, then what it saved, as the rows to compare with', async () => {
    render(<GigParticipantsSection {...props} />);
    await waitFor(() => expect(screen.getByText('Venue Co')).toBeInTheDocument());
    fireEvent.change(screen.getAllByLabelText('Role')[0], { target: { value: 'Sound' } });
    await waitFor(() => expect(updateGigParticipants).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(calls()[0][4]).toEqual([
      { id: MINE, role: 'Production', notes: null, is_client: false },
      { id: OTHER, role: 'Venue', notes: null, is_client: false },
    ]);

    fireEvent.change(screen.getAllByLabelText('Role')[1], { target: { value: 'Act' } });
    await waitFor(() => expect(updateGigParticipants).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(calls()[1][4]).toEqual([
      { id: MINE, role: 'Sound', notes: null, is_client: false },
      { id: OTHER, role: 'Venue', notes: null, is_client: false },
    ]);
  });

  it('drops a row that was never saved without asking the database', async () => {
    render(<GigParticipantsSection {...props} />);
    await waitFor(() => expect(screen.getByText('Venue Co')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Add Participant'));
    const removes = screen.getAllByTitle('Remove participant');
    fireEvent.click(removes[removes.length - 1]);
    expect(removeGigParticipant).not.toHaveBeenCalled();
    expect(screen.queryByText('Mock Select Org')).not.toBeInTheDocument();
  });
});

// #175: the owner is marked; an organization can be Inactive on the gig (the owner's Admins and
// Managers, or its own, toggle it; never the owner). While the user's organization is
// Inactive, the gig's participants are read-only to it.
describe('GigParticipantsSection: owner and Inactive (#175)', () => {
  const UUID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const gig = (inactiveB = false, inactiveO = false) => ({
    owner_organization_id: 'org-o',
    participants: [
      { id: UUID(1), organization_id: 'org-o', role: 'Production', notes: '', is_client: false, inactive: inactiveO, organization: { id: 'org-o', name: 'Owner Co' } },
      { id: UUID(2), organization_id: 'org-b', role: 'Sound', notes: '', is_client: false, inactive: inactiveB, organization: { id: 'org-b', name: 'Sound Co' } },
    ],
  });
  const props = (orgId: string, orgName: string, userRole = 'Manager') => ({
    userId: 'user-1',
    gigId: 'g1', currentOrganizationId: orgId, currentOrganizationName: orgName,
    currentOrganizationRole: 'Production' as const, userRole,
  });
  const rowOf = (name: string) => screen.getByText(name).closest('.py-2') as HTMLElement;
  const openMenu = async (name: string) => {
    const user = userEvent.setup();
    await user.click(within(rowOf(name)).getByTitle('More actions'));
    return user;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it("marks the owner's row and an Inactive row", async () => {
    vi.mocked(getGig).mockResolvedValue(gig(true) as any);
    render(<GigParticipantsSection {...props('org-o', 'Owner Co')} />);
    await screen.findByText('Sound Co');
    expect(within(rowOf('Owner Co')).getByText('Owner')).toBeInTheDocument();
    expect(within(rowOf('Sound Co')).getByText('Inactive')).toBeInTheDocument();
    expect(within(rowOf('Owner Co')).queryByText('Inactive')).not.toBeInTheDocument();
  });

  it("lets the owner's Manager mark another organization Inactive", async () => {
    vi.mocked(getGig).mockResolvedValue(gig() as any);
    render(<GigParticipantsSection {...props('org-o', 'Owner Co')} />);
    await screen.findByText('Sound Co');
    const user = await openMenu('Sound Co');
    await user.click(await screen.findByRole('menuitem', { name: /Mark Inactive/ }));
    await waitFor(() => expect(setGigParticipantInactive).toHaveBeenCalledWith('g1', 'org-b', true));
    expect(await within(rowOf('Sound Co')).findByText('Inactive')).toBeInTheDocument();
  });

  it("offers Reactivate on an Inactive organization's row", async () => {
    vi.mocked(getGig).mockResolvedValue(gig(true) as any);
    render(<GigParticipantsSection {...props('org-o', 'Owner Co')} />);
    await screen.findByText('Sound Co');
    const user = await openMenu('Sound Co');
    await user.click(await screen.findByRole('menuitem', { name: /Reactivate/ }));
    await waitFor(() => expect(setGigParticipantInactive).toHaveBeenCalledWith('g1', 'org-b', false));
  });

  it("never offers Mark Inactive on the owner's row", async () => {
    vi.mocked(getGig).mockResolvedValue(gig() as any);
    render(<GigParticipantsSection {...props('org-o', 'Owner Co')} />);
    await screen.findByText('Sound Co');
    await openMenu('Owner Co');
    expect(await screen.findByRole('menuitem', { name: /View Organization/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Mark Inactive/ })).not.toBeInTheDocument();
  });

  it("doesn't let a third organization mark another Inactive, nor the organization's Staff", async () => {
    vi.mocked(getGig).mockResolvedValue(gig() as any);
    render(<GigParticipantsSection {...props('org-o', 'Owner Co', 'Staff')} />);
    await screen.findByText('Sound Co');
    await openMenu('Sound Co');
    expect(await screen.findByRole('menuitem', { name: /View Organization/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Mark Inactive/ })).not.toBeInTheDocument();
  });

  it('makes the participants read-only while my organization is Inactive', async () => {
    vi.mocked(getGig).mockResolvedValue(gig(true) as any);
    render(<GigParticipantsSection {...props('org-b', 'Sound Co')} />);
    await screen.findByText('Owner Co');
    expect(screen.queryByText('Add Participant')).not.toBeInTheDocument();
    for (const select of screen.getAllByRole('combobox', { name: 'Role' })) expect(select).toBeDisabled();
    for (const button of screen.queryAllByTitle('Remove participant')) expect(button).toBeDisabled();
  });

  it('lets my Inactive organization reactivate itself from its own row', async () => {
    vi.mocked(getGig).mockResolvedValue(gig(true) as any);
    render(<GigParticipantsSection {...props('org-b', 'Sound Co')} />);
    await screen.findByText('Owner Co');
    const user = await openMenu('Sound Co');
    await user.click(await screen.findByRole('menuitem', { name: /Reactivate/ }));
    await waitFor(() => expect(setGigParticipantInactive).toHaveBeenCalledWith('g1', 'org-b', false));
  });

  it("doesn't offer Notes or Add Contact on another organization's row while mine is Inactive", async () => {
    vi.mocked(getGig).mockResolvedValue(gig(true) as any);
    render(<GigParticipantsSection {...props('org-b', 'Sound Co')} />);
    await screen.findByText('Owner Co');
    await openMenu('Owner Co');
    expect(await screen.findByRole('menuitem', { name: /View Organization/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Add Contact/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Notes/ })).not.toBeInTheDocument();
  });

  // Cameron 10-13: while Inactive, an organization keeps only its financials and notes.
  it('offers Notes on my own row while Inactive, but not Add Contact', async () => {
    vi.mocked(getGig).mockResolvedValue(gig(true) as any);
    render(<GigParticipantsSection {...props('org-b', 'Sound Co')} />);
    await screen.findByText('Owner Co');
    await openMenu('Sound Co');
    expect(await screen.findByRole('menuitem', { name: /Notes/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Add Contact/ })).not.toBeInTheDocument();
  });

  it("explains what Mark Inactive means before marking another organization", async () => {
    vi.mocked(getGig).mockResolvedValue(gig() as any);
    render(<GigParticipantsSection {...props('org-o', 'Owner Co')} />);
    await screen.findByText('Sound Co');
    const user = await openMenu('Sound Co');
    await user.click(await screen.findByRole('menuitem', { name: /Mark Inactive/ }));
    const asked = vi.mocked(window.confirm).mock.calls.at(-1)?.[0] as string;
    expect(asked).toMatch(/being removed from the gig/);
    expect(asked).toMatch(/Release its staff and equipment first/);
  });

  // #175 (Cameron 10-13): Remove runs right away, behind a confirmation.
  it('removes a saved organization right away, after confirming', async () => {
    vi.mocked(getGig).mockResolvedValue(gig() as any);
    render(<GigParticipantsSection {...props('org-o', 'Owner Co')} />);
    await screen.findByText('Sound Co');
    fireEvent.click(within(rowOf('Sound Co')).getByTitle('Remove participant'));
    await waitFor(() => expect(removeGigParticipant).toHaveBeenCalledWith('g1', 'org-b'));
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toMatch(/Remove Sound Co from this gig/);
    await waitFor(() => expect(screen.queryByText('Sound Co')).not.toBeInTheDocument());
    expect(updateGigParticipants).not.toHaveBeenCalled();
  });

  it("removes nothing when the confirmation is declined", async () => {
    vi.mocked(getGig).mockResolvedValue(gig() as any);
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<GigParticipantsSection {...props('org-o', 'Owner Co')} />);
    await screen.findByText('Sound Co');
    fireEvent.click(within(rowOf('Sound Co')).getByTitle('Remove participant'));
    expect(removeGigParticipant).not.toHaveBeenCalled();
    expect(screen.getByText('Sound Co')).toBeInTheDocument();
  });

  it("keeps the row and offers Mark Inactive when the database refuses for the organization's financial records", async () => {
    vi.mocked(getGig).mockResolvedValue(gig() as any);
    vi.mocked(removeGigParticipant).mockRejectedValueOnce(new Error("This organization has financial records on the gig, so it can't be removed. Mark it Inactive instead."));
    render(<GigParticipantsSection {...props('org-o', 'Owner Co')} />);
    await screen.findByText('Sound Co');
    fireEvent.click(within(rowOf('Sound Co')).getByTitle('Remove participant'));
    await waitFor(() => expect(setGigParticipantInactive).toHaveBeenCalledWith('g1', 'org-b', true));
    expect(screen.getByText('Sound Co')).toBeInTheDocument();
  });

  it.each([
    ['it has staff or equipment on the gig', false, "This organization has staff or equipment on the gig, so it can't be removed. Release its staff and equipment, then mark it Inactive."],
    ['it already is', true, "This organization has financial records on the gig, so it can't be removed; it stays Inactive to keep them."],
  ])("doesn't offer Mark Inactive when %s", async (_why, inactiveB, message) => {
    vi.mocked(getGig).mockResolvedValue(gig(inactiveB) as any);
    vi.mocked(removeGigParticipant).mockRejectedValueOnce(new Error(message));
    render(<GigParticipantsSection {...props('org-o', 'Owner Co')} />);
    await screen.findByText('Sound Co');
    fireEvent.click(within(rowOf('Sound Co')).getByTitle('Remove participant'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(setGigParticipantInactive).not.toHaveBeenCalled();
    expect(screen.getByText('Sound Co')).toBeInTheDocument();
  });

  it("doesn't offer Mark Inactive on an already Inactive row, even if a message suggests it", async () => {
    vi.mocked(getGig).mockResolvedValue(gig(true) as any);
    vi.mocked(removeGigParticipant).mockRejectedValueOnce(new Error("This organization has financial records on the gig, so it can't be removed. Mark it Inactive instead."));
    render(<GigParticipantsSection {...props('org-o', 'Owner Co')} />);
    await screen.findByText('Sound Co');
    fireEvent.click(within(rowOf('Sound Co')).getByTitle('Remove participant'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(setGigParticipantInactive).not.toHaveBeenCalled();
  });

  it("doesn't offer removal on the owner's row", async () => {
    vi.mocked(getGig).mockResolvedValue(gig() as any);
    render(<GigParticipantsSection {...props('org-b', 'Sound Co')} />);
    await screen.findByText('Owner Co');
    expect(within(rowOf('Owner Co')).getByTitle('Remove participant')).toBeDisabled();
  });
});

// A10: how the participants section loads, fails and follows the gig. These hold before and
// after the move to react-query.
describe('GigParticipantsSection: data loading (A10)', () => {
  const props = { userId: 'user-1', gigId: 'test-gig-id', currentOrganizationId: 'current-org-id', currentOrganizationName: 'Current Org', currentOrganizationRole: 'Production' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGig).mockImplementation(async (id: string) => ({
      participants: [{ id: `p-${id}`, organization_id: `org-${id}`, organization_name: id === 'gig-2' ? 'Second Venue' : 'Test Org', role: 'Venue', notes: '', is_client: false }],
    }) as any);
  });

  it('says the participants failed to load, and still shows this organization', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getGig).mockRejectedValueOnce(new Error('down'));
    renderWithQuery(<GigParticipantsSection {...props} />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load participants'));
    expect(await screen.findByText('Current Org')).toBeInTheDocument();
  });

  it("loads the other gig's participants when the gig changes", async () => {
    const { rerender } = renderWithQuery(<GigParticipantsSection {...props} />);
    expect(await screen.findByText('Test Org')).toBeInTheDocument();
    rerender(<GigParticipantsSection {...props} gigId="gig-2" />);
    expect(await screen.findByText('Second Venue')).toBeInTheDocument();
    expect(getGig).toHaveBeenCalledWith('gig-2');
  });
});

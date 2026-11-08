import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import GigPage from './GigPage';
import { getGig, updateGig } from '../../services/gig.service';

vi.mock('../AppHeader', () => ({ default: () => <div data-testid="app-header" /> }));
vi.mock('../AttachmentManager', () => ({ default: () => <div data-testid="attachments" /> }));
vi.mock('../ActivityFeed', () => ({ default: () => <div data-testid="activity" /> }));
vi.mock('../ConflictWarning', () => ({ ConflictWarning: () => null }));
vi.mock('./useGigParticipantContacts', () => ({ useGigParticipantContacts: () => ({ data: [] }) }));
// The schedule editor stand-in reports to the page's edit session like the real one,
// with a save state and flush each test controls.
const schedule = vi.hoisted(() => ({
  state: 'idle' as 'idle' | 'saving' | 'saved' | 'error',
  flush: () => Promise.resolve(),
  props: null as any,
}));
vi.mock('./GigScheduleEditor', async () => {
  const { useReportToEditSession } = await import('../../utils/hooks/editSession');
  function ScheduleEditorStandIn(props: any) {
    schedule.props = props;
    useReportToEditSession(schedule.state, () => schedule.flush());
    return <div data-testid="edit-schedule" />;
  }
  return { default: ScheduleEditorStandIn };
});
vi.mock('./print/GigPrintSheet', () => ({
  default: function PrintSheetStandIn({ includeFinancials, onReady }: { includeFinancials: boolean; onReady: () => void }) {
    useEffect(() => { onReady(); }, [onReady]);
    return <div data-testid="print-sheet" data-financials={String(includeFinancials)} />;
  },
}));
vi.mock('../inventory/InventoryReports', async () => {
  const { useEffect } = await import('react');
  return {
    PackingList: ({ gig, onLoaded, hidePrintButton, columns, onColumnsChange }: any) => {
      useEffect(() => { onLoaded?.(); }, [onLoaded]);
      return (
        <div data-testid={onLoaded ? 'packing-print' : 'packing-list'} data-gig={gig.id} data-hide-print={String(!!hidePrintButton)}
          data-columns={columns ? [...columns].sort().join(',') : ''}>
          {!onLoaded && onColumnsChange && <button onClick={() => onColumnsChange(new Set(['status']))}>Only status</button>}
        </div>
      );
    },
  };
});
vi.mock('./GigParticipantsSection', () => ({ default: () => <div data-testid="edit-participants" /> }));
vi.mock('./GigStaffSlotsSection', () => ({ default: () => <div data-testid="edit-staffing" /> }));
vi.mock('./GigKitAssignmentsSection', () => ({ default: () => <div data-testid="edit-equipment" /> }));
vi.mock('./GigFinancialsSection', () => ({ default: ({ editing }: { editing?: boolean }) => <div data-testid="financials" data-editing={String(editing)} /> }));
vi.mock('../../services/activityLog.service', () => ({ getGigActivity: vi.fn().mockResolvedValue([]) }));
vi.mock('../../services/conflictDetection.service', () => ({ checkAllConflicts: vi.fn().mockResolvedValue({ conflicts: [] }) }));
vi.mock('./NotReturnedSection', () => ({ default: () => null }));
vi.mock('./EquipmentNeededTable', () => ({ default: ({ gigId }: { gigId: string }) => <div data-testid="equipment-needed" data-gig={gigId} /> }));

const gig = {
  id: 'g1', title: 'Riverside Summer Series', status: 'Booked', start: '2026-07-12T19:00:00Z', end: '2026-07-13T06:30:00Z',
  timezone: 'America/Los_Angeles', tags: ['Outdoor'], notes: 'Crew parking in Lot C',
  // Owned by the organization the user works as (#175).
  owner_organization_id: 'org-1',
  participants: [
    { id: 'p1', role: 'Venue', organization_id: 'o-venue', organization: { id: 'o-venue', name: 'Riverside Amphitheater', address_line1: '1200 Waterfront Dr', city: 'Portland', state: 'OR' } },
    { id: 'p0', role: 'Sound', organization_id: 'org-1', inactive: false, organization: { id: 'org-1', name: 'Northwest Sound Co' } },
  ],
  schedule_entries: [{ id: 's1', activity_type: 'Load-In', label: null, start_time: '2026-07-12T19:00:00Z', end_time: null, act_participant_id: null, notes: 'Dock B' }],
  staff_slots: [{ id: 'sl1', organization_id: 'org-1', role: 'A1 Audio Engineer', count: 1,
    staff_assignments: [{ id: 'a1', user_id: 'u1', status: 'Confirmed', fee: 450, user: { first_name: 'Jordan', last_name: 'Lee', phone: '555-0121', email: 'j@example.com' } }] }],
};

vi.mock('../../services/gig.service', () => ({
  getGig: vi.fn(() => Promise.resolve(gig)),
  updateGig: vi.fn().mockResolvedValue({}),
  getGigKits: vi.fn().mockResolvedValue([]),
  deleteGig: vi.fn(),
  duplicateGig: vi.fn(),
  countChildGigs: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../services/gigParticipant.service', () => ({
  setGigParticipantInactive: vi.fn().mockResolvedValue({ success: true }),
  removeGigParticipant: vi.fn().mockResolvedValue({ success: true }),
}));
import { setGigParticipantInactive, removeGigParticipant } from '../../services/gigParticipant.service';
import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const baseProps = {
  gigId: 'g1',
  organization: { id: 'org-1', name: 'Northwest Sound Co', roles: ['Sound'] } as any,
  user: { id: 'u-me' } as any,
  onBack: vi.fn(), onGigDeleted: vi.fn(), onSwitchOrganization: vi.fn(), onLogout: vi.fn(),
};

describe('GigPage (#12)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    schedule.state = 'idle';
    schedule.flush = () => Promise.resolve();
    vi.mocked(getGig).mockImplementation(() => Promise.resolve(gig as any));
  });

  it('checks conflicts in the gig\'s own timezone (#184)', async () => {
    const { checkAllConflicts } = await import('../../services/conflictDetection.service');
    render(<GigPage {...baseProps} />);
    await waitFor(() => expect(checkAllConflicts).toHaveBeenCalledWith('g1', gig.start, gig.end, 'America/Los_Angeles', 'org-1'));
  });

  it('shows the overview in the agreed order, read-only', async () => {
    render(<GigPage {...baseProps} userRole="Admin" />);
    await screen.findByText('Riverside Summer Series');
    const names = ['Schedule', 'Venue', 'Notes & attachments', 'Participants', 'Staffing'];
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => names.find((n) => h.textContent?.startsWith(n)));
    expect(headings).toEqual(names);
    expect(screen.getByText('1200 Waterfront Dr')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-staffing')).not.toBeInTheDocument();
  });

  it('renders the notes as Markdown on the overview, without raw HTML (#169)', async () => {
    vi.mocked(getGig).mockResolvedValue({
      ...gig, notes: '**Load in** at noon\n\n- Dock B\n- Lot C\n\n<img src="x" onerror="alert(1)">',
    } as any);
    render(<GigPage {...baseProps} userRole="Admin" />);
    const notes = await screen.findByRole('heading', { name: 'Notes & attachments' });
    const card = notes.closest('[data-slot="card"]') as HTMLElement;
    expect(within(card).getByText('Load in').tagName).toBe('STRONG');
    expect(within(card).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Dock B', 'Lot C']);
    expect(card.querySelector('img')).toBeNull();
    expect(card.textContent).not.toContain('**');
  });

  it('gives Admins one Edit for the whole gig, then Done', async () => {
    render(<GigPage {...baseProps} userRole="Admin" />);
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }));
    expect(await screen.findByRole('textbox', { name: 'Gig title' })).toBeInTheDocument();
    expect(screen.getByTestId('edit-staffing')).toBeInTheDocument();
    expect(screen.getByTestId('edit-participants')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Gig title' })).not.toBeInTheDocument());
  });

  // #175: deleting a gig is Admin-only on the server, so Managers aren't offered it.
  // #175 (Cameron 10-13): Delete Gig stays in the menu; when the delete would be refused it's
  // disabled, and selecting it (mouse, keyboard or touch) shows the reason instead.
  describe('Delete Gig in the More actions menu (#175)', () => {
    const open = async (role: 'Admin' | 'Manager', g: any = gig) => {
      vi.mocked(getGig).mockResolvedValue(g);
      const user = userEvent.setup();
      render(<GigPage {...baseProps} userRole={role} />);
      await user.click(await screen.findByRole('button', { name: 'More actions' }));
      return { user, item: await screen.findByRole('menuitem', { name: /Delete Gig/ }) };
    };

    it("deletes for the owner's Admin when nothing is in the way", async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { deleteGig } = await import('../../services/gig.service');
      const { user, item } = await open('Admin');
      expect(item).not.toHaveAttribute('aria-disabled', 'true');
      await user.click(item);
      await waitFor(() => expect(deleteGig).toHaveBeenCalledWith('g1'));
    });

    it("is disabled for the owner's Manager, with the reason shown on selecting it", async () => {
      const { deleteGig } = await import('../../services/gig.service');
      const { user, item } = await open('Manager');
      expect(item).toHaveAttribute('aria-disabled', 'true');
      await user.click(item);
      expect(await screen.findByText("Only an Admin of the gig's owner organization can delete it.")).toBeInTheDocument();
      expect(deleteGig).not.toHaveBeenCalled();
    });

    it('is disabled when another claimed organization is on the gig', async () => {
      const withOther = {
        ...gig,
        participants: [...gig.participants, { id: 'p9', role: 'Act', organization_id: 'o-act', organization: { id: 'o-act', name: 'The Act', claimed: true } }],
      };
      const { user, item } = await open('Admin', withOther);
      expect(item).toHaveAttribute('aria-disabled', 'true');
      await user.click(item);
      expect(await screen.findByText('Delete gig is disabled as there are other claimed organizations participating -- you can Cancel the gig instead.')).toBeInTheDocument();
    });

    it('is disabled when the gig has child gigs', async () => {
      const { countChildGigs } = await import('../../services/gig.service');
      vi.mocked(countChildGigs).mockResolvedValue(2);
      const { user, item } = await open('Admin');
      await waitFor(() => expect(item).toHaveAttribute('aria-disabled', 'true'));
      await user.click(item);
      expect(await screen.findByText(/this gig has child gigs/)).toBeInTheDocument();
    });

    it('no longer offers Cancel Gig (the owner sets the status instead)', async () => {
      await open('Admin');
      expect(screen.queryByRole('menuitem', { name: /Cancel Gig/ })).not.toBeInTheDocument();
    });
  });

  // #175: every gig has an owner organization. Its Admins and Managers alone change the
  // status and duplicate it; an organization Inactive on the gig is read-only on shared details.
  describe('the gig owner (#175)', () => {
    const ownedByVenue = { ...gig, owner_organization_id: 'o-venue' };
    const inactive = {
      ...ownedByVenue,
      participants: gig.participants.map((p) => (p.organization_id === 'org-1' ? { ...p, inactive: true } : p)),
    };

    it('names the owner in the header', async () => {
      vi.mocked(getGig).mockResolvedValue(ownedByVenue as any);
      render(<GigPage {...baseProps} userRole="Admin" />);
      expect(await screen.findByText('Owned by Riverside Amphitheater')).toBeInTheDocument();
    });

    it("doesn't offer Duplicate to an Admin of another participant", async () => {
      vi.mocked(getGig).mockResolvedValue(ownedByVenue as any);
      const user = userEvent.setup();
      render(<GigPage {...baseProps} userRole="Admin" />);
      await user.click(await screen.findByRole('button', { name: 'More actions' }));
      expect(screen.queryByRole('menuitem', { name: /Duplicate Gig/ })).not.toBeInTheDocument();
    });

    it("shows the status read-only to another participant's Admin while editing", async () => {
      vi.mocked(getGig).mockResolvedValue(ownedByVenue as any);
      render(<GigPage {...baseProps} userRole="Admin" initialEditing />);
      await screen.findByRole('textbox', { name: 'Gig title' });
      expect(screen.getByRole('combobox', { name: 'Status' })).toBeDisabled();
      expect(screen.getByRole('textbox', { name: 'Gig title' })).toBeEnabled();
    });

    it("lets the owner's Manager change the status", async () => {
      render(<GigPage {...baseProps} userRole="Manager" initialEditing />);
      await screen.findByRole('textbox', { name: 'Gig title' });
      expect(screen.getByRole('combobox', { name: 'Status' })).toBeEnabled();
    });

    it('tells an Inactive organization so, and makes the shared details read-only', async () => {
      vi.mocked(getGig).mockResolvedValue(inactive as any);
      render(<GigPage {...baseProps} userRole="Manager" initialEditing />);
      // Cameron 10-13: Inactive means being removed.
      expect(await screen.findByText(
        'Northwest Sound Co is Inactive on this gig: it is being removed. Its financial records and notes are kept; everything else is read-only.',
      )).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Gig title' })).toBeDisabled();
    });

    it('keeps staff and equipment read-only while Inactive, saying why', async () => {
      vi.mocked(getGig).mockResolvedValue(inactive as any);
      render(<GigPage {...baseProps} userRole="Manager" initialEditing />);
      await screen.findByRole('textbox', { name: 'Gig title' });
      const why = 'Staff and equipment are read-only while Northwest Sound Co is Inactive on this gig.';
      expect(screen.queryByTestId('edit-staffing')).not.toBeInTheDocument();
      expect(screen.getByText(why)).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Equipment' }));
      await waitFor(() => expect(screen.queryByTestId('edit-equipment')).not.toBeInTheDocument());
      expect(screen.getAllByText(why).length).toBeGreaterThan(0);
    });

    it('lets the Inactive organization reactivate itself from the banner', async () => {
      vi.mocked(getGig).mockResolvedValue(inactive as any);
      const user = userEvent.setup();
      render(<GigPage {...baseProps} userRole="Manager" />);
      await user.click(await screen.findByRole('button', { name: 'Reactivate' }));
      await waitFor(() => expect(setGigParticipantInactive).toHaveBeenCalledWith('g1', 'org-1', false));
    });

    it("doesn't offer Reactivate to the organization's Staff", async () => {
      vi.mocked(getGig).mockResolvedValue(inactive as any);
      render(<GigPage {...baseProps} userRole="Staff" />);
      expect(await screen.findByText(/Northwest Sound Co is Inactive on this gig/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
    });
  });

  // #175: the owner cancels a gig; another participant leaves it, or marks itself Inactive.
  describe('Leave and Mark Inactive in the More actions menu (#175)', () => {
    const ownedByVenue = { ...gig, owner_organization_id: 'o-venue' };
    const open = async (role: 'Admin' | 'Manager' | 'Staff') => {
      const user = userEvent.setup();
      render(<GigPage {...baseProps} userRole={role} />);
      await user.click(await screen.findByRole('button', { name: 'More actions' }));
      return user;
    };
    beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); });

    it("doesn't offer Leave or Mark Inactive to the owner", async () => {
      await open('Admin');
      await screen.findByRole('menuitem', { name: /Duplicate Gig/ });
      expect(screen.queryByRole('menuitem', { name: /Leave Gig/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Mark Inactive/ })).not.toBeInTheDocument();
    });

    it('lets another participant leave the gig, and goes back', async () => {
      vi.mocked(getGig).mockResolvedValue(ownedByVenue as any);
      const user = await open('Manager');
      await user.click(await screen.findByRole('menuitem', { name: /Leave Gig/ }));
      await waitFor(() => expect(removeGigParticipant).toHaveBeenCalledWith('g1', 'org-1'));
      await waitFor(() => expect(baseProps.onBack).toHaveBeenCalled());
    });

    it('offers to mark Inactive instead when the organization has financial records on the gig', async () => {
      vi.mocked(getGig).mockResolvedValue(ownedByVenue as any);
      vi.mocked(removeGigParticipant).mockRejectedValueOnce(new Error("This organization has financial records on the gig, so it can't be removed. Mark it Inactive instead."));
      const confirmSpy = vi.mocked(window.confirm);
      const user = await open('Manager');
      await user.click(await screen.findByRole('menuitem', { name: /Leave Gig/ }));
      await waitFor(() => expect(setGigParticipantInactive).toHaveBeenCalledWith('g1', 'org-1', true));
      expect(confirmSpy.mock.calls.at(-1)?.[0]).toMatch(/Mark it Inactive instead[\s\S]*Mark Northwest Sound Co Inactive\?/);
      expect(baseProps.onBack).not.toHaveBeenCalled();
    });

    it("doesn't offer Mark Inactive while the organization has staff or equipment on the gig: it says to release them", async () => {
      vi.mocked(getGig).mockResolvedValue(ownedByVenue as any);
      vi.mocked(removeGigParticipant).mockRejectedValueOnce(new Error("This organization has staff or equipment on the gig, so it can't be removed. Release its staff and equipment, then mark it Inactive."));
      const confirmSpy = vi.mocked(window.confirm);
      const user = await open('Manager');
      await user.click(await screen.findByRole('menuitem', { name: /Leave Gig/ }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This organization has staff or equipment on the gig, so it can't be removed. Release its staff and equipment, then mark it Inactive."));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(setGigParticipantInactive).not.toHaveBeenCalled();
    });

    it("doesn't offer Mark Inactive when the organization already is", async () => {
      vi.mocked(getGig).mockResolvedValue({
        ...ownedByVenue,
        participants: gig.participants.map((p) => (p.organization_id === 'org-1' ? { ...p, inactive: true } : p)),
      } as any);
      vi.mocked(removeGigParticipant).mockRejectedValueOnce(new Error("This organization has financial records on the gig, so it can't be removed. Mark it Inactive instead."));
      const confirmSpy = vi.mocked(window.confirm);
      const user = await open('Manager');
      await user.click(await screen.findByRole('menuitem', { name: /Leave Gig/ }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This organization has financial records on the gig, so it can't be removed. Mark it Inactive instead."));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(setGigParticipantInactive).not.toHaveBeenCalled();
    });

    it('lets another participant mark itself Inactive, saying what that means', async () => {
      vi.mocked(getGig).mockResolvedValue(ownedByVenue as any);
      const user = await open('Admin');
      await user.click(await screen.findByRole('menuitem', { name: /Mark Inactive/ }));
      await waitFor(() => expect(setGigParticipantInactive).toHaveBeenCalledWith('g1', 'org-1', true));
      const asked = vi.mocked(window.confirm).mock.calls.at(-1)?.[0] as string;
      expect(asked).toMatch(/being removed from the gig/);
      expect(asked).toMatch(/financial records and notes are kept/);
      expect(asked).toMatch(/Release its staff and equipment first/);
    });
  });

  describe('page header (#39)', () => {
    it('puts Back in the header slot, named for where it goes', async () => {
      const onBack = vi.fn();
      render(<GigPage {...baseProps} onBack={onBack} userRole="Manager" />);
      await screen.findByText('Riverside Summer Series');
      const back = within(screen.getByTestId('page-header-slot')).getByRole('button', { name: 'Back to Gigs' });
      fireEvent.click(back);
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('names Back for the calendar when the gig was opened from it', async () => {
      render(<GigPage {...baseProps} userRole="Manager" backLabel="Calendar" />);
      await screen.findByText('Riverside Summer Series');
      expect(screen.getByRole('button', { name: 'Back to Calendar' })).toBeInTheDocument();
    });

    it('keeps the title row first in edit mode: the Editing label is not above the title', async () => {
      render(<GigPage {...baseProps} userRole="Admin" initialEditing />);
      const title = await screen.findByRole('textbox', { name: 'Gig title' });
      const row = screen.getByTestId('page-header-title-row');
      expect(row).toContainElement(title);
      expect(row).toContainElement(screen.getByText('Editing'));
    });

    it('puts the gig tabs in the header, below the title', async () => {
      render(<GigPage {...baseProps} userRole="Manager" />);
      const heading = await screen.findByRole('heading', { level: 1, name: 'Riverside Summer Series' });
      const tablist = screen.getByRole('tablist', { name: 'Gig sections' });
      expect(heading.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it('opens on the tab the URL names, and reports tab changes to the URL', async () => {
    const onTabChange = vi.fn();
    render(<GigPage {...baseProps} userRole="Manager" tab="financials" onTabChange={onTabChange} />);
    expect(await screen.findByTestId('financials')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'History' }));
    expect(onTabChange).toHaveBeenCalledWith('history');
  });

  it('drives the Financials tab from the page edit mode', async () => {
    render(<GigPage {...baseProps} userRole="Manager" initialEditing />);
    await screen.findByRole('textbox', { name: 'Gig title' });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Financials' }));
    expect((await screen.findByTestId('financials')).dataset.editing).toBe('true');
  });

  it.each(['Staff', 'Viewer'] as const)('%s: no Edit, no Financials tab, no pay column, even on the edit route', async (role) => {
    render(<GigPage {...baseProps} userRole={role} initialEditing />);
    await screen.findByText('Riverside Summer Series');
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Financials' })).not.toBeInTheDocument();
    const staffing = screen.getByRole('heading', { name: /Staffing/ }).closest('div.rounded-xl, [data-slot="card"]') as HTMLElement;
    expect(within(staffing).queryByText('Rate / Fee')).not.toBeInTheDocument();
    expect(within(staffing).queryByText(/\$450/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Staff cost/)).not.toBeInTheDocument();
  });

  it('shows Admins the crew pay and staff cost', async () => {
    render(<GigPage {...baseProps} userRole="Admin" />);
    await screen.findByText('Riverside Summer Series');
    expect(screen.getByText('$450 fee')).toBeInTheDocument();
    expect(screen.getByText(/Staff cost/)).toBeInTheDocument();
  });

  describe('edit mode', () => {
    const openEditor = async () => {
      render(<GigPage {...baseProps} userRole="Admin" initialEditing />);
      return screen.findByRole('textbox', { name: 'Gig title' });
    };
    const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    it('edits the title, status and tags in the header, then When & schedule, Participants, Staffing, Notes', async () => {
      expect(await openEditor()).toHaveValue('Riverside Summer Series');
      const header = screen.getByRole('textbox', { name: 'Gig title' }).closest('[data-gig-header]') as HTMLElement;
      expect(within(header).getByRole('combobox', { name: 'Status' })).toHaveTextContent('Booked');
      expect(within(header).getByText('Outdoor')).toBeInTheDocument();

      const when = screen.getByRole('heading', { name: 'When & schedule' });
      const notes = screen.getByRole('heading', { name: 'Notes & attachments' });
      expect(before(when, screen.getByTestId('edit-schedule'))).toBe(true);
      expect(before(screen.getByTestId('edit-schedule'), screen.getByTestId('edit-participants'))).toBe(true);
      expect(before(screen.getByTestId('edit-participants'), screen.getByTestId('edit-staffing'))).toBe(true);
      expect(before(screen.getByTestId('edit-staffing'), notes)).toBe(true);
      const notesCard = notes.closest('[data-slot="card"]') as HTMLElement;
      expect(within(notesCard).getByDisplayValue('Crew parking in Lot C')).toBeInTheDocument();
      expect(within(notesCard).getByTestId('attachments')).toBeInTheDocument();
      expect(schedule.props.timeZone).toBe('America/Los_Angeles');
    });

    it('shows one save state for the whole page', async () => {
      schedule.state = 'saving';
      await openEditor();
      // Sections report their state from an effect, so it lands a render after the title box.
      expect(await screen.findByText('Saving…')).toBeInTheDocument();
    });

    it('Done waits for pending saves before leaving edit mode', async () => {
      let finish!: () => void;
      schedule.flush = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
      await openEditor();
      vi.mocked(getGig).mockClear();

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await act(async () => { await Promise.resolve(); });
      expect(schedule.flush).toHaveBeenCalled();
      expect(screen.getByRole('textbox', { name: 'Gig title' })).toBeInTheDocument();
      expect(getGig).not.toHaveBeenCalled();

      await act(async () => { finish(); });
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Gig title' })).not.toBeInTheDocument());
      expect(getGig).toHaveBeenCalled();
    });

    it('widens the gig to cover a schedule item outside it, and saves that', async () => {
      await openEditor();
      act(() => { schedule.props.onEntriesChange([{ start_time: '2026-07-12T17:00:00.000Z', end_time: null }]); });
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(updateGig).toHaveBeenCalledWith('g1', expect.objectContaining({
        start: '2026-07-12T17:00:00.000Z',
        end: '2026-07-13T06:30:00.000Z',
      })));
    });

    it('leaves an all-day gig alone', async () => {
      vi.mocked(getGig).mockResolvedValue({ ...gig, start: '2026-07-12T12:00:00.000Z', end: '2026-07-12T12:00:00.000Z' } as any);
      await openEditor();
      act(() => { schedule.props.onEntriesChange([{ start_time: '2026-07-12T09:00:00.000Z', end_time: null }]); });
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Gig title' })).not.toBeInTheDocument());
      expect(updateGig).not.toHaveBeenCalled();
    });
  });

  it('shows what the gig needs per item on the Equipment tab (#184)', async () => {
    render(<GigPage {...baseProps} userRole="Manager" tab="equipment" />);
    expect(await screen.findByTestId('equipment-needed')).toHaveAttribute('data-gig', 'g1');
  });

  it('shows the packing list on the Equipment tab, printed from the page Print menu (#39)', async () => {
    render(<GigPage {...baseProps} userRole="Manager" tab="equipment" />);
    const list = await screen.findByTestId('packing-list');
    expect(list.dataset.gig).toBe('g1');
    expect(list.dataset.hidePrint).toBe('true');
  });

  describe('printing', () => {
    beforeEach(() => { window.print = vi.fn(); localStorage.clear(); });

    it('lets Admins print the gig sheet with or without the financials page', async () => {
      const user = userEvent.setup();
      render(<GigPage {...baseProps} userRole="Admin" />);
      await user.click(await screen.findByRole('button', { name: 'Print' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Gig sheet with financials' }));
      await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('print-sheet').dataset.financials).toBe('true');

      await user.click(screen.getByRole('button', { name: 'Print' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Gig sheet' }));
      await waitFor(() => expect(window.print).toHaveBeenCalledTimes(2));
      expect(screen.getByTestId('print-sheet').dataset.financials).toBe('false');
    });

    it.each(['Staff', 'Viewer'] as const)('%s prints the gig sheet without financials', async (role) => {
      const user = userEvent.setup();
      render(<GigPage {...baseProps} userRole={role} />);
      await user.click(await screen.findByRole('button', { name: 'Print' }));
      expect(screen.queryByRole('menuitem', { name: 'Gig sheet with financials' })).not.toBeInTheDocument();
      await user.click(await screen.findByRole('menuitem', { name: 'Gig sheet' }));
      await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('print-sheet').dataset.financials).toBe('false');
    });

    it.each(['Admin', 'Staff'] as const)('%s prints the packing list from the Print menu, once it has loaded (#39)', async (role) => {
      const user = userEvent.setup();
      render(<GigPage {...baseProps} userRole={role} />);
      await user.click(await screen.findByRole('button', { name: 'Print' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Packing list' }));
      const sheet = await screen.findByTestId('packing-print');
      expect(sheet.dataset.gig).toBe('g1');
      expect(sheet.closest('.no-print')).toBeNull();
      await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('print-sheet')).not.toBeInTheDocument();
    });

    // #245 item 3: the printout has the columns chosen on screen.
    it('prints the packing list with the columns chosen on screen', async () => {
      const user = userEvent.setup();
      render(<GigPage {...baseProps} userRole="Manager" tab="equipment" />);
      expect((await screen.findByTestId('packing-list')).dataset.columns).toBe('location,notes,scanned_at,scanned_by,status');
      await user.click(screen.getByRole('button', { name: 'Only status' }));
      expect(screen.getByTestId('packing-list').dataset.columns).toBe('status');
      await user.click(screen.getByRole('button', { name: 'Print' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Packing list' }));
      expect((await screen.findByTestId('packing-print')).dataset.columns).toBe('status');
    });

    it('starts the packing list with the columns remembered in this browser (#245)', async () => {
      localStorage.setItem('gigwrangler.packingList.columns', JSON.stringify(['notes', 'status']));
      try {
        const user = userEvent.setup();
        render(<GigPage {...baseProps} userRole="Manager" tab="equipment" />);
        expect((await screen.findByTestId('packing-list')).dataset.columns).toBe('notes,status');
        await user.click(screen.getByRole('button', { name: 'Only status' }));
        expect(JSON.parse(localStorage.getItem('gigwrangler.packingList.columns')!)).toEqual(['status']);
        await user.click(screen.getByRole('button', { name: 'Print' }));
        await user.click(await screen.findByRole('menuitem', { name: 'Packing list' }));
        expect((await screen.findByTestId('packing-print')).dataset.columns).toBe('status');
      } finally {
        localStorage.clear();
      }
    });

    it('hides the screen page and shows only the sheet when printing', async () => {
      render(<GigPage {...baseProps} userRole="Admin" />);
      await screen.findByRole('button', { name: 'Print' });
      expect(screen.getByRole('main').closest('.no-print')).not.toBeNull();
    });
  });
});

// B12: when the page moves to another gig before the first one has loaded, the late answer for
// the first gig is dropped, not shown over the second.
describe('GigPage: a late answer for another gig', () => {
  it('keeps showing the gig the page is on', async () => {
    let resolveFirst!: (g: any) => void;
    vi.mocked(getGig).mockImplementation((id: string) =>
      id === 'g1' ? new Promise((r) => { resolveFirst = r; }) : Promise.resolve({ ...gig, id: 'g2', title: 'Harbor Lights Gala' } as any));
    const { rerender } = render(<GigPage {...baseProps} gigId="g1" />);
    rerender(<GigPage {...baseProps} gigId="g2" />);
    expect((await screen.findAllByText('Harbor Lights Gala')).length).toBeGreaterThan(0);
    await act(async () => { resolveFirst(gig); });
    expect(screen.queryByText('Riverside Summer Series')).not.toBeInTheDocument();
    expect(screen.getAllByText('Harbor Lights Gala').length).toBeGreaterThan(0);
  });
});

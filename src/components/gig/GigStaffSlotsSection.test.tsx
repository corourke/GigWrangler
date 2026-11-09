import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GigStaffSlotsSection from './GigStaffSlotsSection';
import { renderWithQuery } from '../../test/renderWithQuery';
import { getGig, updateGigStaffSlots, completeAllStaffAssignments, unfinalizeStaffAssignment } from '../../services/gig.service';
import { toast } from 'sonner';

// UserSelector's quick-add affordance mounts an AddPersonDialog (closed by
// default) which uses react-query hooks regardless of its open state, so this
// needs a QueryClientProvider ancestor now, matching the app's real wiring
// (a single app-wide provider in src/main.tsx).
function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock('../../services/gig.service', () => ({
  getGig: vi.fn().mockResolvedValue({
    staff_slots: [
      {
        id: 'slot-1',
        organization_id: 'current-org-id',
        role: 'Sound Engineer',
        count: 2,
        notes: 'Test slot notes',
        staff_assignments: [
          {
            id: 'assignment-1',
            user_id: 'user-1',
            user: { first_name: 'John', last_name: 'Doe' },
            status: 'Confirmed',
            rate: 50,
            fee: null,
            notes: 'Test assignment notes',
          },
        ],
      },
    ],
  }),
  updateGigStaffSlots: vi.fn().mockResolvedValue({}),
  completeAllStaffAssignments: vi.fn(),
  unfinalizeStaffAssignment: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));

// Radix Select doesn't open in jsdom; a native <select> lets tests pick a role.
vi.mock('../ui/select', () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <option value="">{placeholder ?? ''}</option>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, disabled, children }: any) => <option value={value} disabled={disabled}>{children}</option>,
}));

vi.mock('../../utils/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ name: 'Sound Engineer' }, { name: 'Lighting Tech' }],
        error: null,
      }),
    })),
  })),
}));

describe('GigStaffSlotsSection', () => {
  const mockProps = {
    gigId: 'test-gig-id',
    currentOrganizationId: 'current-org-id',
    participantOrganizationIds: ['current-org-id', 'other-org-id'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without throwing errors', () => {
    expect(() => {
      render(<GigStaffSlotsSection {...mockProps} />);
    }).not.toThrow();
  });

  it('displays loading state initially', () => {
    render(<GigStaffSlotsSection {...mockProps} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders add staff slot button', async () => {
    render(<GigStaffSlotsSection {...mockProps} />);
    
    await waitFor(() => {
      expect(screen.getByText('Add Staff Slot')).toBeInTheDocument();
    });
  });

  it('does not render manual save button', async () => {
    render(<GigStaffSlotsSection {...mockProps} />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    });
  });

  it('shows an assignment row for a newly added staff slot without reloading (regression for #16)', async () => {
    render(<GigStaffSlotsSection {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByText('Add Staff Slot')).toBeInTheDocument();
    });

    // The pre-existing slot from getGig() has one assignment, giving one
    // "Search for user..." field already on screen.
    const before = screen.getAllByPlaceholderText('Search for user...').length;

    fireEvent.click(screen.getByText('Add Staff Slot'));

    // A freshly-added slot defaults to Required: 1, so it should render
    // exactly one more assignment row right away — not zero, only fixed by
    // bumping Required or reloading.
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Search for user...')).toHaveLength(before + 1);
    });
  });

  it('asks before deleting a staff slot, naming its assigned people (#171)', async () => {
    render(<GigStaffSlotsSection {...mockProps} />);

    const deleteButton = await screen.findByRole('button', { name: 'Delete staff slot' });
    const rows = screen.getAllByPlaceholderText('Search for user...').length;
    fireEvent.click(deleteButton);

    // The slot is still there until the deletion is confirmed.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete staff slot?');
    expect(dialog).toHaveTextContent('Sound Engineer');
    expect(dialog).toHaveTextContent('John Doe');
    expect(screen.getAllByPlaceholderText('Search for user...')).toHaveLength(rows);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getAllByPlaceholderText('Search for user...')).toHaveLength(rows);

    fireEvent.click(screen.getByRole('button', { name: 'Delete staff slot' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.queryAllByPlaceholderText('Search for user...')).toHaveLength(0);
    });
  });
});

describe('GigStaffSlotsSection deletes only rows it loaded (#92)', () => {
  const SLOT_A = '11111111-1111-4111-8111-111111111111';
  const ASG_A = '22222222-2222-4222-8222-222222222222';
  const SLOT_B = '33333333-3333-4333-8333-333333333333';
  const ASG_B = '44444444-4444-4444-8444-444444444444';
  const NEW_SLOT = '55555555-5555-4555-8555-555555555555';
  const mockProps = {
    gigId: 'test-gig-id',
    currentOrganizationId: 'current-org-id',
    participantOrganizationIds: ['current-org-id'],
  };
  const slot = (id: string, role: string, assignmentId: string, userId: string) => ({
    id, organization_id: 'current-org-id', role, count: 1, notes: '',
    staff_assignments: [{ id: assignmentId, user_id: userId, user: { first_name: userId, last_name: '' }, status: 'Confirmed', rate: 50, fee: null, notes: '' }],
  });
  const calls = () => vi.mocked(updateGigStaffSlots).mock.calls;
  const removeSlotButtons = (container: HTMLElement) =>
    [...container.querySelectorAll('.lucide-trash-2')].map((svg) => svg.closest('button')!) as HTMLElement[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGig).mockResolvedValue({
      staff_slots: [slot(SLOT_A, 'Sound Engineer', ASG_A, 'user-a'), slot(SLOT_B, 'Lighting Tech', ASG_B, 'user-b')],
    } as any);
    vi.mocked(updateGigStaffSlots).mockImplementation(async (_gigId, slots) => ({
      success: true,
      slotIds: slots.map((s) => s.id ?? NEW_SLOT),
      assignmentIds: slots.map((s) => (s.assignments ?? []).map((a) => a.id)),
    }));
  });

  it('passes the slots and assignments it loaded, so a removed one is deleted and rows added elsewhere are not', async () => {
    const { container } = render(<GigStaffSlotsSection {...mockProps} />);
    await waitFor(() => expect(removeSlotButtons(container)).toHaveLength(2));

    fireEvent.click(removeSlotButtons(container)[1]);
    // Deleting a slot asks first (#171).
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(updateGigStaffSlots).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(calls()[0][1].map((s) => s.id)).toEqual([SLOT_A]);
    expect([...calls()[0][3]!].sort()).toEqual([SLOT_A, ASG_A, SLOT_B, ASG_B].sort());
  });

  it('deletes a slot it added on an earlier save once the user removes it', async () => {
    const { container } = render(<GigStaffSlotsSection {...mockProps} />);
    await waitFor(() => expect(removeSlotButtons(container)).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Lighting Tech' }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText('Add Staff Slot'));
    const roleSelects = await waitFor(() => {
      const found = screen.getAllByRole('combobox').filter((s) => (s as HTMLSelectElement).options[0]?.text === 'Select role');
      expect(found).toHaveLength(3);
      return found;
    });
    fireEvent.change(roleSelects[2], { target: { value: 'Lighting Tech' } });
    await waitFor(() => expect(updateGigStaffSlots).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(calls()[0][1][2].id).toBeUndefined();

    fireEvent.click(removeSlotButtons(container)[2]);
    // Deleting a slot asks first (#171).
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(calls().at(-1)![1].map((s) => s.id)).toEqual([SLOT_A, SLOT_B]), { timeout: 3000 });
    expect(calls().at(-1)![3]).toContain(NEW_SLOT);
    // It waits through two real autosave debounces, so it needs more than the 5s default under load.
  }, 15000);
});

describe('GigStaffSlotsSection rate units (#171)', () => {
  const SLOT = '66666666-6666-4666-8666-666666666666';
  const ASG = '77777777-7777-4777-8777-777777777777';
  const ASG_FEE = '88888888-8888-4888-8888-888888888888';
  const mockProps = {
    gigId: 'test-gig-id',
    currentOrganizationId: 'current-org-id',
    participantOrganizationIds: ['current-org-id'],
  };
  const unitPickers = () => screen.queryAllByRole('combobox')
    .filter((s) => [...(s as HTMLSelectElement).options].some((o) => o.text === '/ day')) as HTMLSelectElement[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGig).mockResolvedValue({
      staff_slots: [{
        id: SLOT, organization_id: 'current-org-id', role: 'Sound Engineer', count: 2, notes: '',
        staff_assignments: [
          { id: ASG, user_id: 'user-a', user: { first_name: 'Ana', last_name: 'Ray' }, status: 'Confirmed', rate: 400, rate_unit: 'day', fee: null, notes: '' },
          { id: ASG_FEE, user_id: 'user-b', user: { first_name: 'Bo', last_name: 'Li' }, status: 'Requested', rate: null, rate_unit: 'hour', fee: 300, notes: '' },
        ],
      }],
    } as any);
    vi.mocked(updateGigStaffSlots).mockImplementation(async (_gigId, slots) => ({
      success: true,
      slotIds: slots.map((s) => s.id),
      assignmentIds: slots.map((s) => (s.assignments ?? []).map((a) => a.id)),
    }));
  });

  it("shows a unit picker next to a rate, set to the assignment's unit, and none for a fee", async () => {
    render(<GigStaffSlotsSection {...mockProps} />);
    await waitFor(() => expect(unitPickers()).toHaveLength(1));
    const picker = unitPickers()[0];
    expect(picker.value).toBe('day');
    // (The mocked SelectValue adds an empty placeholder option.)
    expect([...picker.options].map((o) => o.text).filter(Boolean)).toEqual(['/ hr', '/ day', '/ ½ day']);
  });

  it('saves the unit with the assignment', async () => {
    render(<GigStaffSlotsSection {...mockProps} />);
    await waitFor(() => expect(unitPickers()).toHaveLength(1));

    fireEvent.change(unitPickers()[0], { target: { value: 'half_day' } });

    await waitFor(() => expect(updateGigStaffSlots).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const saved = vi.mocked(updateGigStaffSlots).mock.calls[0][1][0].assignments!;
    expect(saved.find((a) => a.id === ASG)).toEqual(expect.objectContaining({ rate: 400, rate_unit: 'half_day', fee: null }));
    expect(saved.find((a) => a.id === ASG_FEE)).toEqual(expect.objectContaining({ fee: 300, rate: null }));
  });

  it("asks for units completed in the rate's unit when finalizing", async () => {
    render(<GigStaffSlotsSection {...mockProps} />);
    fireEvent.click(await screen.findByTitle('Finalize Assignment'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Days completed');
    expect(dialog).toHaveTextContent('$400 / day');
  });
});

describe('GigStaffSlotsSection projected staff cost (#213)', () => {
  const SLOT = '99999999-9999-4999-8999-999999999999';
  const mockProps = {
    gigId: 'test-gig-id',
    currentOrganizationId: 'current-org-id',
    participantOrganizationIds: ['current-org-id'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGig).mockResolvedValue({
      // 18:00–03:00 in Los Angeles: 9 hours
      start: '2026-10-11T01:00:00Z', end: '2026-10-11T10:00:00Z', timezone: 'America/Los_Angeles',
      staff_slots: [{
        id: SLOT, organization_id: 'current-org-id', role: 'Stage Hand', count: 3, notes: '',
        staff_assignments: [
          { id: 'a-hand', user_id: 'user-a', user: { first_name: 'Sam', last_name: 'Rivera' }, status: 'Confirmed', rate: 35, rate_unit: 'hour', fee: null, notes: '' },
          { id: 'a-fee', user_id: 'user-b', user: { first_name: 'Bo', last_name: 'Li' }, status: 'Requested', rate: null, rate_unit: 'hour', fee: 350, notes: '' },
          { id: 'a-done', user_id: 'user-c', user: { first_name: 'Cy', last_name: 'Ng' }, status: 'Confirmed', rate: 35, rate_unit: 'hour', fee: null, notes: '', completed_at: '2026-10-12T00:00:00Z', units_completed: 4 },
        ],
      }],
    } as any);
  });

  it('projects a rate over the gig hours and shows the estimate; a fee stays flat; a finalized rate uses the units entered', async () => {
    render(<GigStaffSlotsSection {...mockProps} />);
    expect(await screen.findByText(/est\. 9 hr × \$35\.00 \/ hr = \$315\.00/)).toBeInTheDocument();
    expect(screen.getByText('$665.00')).toBeInTheDocument(); // projected: 315 + 350
    expect(screen.getByText('$140.00')).toBeInTheDocument(); // finalized: 4 hr × $35
    expect(screen.getByText(/Total: \$805\.00/)).toBeInTheDocument();
  });

  it('groups thousands in the footer amounts, like the Financials tab (#219)', async () => {
    vi.mocked(getGig).mockResolvedValue({
      start: '2026-10-11T01:00:00Z', end: '2026-10-11T10:00:00Z', timezone: 'America/Los_Angeles',
      staff_slots: [{
        id: SLOT, organization_id: 'current-org-id', role: 'Stage Hand', count: 1, notes: '',
        staff_assignments: [{ id: 'a-big', user_id: 'user-a', user: { first_name: 'Sam', last_name: 'Rivera' }, status: 'Confirmed', rate: null, rate_unit: 'hour', fee: 1582.5, notes: '' }],
      }],
    } as any);
    render(<GigStaffSlotsSection {...mockProps} />);
    expect(await screen.findByText(/Total: \$1,582\.50/)).toBeInTheDocument();
    expect(screen.getByText('$1,582.50')).toBeInTheDocument(); // projected
  });
});

// Finalize results say what happened (Docs Lead code read, 11-09).
describe('GigStaffSlotsSection: finalize messages', () => {
  const props = { gigId: 'test-gig-id', currentOrganizationId: 'current-org-id', participantOrganizationIds: ['current-org-id'] };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGig).mockResolvedValue({
      staff_slots: [{
        id: '99999999-9999-4999-8999-999999999999', organization_id: 'current-org-id', role: 'Stage Hand', count: 1, notes: '',
        staff_assignments: [{ id: 'a-done', user_id: 'user-c', user: { first_name: 'Cy', last_name: 'Ng' }, status: 'Confirmed', rate: null, rate_unit: 'hour', fee: 100, notes: '', completed_at: '2026-10-12T00:00:00Z' }],
      }],
    } as any);
  });

  it('a refused Undo Finalize shows the reason', async () => {
    vi.mocked(unfinalizeStaffAssignment).mockRejectedValue(new Error('The 2025 tax year is locked (filed), so its gig income and expenses can\'t be deleted.'));
    render(<GigStaffSlotsSection {...props} />);
    fireEvent.click(await screen.findByTitle('Undo Finalize'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The 2025 tax year is locked (filed), so its gig income and expenses can\'t be deleted.'));
  });

  it('Finalize All with some refused says how many were finalized and why the rest weren\'t', async () => {
    vi.mocked(completeAllStaffAssignments).mockResolvedValue({ success: true, count: 2, failed: 1, total: 3, reason: 'The 2025 tax year is locked (filed).' } as any);
    render(<GigStaffSlotsSection {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /Finalize All/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Finalized 2 of 3. 1 couldn\'t be finalized: The 2025 tax year is locked (filed).'));
  });
});

// A10: how the staffing section loads, fails, follows the gig and reloads after finalizing.
// These hold before and after the move to react-query.
describe('GigStaffSlotsSection: data loading (A10)', () => {
  const props = { gigId: 'test-gig-id', currentOrganizationId: 'current-org-id', participantOrganizationIds: ['current-org-id'] };
  const slotFor = (gigTitle: string) => ({
    staff_slots: [{ id: `slot-${gigTitle}`, organization_id: 'current-org-id', role: gigTitle, count: 1, notes: '',
      staff_assignments: [{ id: `a-${gigTitle}`, user_id: 'user-1', user: { first_name: 'John', last_name: 'Doe' }, status: 'Confirmed', rate: null, fee: 100, notes: '' }] }],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGig).mockImplementation(async (id: string) => slotFor(id === 'gig-2' ? 'Lighting Tech' : 'Sound Engineer') as any);
  });

  it('says the slots failed to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getGig).mockRejectedValueOnce(new Error('down'));
    renderWithQuery(<GigStaffSlotsSection {...props} />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load staff slots'));
  });

  it("loads the other gig's slots when the gig changes", async () => {
    const { rerender } = renderWithQuery(<GigStaffSlotsSection {...props} />);
    await waitFor(() => expect(screen.getByDisplayValue('Sound Engineer')).toBeInTheDocument());
    rerender(<GigStaffSlotsSection {...props} gigId="gig-2" />);
    await waitFor(() => expect(screen.getByDisplayValue('Lighting Tech')).toBeInTheDocument());
    expect(getGig).toHaveBeenCalledWith('gig-2');
  });

  it('loads the slots again after Finalize All', async () => {
    vi.mocked(completeAllStaffAssignments).mockResolvedValue({ success: true, count: 1, failed: 0, total: 1 } as any);
    renderWithQuery(<GigStaffSlotsSection {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /Finalize All/ }));
    await waitFor(() => expect(vi.mocked(getGig).mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

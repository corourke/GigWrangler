import { renderWithQuery as render } from '../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MaintenanceList } from './MaintenanceList';
import { getMaintenanceList, updateMaintenance, returnToService } from '../../services/maintenance.service';
import { toast } from 'sonner';



vi.mock('../../services/maintenance.service', async () => {
  const actual = await vi.importActual<any>('../../services/maintenance.service');
  return {
    ...actual,
    getMaintenanceList: vi.fn(),
    updateMaintenance: vi.fn().mockResolvedValue(undefined),
    returnToService: vi.fn().mockResolvedValue('x'),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = (over: any) => ({
  asset_id: 'a', item_name: 'QSC K12.2', tag_number: null, serial_number: null, kind: 'unit', quantity: 1, pieces: 1,
  from_lot: null, notes: null, location: null, expected_back: null, since: '2026-10-20T10:00:00Z', flagged_by_name: 'Sam Ruiz',
  last_gig_title: null, pending_gig_id: null, pending_gig_title: null, ...over,
});

const list = {
  inMaintenance: [
    row({ asset_id: 'u1', tag_number: 'DSL-0104', notes: 'Woofer rattles', location: 'Repair Bench', expected_back: '2020-01-02', last_gig_title: 'Fall Fest' }),
    row({ asset_id: 'piece-1', item_name: 'XLR Cable, 25 ft', kind: 'lot', quantity: 2, pieces: 2, from_lot: { id: 'lot-1', quantity: 18, will_merge: true }, expected_back: '2999-01-01' }),
  ],
  flagged: [
    row({ asset_id: 'lot-2', item_name: 'Mic Stand', kind: 'lot', quantity: 10, pieces: 3, pending_gig_id: 'g1', pending_gig_title: 'Harvest Gala' }),
  ],
};

// #186 step 2: Equipment › Maintenance lists what's in maintenance and what's flagged to go when
// it comes home. Staff and above can edit the details, return to service or cancel a flag.
describe('MaintenanceList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMaintenanceList as any).mockResolvedValue(list);
  });

  const renderList = (userRole: any = 'Staff') =>
    render(<MaintenanceList organizationId="org-1" organizationName="Org" userRole={userRole} />);

  it('shows both sections with which piece, details and the gig a flag waits on', async () => {
    renderList();
    const inMaint = await screen.findByRole('region', { name: /in maintenance/i });
    expect(within(inMaint).getByText('DSL-0104')).toBeInTheDocument();
    expect(within(inMaint).getByText('Woofer rattles')).toBeInTheDocument();
    expect(within(inMaint).getByText('Repair Bench')).toBeInTheDocument();
    expect(within(inMaint).getByText('Fall Fest')).toBeInTheDocument();
    expect(within(inMaint).getByText('2 split from the lot (now 18)')).toBeInTheDocument();
    expect(within(inMaint).getAllByText(/Sam Ruiz/)).toHaveLength(2);

    const flagged = screen.getByRole('region', { name: /flagged, not home yet/i });
    expect(within(flagged).getByText('Mic Stand')).toBeInTheDocument();
    expect(within(flagged).getByText('3 of the lot of 10')).toBeInTheDocument();
    expect(within(flagged).getByText('Harvest Gala')).toBeInTheDocument();
  });

  // #300: long columns wrap so the actions are never pushed past the card's edge.
  it('keeps the actions on one line and lets the long columns wrap', async () => {
    renderList();
    await screen.findByText('DSL-0104');
    const actions = screen.getAllByRole('button', { name: /return to service/i })[0].closest('td')!;
    expect(actions.className).toMatch(/whitespace-nowrap/);
    for (const text of ['QSC K12.2', 'Fall Fest']) {
      expect(screen.getAllByText(text)[0].closest('td')!.className).toMatch(/whitespace-normal/);
    }
  });

  it('marks an expected-back date that has passed', async () => {
    renderList();
    await screen.findByText('DSL-0104');
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getAllByText('Overdue')).toHaveLength(1);
  });

  it('says so when nothing is in maintenance or flagged', async () => {
    (getMaintenanceList as any).mockResolvedValue({ inMaintenance: [], flagged: [] });
    renderList();
    expect(await screen.findByText(/nothing is in maintenance/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /flagged, not home yet/i })).not.toBeInTheDocument();
  });

  it("a failed load says so, with Retry, rather than an empty list", async () => {
    (getMaintenanceList as any).mockRejectedValueOnce(new Error('Network error'));
    renderList();
    expect(await screen.findByText(/couldn.t load the maintenance list/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing is in maintenance/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('DSL-0104')).toBeInTheDocument();
    expect(getMaintenanceList).toHaveBeenCalledTimes(2);
  });

  it('a Viewer sees the list without actions', async () => {
    renderList('Viewer');
    await screen.findByText('DSL-0104');
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return to service/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel flag/i })).not.toBeInTheDocument();
  });

  it('has no Dispose action', async () => {
    renderList('Admin');
    await screen.findByText('DSL-0104');
    expect(screen.queryByRole('button', { name: /dispose/i })).not.toBeInTheDocument();
  });

  it('Edit saves notes, location and expected back, then reloads', async () => {
    renderList();
    await screen.findByText('DSL-0104');
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/condition notes/i), { target: { value: 'Recone needed' } });
    fireEvent.change(within(dialog).getByLabelText(/location/i), { target: { value: 'Shop' } });
    fireEvent.change(within(dialog).getByLabelText(/expected back/i), { target: { value: '2026-11-10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    await waitFor(() => expect(updateMaintenance).toHaveBeenCalledWith('u1', {
      notes: 'Recone needed', location: 'Shop', expectedBack: '2026-11-10',
    }));
    await waitFor(() => expect(getMaintenanceList).toHaveBeenCalledTimes(2));
  });

  it('Return to service confirms, saying a split piece goes back into its lot', async () => {
    renderList();
    await screen.findByText('DSL-0104');
    fireEvent.click(screen.getAllByRole('button', { name: /return to service/i })[1]);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/goes back into its lot \(now 18\)/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /return to service/i }));
    await waitFor(() => expect(returnToService).toHaveBeenCalledWith('piece-1'));
    await waitFor(() => expect(getMaintenanceList).toHaveBeenCalledTimes(2));
  });

  it('Cancel flag on a flagged record calls return to service, which cancels it', async () => {
    renderList();
    await screen.findByText('Mic Stand');
    fireEvent.click(screen.getByRole('button', { name: /cancel flag/i }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel flag/i }));
    await waitFor(() => expect(returnToService).toHaveBeenCalledWith('lot-2'));
  });

  it("shows the database's message when an action is refused", async () => {
    (returnToService as any).mockRejectedValueOnce(new Error("This equipment isn't in maintenance."));
    renderList();
    await screen.findByText('DSL-0104');
    fireEvent.click(screen.getAllByRole('button', { name: /return to service/i })[0]);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /return to service/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This equipment isn't in maintenance."));
  });
});

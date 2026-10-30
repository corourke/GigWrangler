import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotReturnedSection from './NotReturnedSection';
import { getGigReturns, writeOffPieces, undoWriteOff, markReturned } from '../../services/writeOff.service';
import { getLockedTaxYears } from '../../services/taxYear.service';

vi.mock('../../services/writeOff.service', () => ({
  getGigReturns: vi.fn(), writeOffPieces: vi.fn(), undoWriteOff: vi.fn(), markReturned: vi.fn(),
}));
vi.mock('../../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const rec = (id: string, over: Record<string, unknown> = {}) => ({
  id, manufacturer_model: 'x', tag_number: null, serial_number: null, quantity: 1, status: 'Active', retired_on: null, ...over,
});
const k12 = { record: rec('k12', { manufacturer_model: 'QSC K12.2', tag_number: 'DSL-0101' }), kitId: 'pa', kitName: 'Main PA', quantity: 1, status: 'On Site', location: null };
const cables = { record: rec('cables', { manufacturer_model: 'XLR Cable, 50 ft', quantity: 10 }), kitId: 'foh', kitName: 'FOH', quantity: 4, status: 'Not Returned', location: null };
const gone = { record: rec('gone', { manufacturer_model: 'PD-20', tag_number: 'T-9', status: 'Missing', retired_on: '2026-10-09' }), quantity: 1, note: 'lost at load-out' };
const past = '2026-10-01T23:00:00Z';
const future = '2099-01-01T23:00:00Z';

// Write off asks first (#242): the red button opens a confirm naming the pieces and the effect.
const confirmDialog = () => screen.findByRole('alertdialog');
const confirmWriteOff = async (ue: ReturnType<typeof userEvent.setup>) => {
  await ue.click(within(await confirmDialog()).getByRole('button', { name: 'Write off' }));
};

// #185 (Cameron, 10-09): the gig's "Not returned" list. Admins and Managers can mark pieces
// Returned or Missing, and undo a write-off unless its tax year is locked; Staff only see it.
describe('NotReturnedSection (#185)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGigReturns).mockResolvedValue({ notReturned: [k12, cables], writtenOff: [gone] } as any);
    vi.mocked(getLockedTaxYears).mockResolvedValue(new Set());
    vi.mocked(writeOffPieces).mockResolvedValue('m');
    vi.mocked(undoWriteOff).mockResolvedValue('gone');
    vi.mocked(markReturned).mockResolvedValue();
  });

  it('after the gig, lists what is still out, kit by kit, and what was written off', async () => {
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    const k12Row = (await screen.findByText('QSC K12.2 (#DSL-0101)')).closest('li')!;
    expect(k12Row).toHaveTextContent('Main PA');
    const cableRow = screen.getByText('XLR Cable, 50 ft').closest('li')!;
    expect(cableRow).toHaveTextContent('4 not returned');
    expect(cableRow).toHaveTextContent('FOH');
    const goneRow = screen.getByText('PD-20 (#T-9)').closest('li')!;
    expect(goneRow).toHaveTextContent('1 missing');
    expect(goneRow).toHaveTextContent('lost at load-out');
  });

  it('says "1 piece still out" for a single piece', async () => {
    vi.mocked(getGigReturns).mockResolvedValue({ notReturned: [k12], writtenOff: [] } as any);
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    expect(await screen.findByText('1 piece still out')).toBeInTheDocument();
  });

  it('before the gig ends, only pieces already left behind are listed', async () => {
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={future} canEdit />);
    expect(await screen.findByText('XLR Cable, 50 ft')).toBeInTheDocument();
    expect(screen.queryByText('QSC K12.2 (#DSL-0101)')).not.toBeInTheDocument();
  });

  it('Returned writes a return for that kit\'s pieces', async () => {
    const ue = userEvent.setup();
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    const row = (await screen.findByText('XLR Cable, 50 ft')).closest('li')!;
    await ue.click(within(row).getByRole('button', { name: 'Returned' }));
    expect(markReturned).toHaveBeenCalledWith({ organizationId: 'org-1', gigId: 'gig-1', kitId: 'foh', assetId: 'cables', quantity: 4 });
    await waitFor(() => expect(getGigReturns).toHaveBeenCalledTimes(2));
  });

  it('Mark missing on a lot asks how many; the rest stay out', async () => {
    const ue = userEvent.setup();
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    const row = (await screen.findByText('XLR Cable, 50 ft')).closest('li')!;
    await ue.click(within(row).getByRole('button', { name: 'Mark missing' }));
    const count = within(row).getByRole('spinbutton', { name: 'How many are missing' });
    await ue.clear(count);
    await ue.type(count, '1');
    await ue.click(within(row).getByRole('button', { name: 'Write off' }));
    await confirmWriteOff(ue);
    expect(writeOffPieces).toHaveBeenCalledWith({ assetId: 'cables', quantity: 1, gigId: 'gig-1', kitId: 'foh', stillOut: 3 });
  });

  it('after a write-off the row closes its form; the rest of a lot are still listed with their actions', async () => {
    const ue = userEvent.setup();
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    const row = () => screen.getByText(/XLR Cable/).closest('li')!;
    await screen.findByText(/XLR Cable/);
    await ue.click(within(row()).getByRole('button', { name: 'Mark missing' }));
    await ue.click(within(row()).getByRole('button', { name: 'Write off' }));
    await confirmWriteOff(ue);
    await waitFor(() => expect(within(row()).queryByRole('button', { name: 'Write off' })).not.toBeInTheDocument());
    expect(within(row()).getByRole('button', { name: 'Mark missing' })).toBeInTheDocument();
  });

  it('Mark missing on a unit writes off that one unit', async () => {
    const ue = userEvent.setup();
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    const row = (await screen.findByText('QSC K12.2 (#DSL-0101)')).closest('li')!;
    await ue.click(within(row).getByRole('button', { name: 'Mark missing' }));
    await ue.click(within(row).getByRole('button', { name: 'Write off' }));
    await confirmWriteOff(ue);
    expect(writeOffPieces).toHaveBeenCalledWith({ assetId: 'k12', quantity: 1, gigId: 'gig-1', kitId: 'pa', stillOut: 0 });
  });

  it('Write off asks first, naming the pieces and the effect; Cancel does not write off (#242)', async () => {
    const ue = userEvent.setup();
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    const row = (await screen.findByText('XLR Cable, 50 ft')).closest('li')!;
    await ue.click(within(row).getByRole('button', { name: 'Mark missing' }));
    const count = within(row).getByRole('spinbutton', { name: 'How many are missing' });
    await ue.clear(count);
    await ue.type(count, '2');
    await ue.click(within(row).getByRole('button', { name: 'Write off' }));
    const dialog = await confirmDialog();
    expect(writeOffPieces).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('Write off 2 × XLR Cable, 50 ft as missing?');
    expect(dialog).toHaveTextContent(`They'll leave owned equipment and show as disposed of in ${new Date().getFullYear()}'s tax reports.`);
    expect(dialog).toHaveTextContent('You can undo this unless the tax year is filed.');
    await ue.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(writeOffPieces).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('confirming the write-off calls the service with the right pieces (#242)', async () => {
    const ue = userEvent.setup();
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    const row = (await screen.findByText('XLR Cable, 50 ft')).closest('li')!;
    await ue.click(within(row).getByRole('button', { name: 'Mark missing' }));
    const count = within(row).getByRole('spinbutton', { name: 'How many are missing' });
    await ue.clear(count);
    await ue.type(count, '2');
    await ue.click(within(row).getByRole('button', { name: 'Write off' }));
    await confirmWriteOff(ue);
    expect(writeOffPieces).toHaveBeenCalledTimes(1);
    expect(writeOffPieces).toHaveBeenCalledWith({ assetId: 'cables', quantity: 2, gigId: 'gig-1', kitId: 'foh', stillOut: 2 });
  });

  it('a single unit\'s confirm reads in the singular (#242)', async () => {
    const ue = userEvent.setup();
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    const row = (await screen.findByText('QSC K12.2 (#DSL-0101)')).closest('li')!;
    await ue.click(within(row).getByRole('button', { name: 'Mark missing' }));
    await ue.click(within(row).getByRole('button', { name: 'Write off' }));
    const dialog = await confirmDialog();
    expect(dialog).toHaveTextContent('Write off 1 × QSC K12.2 (#DSL-0101) as missing?');
    expect(dialog).toHaveTextContent("It'll leave owned equipment");
  });

  it('Undo brings a write-off back', async () => {
    const ue = userEvent.setup();
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    const row = (await screen.findByText('PD-20 (#T-9)')).closest('li')!;
    await ue.click(within(row).getByRole('button', { name: 'Undo' }));
    expect(undoWriteOff).toHaveBeenCalledWith('gone');
  });

  it('Undo is off, with a note, once the write-off\'s tax year is locked', async () => {
    vi.mocked(getLockedTaxYears).mockResolvedValue(new Set([2026]));
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    const row = (await screen.findByText('PD-20 (#T-9)')).closest('li')!;
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Undo' })).toBeDisabled());
    // #242: no "found" action exists, so the note says what to do instead.
    expect(row).toHaveTextContent("This write-off is in a filed tax year, so it can't be undone. If the equipment turns up, add it again as new equipment.");
    expect(row).not.toHaveTextContent(/as found/i);
  });

  it('Staff see the list without actions', async () => {
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit={false} />);
    expect(await screen.findByText('XLR Cable, 50 ft')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Returned' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark missing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('shows nothing when everything came back', async () => {
    vi.mocked(getGigReturns).mockResolvedValue({ notReturned: [], writtenOff: [] });
    const { container } = render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />);
    await waitFor(() => expect(getGigReturns).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

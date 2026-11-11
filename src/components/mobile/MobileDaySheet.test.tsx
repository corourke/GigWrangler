import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery as render } from '../../test/renderWithQuery';

// Plan #445 (A1): the day sheet for any gig, past or future (/gigs/:id/day-sheet).
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, selectedOrganization: { id: 'org-1' }, userRole: 'Staff' }) }));
vi.mock('../../services/mobile/dayOfShow.service', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, loadDayOfShowSheet: vi.fn(), keepDayOfShowSheet: vi.fn(), forgetDayOfShowSheet: vi.fn() };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('../../services/attachment.service', () => ({ getAttachmentUrl: vi.fn() }));
vi.mock('../../services/mobile/dayOfShowFiles.service', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, saveGigDocumentsAhead: vi.fn(async () => {}), listSavedDocuments: vi.fn(async () => ({})), saveDayOfShowDocument: vi.fn(), getSavedDocument: vi.fn() };
});

import { loadDayOfShowSheet, keepDayOfShowSheet, forgetDayOfShowSheet, type DayOfShowSheet } from '../../services/mobile/dayOfShow.service';
import MobileDaySheet from './MobileDaySheet';

const PAST = { id: 'g-past', title: 'Last Month Show', start: '2026-10-01T20:00:00Z', end: '2026-10-02T02:00:00Z', timezone: 'UTC', all_day: false, status: 'Completed' };
const sheet = (g: any): DayOfShowSheet => ({
  gig_id: g.id, saved_at: Date.now(), gig: g,
  venue: { name: 'Test Hall' }, schedule: [], contacts: [],
  crew: [{ key: 'a1', name: 'Sam Crew', role: 'FOH', title: 'FOH', phone: '555-0101', email: null }],
  documents: [],
});
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true });

beforeEach(() => { vi.clearAllMocks(); setOnline(true); });
afterEach(() => setOnline(true));

describe('MobileDaySheet', () => {
  it("shows a past gig's sheet: venue and crew", async () => {
    vi.mocked(loadDayOfShowSheet).mockImplementation(async () => sheet(PAST));
    render(<MobileDaySheet gigId="g-past" onBack={vi.fn()} onViewGigDetail={vi.fn()} />);
    expect(await screen.findByText('Last Month Show')).toBeInTheDocument();
    expect(screen.getByText('Test Hall')).toBeInTheDocument();
    expect(screen.getByText('Sam Crew')).toBeInTheDocument();
    expect(loadDayOfShowSheet).toHaveBeenCalledWith('g-past', expect.any(Function));
  });

  it('goes back', async () => {
    vi.mocked(loadDayOfShowSheet).mockImplementation(async () => sheet(PAST));
    const onBack = vi.fn();
    render(<MobileDaySheet gigId="g-past" onBack={onBack} onViewGigDetail={vi.fn()} />);
    await screen.findByText('Last Month Show');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it("says so when the sheet isn't on the phone and there's no connection", async () => {
    setOnline(false);
    vi.mocked(loadDayOfShowSheet).mockResolvedValue(null);
    render(<MobileDaySheet gigId="g-past" onBack={vi.fn()} onViewGigDetail={vi.fn()} />);
    expect(await screen.findByText("This gig's sheet isn't saved on this phone. Connect to load it.")).toBeInTheDocument();
  });
});

// Plan #445 (A1b): Save on this phone.
describe('MobileDaySheet: Save on this phone', () => {
  it('saves the gig on the phone, then offers to remove it', async () => {
    let kept = false;
    vi.mocked(loadDayOfShowSheet).mockImplementation(async () => ({ ...sheet(PAST), kept }));
    vi.mocked(keepDayOfShowSheet).mockImplementation(async () => { kept = true; return { roomShort: false }; });
    render(<MobileDaySheet gigId="g-past" onBack={vi.fn()} onViewGigDetail={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save on this phone' }));
    expect(await screen.findByText('Saved on this phone')).toBeInTheDocument();
    expect(keepDayOfShowSheet).toHaveBeenCalledWith('g-past');
    expect(toast.success).toHaveBeenCalledWith('Saved on this phone');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() => expect(forgetDayOfShowSheet).toHaveBeenCalledWith('g-past'));
  });

  it("says when there isn't room for all its documents", async () => {
    vi.mocked(loadDayOfShowSheet).mockImplementation(async () => sheet(PAST));
    vi.mocked(keepDayOfShowSheet).mockResolvedValue({ roomShort: true });
    render(<MobileDaySheet gigId="g-past" onBack={vi.fn()} onViewGigDetail={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save on this phone' }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "Not enough room on this phone for this gig's documents. Remove a saved gig first."));
  });

  it("can't save without a connection", async () => {
    setOnline(false);
    vi.mocked(loadDayOfShowSheet).mockImplementation(async () => sheet(PAST));
    render(<MobileDaySheet gigId="g-past" onBack={vi.fn()} onViewGigDetail={vi.fn()} />);
    await screen.findByText('Last Month Show');
    expect(screen.queryByRole('button', { name: 'Save on this phone' })).not.toBeInTheDocument();
  });
});

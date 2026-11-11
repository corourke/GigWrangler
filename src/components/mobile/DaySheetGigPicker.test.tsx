import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQuery as render } from '../../test/renderWithQuery';

// Plan #445 (A1): "Choose another gig" on Today.
const auth = { user: { id: 'u1' }, selectedOrganization: { id: 'org-1' }, userRole: 'Staff' as string };
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../services/mobile/daySheetGigs.service', () => ({
  listMyDaySheetGigs: vi.fn(),
  listSavedSheetIds: vi.fn(),
  listOfflineGigs: vi.fn(),
}));
vi.mock('../../services/gig.service', () => ({ getGigsForOrganization: vi.fn() }));

import { listMyDaySheetGigs, listSavedSheetIds, listOfflineGigs } from '../../services/mobile/daySheetGigs.service';
import { getGigsForOrganization } from '../../services/gig.service';
import DaySheetGigPicker from './DaySheetGigPicker';

const gig = (id: string, title: string, start: string) =>
  ({ id, title, start, end: start, timezone: 'UTC', all_day: false, status: 'Booked' });

const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T17:00:00Z'));
  setOnline(true);
  vi.mocked(listSavedSheetIds).mockResolvedValue(new Set(['g2']));
});
afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

describe('DaySheetGigPicker', () => {
  it("lists Staff's own gigs, marks the ones saved on the phone, and opens the one tapped", async () => {
    auth.userRole = 'Staff';
    vi.mocked(listMyDaySheetGigs).mockResolvedValue([gig('g1', 'Spring Gala', '2026-11-01T20:00:00Z'), gig('g2', 'Autumn Ball', '2026-11-20T20:00:00Z')]);
    const onChoose = vi.fn();
    render(<DaySheetGigPicker onChoose={onChoose} onClose={vi.fn()} />);
    const list = await screen.findByRole('list', { name: 'Gigs' });
    const autumn = within(list).getByRole('listitem');
    expect(autumn).toHaveTextContent('Autumn Ball');
    expect(autumn).toHaveTextContent('Saved on this phone');
    const earlier = screen.getByRole('list', { name: 'Earlier' });
    expect(earlier).toHaveTextContent('Spring Gala');
    expect(earlier).not.toHaveTextContent('Saved on this phone');
    expect(getGigsForOrganization).not.toHaveBeenCalled();
    fireEvent.click(within(earlier).getByRole('button'));
    expect(onChoose).toHaveBeenCalledWith('g1');
  });

  // #446 review: open at upcoming gigs, soonest first; past gigs under "Earlier", most recent first.
  it('lists upcoming gigs soonest first, then earlier ones most recent first', async () => {
    auth.userRole = 'Manager';
    vi.mocked(getGigsForOrganization).mockResolvedValue([
      gig('p1', 'Old Show', '2026-10-01T20:00:00Z'),
      gig('u2', 'Later Show', '2026-12-01T20:00:00Z'),
      gig('p2', 'Last Week Show', '2026-11-03T20:00:00Z'),
      gig('u1', 'Next Show', '2026-11-12T20:00:00Z'),
    ] as any);
    render(<DaySheetGigPicker onChoose={vi.fn()} onClose={vi.fn()} />);
    const upcoming = await screen.findByRole('list', { name: 'Gigs' });
    expect(within(upcoming).getAllByRole('listitem').map((i) => i.textContent)).toEqual([
      expect.stringContaining('Next Show'), expect.stringContaining('Later Show'),
    ]);
    expect(within(screen.getByRole('list', { name: 'Earlier' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual([
      expect.stringContaining('Last Week Show'), expect.stringContaining('Old Show'),
    ]);
  });

  // #446 review: offline with nothing loaded, Admins and Managers still reach the sheets on the phone.
  it('offline with nothing loaded, lists the gigs saved on the phone', async () => {
    auth.userRole = 'Admin';
    setOnline(false);
    vi.mocked(getGigsForOrganization).mockRejectedValue(new Error('Failed to fetch'));
    vi.mocked(listOfflineGigs).mockResolvedValue([gig('g2', 'Autumn Ball', '2026-11-20T20:00:00Z')]);
    render(<DaySheetGigPicker onChoose={vi.fn()} onClose={vi.fn()} />);
    const list = await screen.findByRole('list', { name: 'Gigs' });
    expect(list).toHaveTextContent('Autumn Ball');
    expect(screen.getByText('Offline: showing the gigs saved on this phone.')).toBeInTheDocument();
    expect(listOfflineGigs).toHaveBeenCalledWith('org-1');
  });

  it("lists the organization's gigs for Admins and Managers, and search narrows them", async () => {
    auth.userRole = 'Manager';
    vi.mocked(getGigsForOrganization).mockResolvedValue([gig('g1', 'Spring Gala', '2026-11-01T20:00:00Z'), gig('g3', 'Winter Fair', '2026-12-01T20:00:00Z')] as any);
    render(<DaySheetGigPicker onChoose={vi.fn()} onClose={vi.fn()} />);
    const list = await screen.findByRole('list', { name: 'Gigs' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(getGigsForOrganization).toHaveBeenCalledWith('org-1');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search gigs' }), { target: { value: 'winter' } });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('Winter Fair');
  });

  it('closes', async () => {
    auth.userRole = 'Staff';
    vi.mocked(listMyDaySheetGigs).mockResolvedValue([]);
    const onClose = vi.fn();
    render(<DaySheetGigPicker onChoose={vi.fn()} onClose={onClose} />);
    expect(await screen.findByText('No gigs to show')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQuery as render } from '../../test/renderWithQuery';

// Plan #445 (A1): "Choose another gig" on Today.
const auth = { user: { id: 'u1' }, selectedOrganization: { id: 'org-1' }, userRole: 'Staff' as string };
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../services/mobile/daySheetGigs.service', () => ({
  listMyDaySheetGigs: vi.fn(),
  listSavedSheetIds: vi.fn(),
}));
vi.mock('../../services/gig.service', () => ({ getGigsForOrganization: vi.fn() }));

import { listMyDaySheetGigs, listSavedSheetIds } from '../../services/mobile/daySheetGigs.service';
import { getGigsForOrganization } from '../../services/gig.service';
import DaySheetGigPicker from './DaySheetGigPicker';

const gig = (id: string, title: string, start: string) =>
  ({ id, title, start, end: start, timezone: 'UTC', all_day: false, status: 'Booked' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listSavedSheetIds).mockResolvedValue(new Set(['g2']));
});

describe('DaySheetGigPicker', () => {
  it("lists Staff's own gigs, marks the ones saved on the phone, and opens the one tapped", async () => {
    auth.userRole = 'Staff';
    vi.mocked(listMyDaySheetGigs).mockResolvedValue([gig('g1', 'Spring Gala', '2026-11-01T20:00:00Z'), gig('g2', 'Autumn Ball', '2026-11-20T20:00:00Z')]);
    const onChoose = vi.fn();
    render(<DaySheetGigPicker onChoose={onChoose} onClose={vi.fn()} />);
    const list = await screen.findByRole('list', { name: 'Gigs' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([expect.stringContaining('Spring Gala'), expect.stringContaining('Autumn Ball')]);
    expect(items[1]).toHaveTextContent('Saved on this phone');
    expect(items[0]).not.toHaveTextContent('Saved on this phone');
    expect(getGigsForOrganization).not.toHaveBeenCalled();
    fireEvent.click(within(items[0]).getByRole('button'));
    expect(onChoose).toHaveBeenCalledWith('g1');
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

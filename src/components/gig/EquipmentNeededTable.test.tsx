import { describe, it, expect, vi } from 'vitest';
import { screen, within, waitFor, act } from '@testing-library/react';
import EquipmentNeededTable from './EquipmentNeededTable';
import { renderWithQuery } from '../../test/renderWithQuery';
import { getEquipmentNeeded } from '../../services/conflictDetection.service';
import { invalidateAfterGigKitsChange } from '../../lib/queryKeys';

vi.mock('../../services/conflictDetection.service', () => ({ getEquipmentNeeded: vi.fn() }));

const row = (over: Record<string, any>) => ({
  itemId: 'x', name: 'X', thisGig: 1, overlapping: 0, needed: 1, owned: 1, inMaintenance: 0, inContainers: 0, free: 1, short: 0, status: 'enough', ...over,
});

// #184 (mockup screen 10): the gig's Equipment tab lists what it needs per item.
describe('EquipmentNeededTable (#184)', () => {
  it('lists each item: this gig, overlapping, needed, owned, in maintenance, free and status', async () => {
    vi.mocked(getEquipmentNeeded).mockResolvedValue({
      overlapping: 1,
      rows: [
        row({ itemId: 'trio', name: 'Chauvet Intimidator Trio', thisGig: 4, overlapping: 4, needed: 8, owned: 6, free: 6, short: 2, status: 'short' }),
        row({ itemId: 'k12', name: 'QSC K12.2', thisGig: 2, overlapping: 2, needed: 4, owned: 6, inMaintenance: 1, free: 5, status: 'enough' }),
        row({ itemId: 'xlr', name: 'XLR Cable, 50 ft', thisGig: 4, overlapping: 2, needed: 6, owned: 10, inContainers: 4, free: 6, status: 'none-spare' }),
      ],
    } as any);
    renderWithQuery(<EquipmentNeededTable gigId="g1" gigStart="2026-10-11T03:00:00Z" gigEnd="2026-10-11T06:00:00Z" gigTimezone="America/Los_Angeles" organizationId="org-1" />);
    // 8 PM on Oct 10 in Los Angeles, though already Oct 11 in UTC.
    expect(await screen.findByText('Equipment needed on Oct 10, 2026')).toBeInTheDocument();
    expect(screen.getByText('this gig and the 1 that overlaps it')).toBeInTheDocument();
    const trio = screen.getByText('Chauvet Intimidator Trio').closest('tr')!;
    expect(trio).toHaveTextContent('Chauvet Intimidator Trio448606 2 short');
    expect(within(screen.getByText('QSC K12.2').closest('tr')!).getByText('Enough')).toBeInTheDocument();
    expect(within(screen.getByText('XLR Cable, 50 ft').closest('tr')!).getByText('none spare · 4 are in container kits')).toBeInTheDocument();
    expect(getEquipmentNeeded).toHaveBeenCalledWith('g1', '2026-10-11T03:00:00Z', '2026-10-11T06:00:00Z', 'America/Los_Angeles', 'org-1', undefined);
  });

  it('a date-only gig is headed with its own day, even at UTC+12 or later (#230 follow-up)', async () => {
    vi.mocked(getEquipmentNeeded).mockResolvedValue({ overlapping: 0, rows: [row({})] } as any);
    // Date-only gigs are stored at noon UTC: midnight next day in Auckland (UTC+13 in October).
    renderWithQuery(<EquipmentNeededTable organizationId="org-1" gigId="g1" gigStart="2026-10-10T12:00:00.000Z" gigEnd="2026-10-10T12:00:00.000Z" gigTimezone="Pacific/Auckland" />);
    expect(await screen.findByText('Equipment needed on Oct 10, 2026')).toBeInTheDocument();
  });

  it('says so when the counts can\'t be loaded, instead of hiding the table', async () => {
    vi.mocked(getEquipmentNeeded).mockRejectedValue(new Error('network'));
    renderWithQuery(<EquipmentNeededTable organizationId="org-1" gigId="g1" gigStart="2026-10-10T18:00:00" gigEnd="2026-10-10T23:00:00" />);
    expect(await screen.findByText("Couldn't load equipment counts.")).toBeInTheDocument();
  });

  it('shows nothing when the gig needs no equipment', async () => {
    vi.mocked(getEquipmentNeeded).mockResolvedValue({ overlapping: 0, rows: [] });
    const { container } = renderWithQuery(<EquipmentNeededTable organizationId="org-1" gigId="g1" gigStart="2026-10-10T18:00:00" gigEnd="2026-10-10T23:00:00" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  // #242 item 7: a line asking a lot for more than it holds.
  it('says when a kit asks a lot for more than it holds, or a lot that\'s gone', async () => {
    vi.mocked(getEquipmentNeeded).mockResolvedValue({ overlapping: 0, rows: [
      row({ itemId: 'xlr', name: 'XLR', lotShortfalls: [{ asked: 6, has: 4 }] }),
      row({ itemId: 'dmx', name: 'DMX', lotShortfalls: [{ asked: 2, has: 0 }] }),
    ] } as any);
    renderWithQuery(<EquipmentNeededTable gigId="g1" gigStart="2026-10-10T19:00:00Z" gigEnd="2026-10-10T23:00:00Z" organizationId="org-1" />);
    const xlr = (await screen.findByText('XLR')).closest('tr')!;
    expect(within(xlr).getByText('asks for 6, lot has 4')).toBeInTheDocument();
    const dmx = screen.getByText('DMX').closest('tr')!;
    expect(within(dmx).getByText('asks for 2, lot is missing')).toBeInTheDocument();
  });
});

// A10: the table loads again when the gig or its kits change. Holds before and after the move
// to react-query.
describe('EquipmentNeededTable: data loading (A10)', () => {
  const base = { gigStart: '2026-10-11T03:00:00Z', gigEnd: '2026-10-11T06:00:00Z', gigTimezone: 'America/Los_Angeles', organizationId: 'org-1' };

  it('loads again when the kits change (invalidateAfterGigKitsChange) and when the gig changes', async () => {
    vi.mocked(getEquipmentNeeded).mockClear();
    vi.mocked(getEquipmentNeeded).mockResolvedValue({ overlapping: 0, rows: [row({ name: 'Cable' })] } as any);
    const { rerender, queryClient } = renderWithQuery(<EquipmentNeededTable gigId="g1" {...base} />);
    await screen.findByText('Cable');
    await act(async () => { await invalidateAfterGigKitsChange(queryClient, { gigId: 'g1' }); });
    await waitFor(() => expect(getEquipmentNeeded).toHaveBeenCalledTimes(2));
    rerender(<EquipmentNeededTable gigId="g2" {...base} />);
    await waitFor(() => expect(getEquipmentNeeded).toHaveBeenLastCalledWith('g2', base.gigStart, base.gigEnd, base.gigTimezone, 'org-1', undefined));
  });
});

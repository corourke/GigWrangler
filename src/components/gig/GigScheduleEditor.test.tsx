import { renderWithQuery as render } from '../../test/renderWithQuery';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import GigScheduleEditor from './GigScheduleEditor';
import { getGigScheduleEntries, updateGigScheduleEntries } from '../../services/gigSchedule.service';

vi.mock('../../services/gigSchedule.service', () => ({
  getGigScheduleEntries: vi.fn(),
  updateGigScheduleEntries: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/gig.service', () => ({ getGigParticipants: vi.fn().mockResolvedValue([]) }));

// #12: schedule item types are free text; the UI offers these defaults.
const DEFAULTS = ['Load-In', 'Act Arrival', 'Soundcheck', 'Doors', 'Set', 'Load-Out', 'Return'];
const NY = 'America/New_York';

const entry = (over: Record<string, unknown>) => ({
  gig_id: 'g', label: null, end_time: null, act_participant_id: null, notes: null, sort_order: 0, ...over,
});
const EXISTING = [
  entry({ id: 'e1', activity_type: 'Load-In', start_time: '2026-07-12T16:00:00Z' }),
  entry({ id: 'e2', activity_type: 'Rehearsal', start_time: '2026-07-12T20:00:00Z', end_time: '2026-07-12T21:30:00Z' }),
  // Written before #12, when a custom item was an "Other" type plus a label.
  entry({ id: 'e3', activity_type: 'Other', label: 'Meet & greet', start_time: '2026-07-13T02:00:00Z' }),
];

function renderEditor(props: Partial<React.ComponentProps<typeof GigScheduleEditor>> = {}) {
  return render(<GigScheduleEditor gigId="g" gigStart="2026-07-12T16:00:00Z" timeZone={NY} {...props} />);
}
const rows = async () => (await screen.findAllByRole('row')).slice(1); // skip the header row
const cell = (row: HTMLElement, label: string) => within(row).getByLabelText(label) as HTMLInputElement;
const lastSaved = () => vi.mocked(updateGigScheduleEntries).mock.calls.at(-1)![1] as any[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGigScheduleEntries).mockResolvedValue(EXISTING as any);
});

describe('GigScheduleEditor table (#12)', () => {
  it('shows dated rows in the gig time zone', async () => {
    renderEditor();
    const [loadIn, rehearsal, meet] = await rows();
    expect(cell(loadIn, 'Date').value).toBe('2026-07-12');
    expect(cell(loadIn, 'Start').value).toBe('12:00');
    expect(cell(rehearsal, 'Start').value).toBe('16:00');
    expect(cell(rehearsal, 'End').value).toBe('17:30');
    // 02:00 UTC on the 13th is still the 12th in New York.
    expect(cell(meet, 'Date').value).toBe('2026-07-12');
    expect(cell(meet, 'Start').value).toBe('22:00');
  });

  it('shows each item as free text, suggesting the defaults', async () => {
    renderEditor();
    const [loadIn, rehearsal, meet] = await rows();
    expect(cell(loadIn, 'Item').value).toBe('Load-In');
    expect(cell(rehearsal, 'Item').value).toBe('Rehearsal');
    expect(cell(meet, 'Item').value).toBe('Meet & greet');
    const list = document.getElementById(cell(loadIn, 'Item').getAttribute('list')!)!;
    expect([...list.querySelectorAll('option')].map((o) => o.value)).toEqual(DEFAULTS);
  });

  it('pre-fills an empty schedule with the default items and saves nothing yet', async () => {
    vi.mocked(getGigScheduleEntries).mockResolvedValue([]);
    renderEditor();
    const all = await rows();
    expect(all.map((r) => cell(r, 'Item').value)).toEqual(DEFAULTS);
    expect(all.every((r) => cell(r, 'Start').value === '')).toBe(true);
    expect(all.every((r) => cell(r, 'Date').value === '2026-07-12')).toBe(true);
    expect(updateGigScheduleEntries).not.toHaveBeenCalled();
  });

  it('saves a time entered in the gig time zone, and only rows that have a start', async () => {
    vi.mocked(getGigScheduleEntries).mockResolvedValue([]);
    const view = renderEditor();
    const [loadIn] = await rows();
    fireEvent.change(cell(loadIn, 'Start'), { target: { value: '12:30' } });
    view.unmount(); // saves what is pending
    expect(lastSaved()).toEqual([
      expect.objectContaining({ activity_type: 'Load-In', label: null, start_time: '2026-07-12T16:30:00.000Z', end_time: null }),
    ]);
  });

  it('saves a typed item as the item itself, and a pre-#12 item without its old label', async () => {
    const view = renderEditor();
    const [, rehearsal] = await rows();
    fireEvent.change(cell(rehearsal, 'Item'), { target: { value: 'Line check' } });
    view.unmount();
    const saved = lastSaved();
    expect(saved.find((e) => e.id === 'e2')).toEqual(expect.objectContaining({ activity_type: 'Line check', label: null }));
    expect(saved.find((e) => e.id === 'e3')).toEqual(expect.objectContaining({ activity_type: 'Meet & greet', label: null }));
  });

  it('treats an end before the start as the next morning', async () => {
    const view = renderEditor();
    const [, rehearsal] = await rows();
    fireEvent.change(cell(rehearsal, 'Start'), { target: { value: '23:00' } });
    fireEvent.change(cell(rehearsal, 'End'), { target: { value: '01:00' } });
    view.unmount();
    expect(lastSaved().find((e) => e.id === 'e2')).toEqual(
      expect.objectContaining({ start_time: '2026-07-13T03:00:00.000Z', end_time: '2026-07-13T05:00:00.000Z' }),
    );
  });

  it('adds a blank custom row and removes rows', async () => {
    renderEditor();
    await rows();
    fireEvent.click(screen.getByRole('button', { name: /add custom item/i }));
    const all = await rows();
    expect(all).toHaveLength(4);
    expect(cell(all[3], 'Item').value).toBe('');
    fireEvent.click(within(all[0]).getByRole('button', { name: 'Remove Load-In' }));
    expect(await rows()).toHaveLength(3);
  });

  it('reports the scheduled times so the gig can widen to cover them', async () => {
    const onEntriesChange = vi.fn();
    renderEditor({ onEntriesChange });
    const [loadIn] = await rows();
    act(() => { fireEvent.change(cell(loadIn, 'Start'), { target: { value: '09:00' } }); });
    expect(onEntriesChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      { start_time: '2026-07-12T13:00:00.000Z', end_time: null },
      { start_time: '2026-07-12T20:00:00.000Z', end_time: '2026-07-12T21:30:00.000Z' },
    ]));
  });
});

describe('GigScheduleEditor saving (#12)', () => {
  it('saves an edit made just before the editor unmounts', async () => {
    const view = renderEditor();
    const [loadIn] = await rows();
    fireEvent.change(cell(loadIn, 'Notes'), { target: { value: 'Dock B' } });
    view.unmount();
    expect(updateGigScheduleEntries).toHaveBeenCalledTimes(1);
    expect(lastSaved().find((e) => e.id === 'e1')).toEqual(expect.objectContaining({ notes: 'Dock B' }));
  });
});

describe('GigScheduleEditor deletes only rows it loaded (#92)', () => {
  const lastLoadedIds = () => vi.mocked(updateGigScheduleEntries).mock.calls.at(-1)![3];

  it('passes the rows it loaded, so a removed one is deleted and rows added elsewhere are not', async () => {
    const view = renderEditor();
    const [, rehearsal] = await rows();
    fireEvent.click(within(rehearsal).getByRole('button', { name: 'Remove Rehearsal' }));
    view.unmount();
    expect(lastSaved().map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(lastLoadedIds()).toEqual(['e1', 'e2', 'e3']);
  });

  it('gives a new row the id its save returned, and deletes it if it is then removed', async () => {
    vi.mocked(updateGigScheduleEntries).mockImplementation(async (_gigId, entries) => ({
      ids: entries.map((e) => e.id ?? 'new-1'),
    }));
    const view = renderEditor();
    await rows();
    fireEvent.click(screen.getByRole('button', { name: /add custom item/i }));
    const added = (await rows())[3];
    fireEvent.change(cell(added, 'Item'), { target: { value: 'Interview' } });
    fireEvent.change(cell(added, 'Start'), { target: { value: '18:00' } });
    await vi.waitFor(() => expect(updateGigScheduleEntries).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(lastSaved().find((e) => e.activity_type === 'Interview').id).toBeUndefined();
    // The schedule now also holds a row someone else added; the editor must not take its id.
    vi.mocked(getGigScheduleEntries).mockResolvedValue([
      entry({ id: 'theirs', activity_type: 'Doors', start_time: '2026-07-12T15:00:00Z' }),
      ...EXISTING,
      entry({ id: 'new-1', activity_type: 'Interview', start_time: '2026-07-12T22:00:00Z' }),
    ] as any);

    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const interview = (await rows()).find((r) => cell(r, 'Item').value === 'Interview')!;
    fireEvent.click(within(interview).getByRole('button', { name: 'Remove Interview' }));
    view.unmount();
    expect(lastSaved().map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(lastLoadedIds()).toEqual(expect.arrayContaining(['e1', 'e2', 'e3', 'new-1']));
    expect(lastLoadedIds()).not.toContain('theirs');
  });
});

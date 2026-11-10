import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/idb/store', () => ({
  idbStore: {
    getDayOfShow: vi.fn(),
    putDayOfShow: vi.fn(async () => {}),
    getAllDayOfShow: vi.fn(async () => []),
    deleteDayOfShow: vi.fn(async () => {}),
    getGigs: vi.fn(async () => []),
  },
}));
vi.mock('../gig.service', () => ({ getGig: vi.fn() }));
vi.mock('../gigParticipantContacts.service', () => ({ getAllGigContacts: vi.fn() }));
vi.mock('../attachment.service', () => ({ getEntityAttachments: vi.fn() }));
vi.mock('./myAssignments.service', () => ({ loadMyUpcomingAssignments: vi.fn() }));
vi.mock('./dayOfShowFiles.service', () => ({ removeSavedDocumentsForGig: vi.fn(async () => {}) }));
vi.mock('./packingList.service', () => ({ packingListService: { fetchUpcomingGigs: vi.fn() } }));

import { idbStore } from '../../utils/idb/store';
import { getGig } from '../gig.service';
import { getAllGigContacts } from '../gigParticipantContacts.service';
import { getEntityAttachments } from '../attachment.service';
import { loadMyUpcomingAssignments } from './myAssignments.service';
import { packingListService } from './packingList.service';
import { removeSavedDocumentsForGig } from './dayOfShowFiles.service';
import {
  buildDayOfShowSheet,
  loadDayOfShowSheet,
  loadTodayCandidates,
  pruneDayOfShow,
  shouldSaveAhead,
} from './dayOfShow.service';

const GIG = {
  id: 'gig-1',
  title: 'Test Show',
  start: '2026-11-10T20:00:00Z',
  end: '2026-11-11T01:00:00Z',
  timezone: 'America/Los_Angeles',
  all_day: false,
  status: 'Booked',
  notes: 'private notes',
  financials: [{ amount: 1000 }],
  participants: [
    { id: 'p-venue', role: 'Venue', organization_id: 'org-v', organization: { id: 'org-v', name: 'Test Hall', address_line1: '1 Main St', city: 'Town', state: 'CA', postal_code: '90000', phone_number: '555-0100', notes: 'internal' } },
    { id: 'p-act', role: 'Act', organization_id: 'org-a', organization: { id: 'org-a', name: 'Test Band' } },
  ],
  schedule_entries: [
    { id: 's2', activity_type: 'Doors', start_time: '2026-11-11T03:00:00Z', end_time: null, label: null, act_participant: null },
    { id: 's1', activity_type: 'LoadIn', start_time: '2026-11-10T22:00:00Z', end_time: '2026-11-10T23:00:00Z', label: 'Load in', act_participant: null },
  ],
  staff_slots: [
    {
      id: 'slot-1', role: 'FOH Engineer',
      staff_assignments: [
        { id: 'as-1', user_id: 'u1', status: 'Confirmed', rate: 50, fee: 300, user: { id: 'u1', first_name: 'Sam', last_name: 'Crew', phone: '555-0101', email: 's@example.com' } },
        { id: 'as-2', user_id: 'u2', status: 'Declined', fee: 200, user: { id: 'u2', first_name: 'No', last_name: 'Show', phone: '555-0102' } },
      ],
    },
  ],
};
const CONTACTS = [
  { id: 'c1', gig_id: 'gig-1', organization_id: 'org-v', user_id: 'u9', is_primary_contact: true, title: 'Production manager', created_at: '', user: { id: 'u9', first_name: 'Pat', last_name: 'Venue', email: 'p@example.com', phone: '555-0109' } },
];
const DOCS = [{ id: 'att-1', file_name: 'stage-plot.pdf', file_path: 'org/att-1.pdf', entity_attachment_id: 'ea-1' }];

const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true });

describe('buildDayOfShowSheet', () => {
  it('keeps the schedule, venue, contacts, crew and documents, sorted', () => {
    const sheet = buildDayOfShowSheet(GIG, CONTACTS as any, DOCS, 1000);
    expect(sheet.gig_id).toBe('gig-1');
    expect(sheet.saved_at).toBe(1000);
    expect(sheet.schedule.map((e) => e.id)).toEqual(['s1', 's2']);
    expect(sheet.venue).toMatchObject({ name: 'Test Hall', address_line1: '1 Main St', city: 'Town', phone_number: '555-0100' });
    expect(sheet.contacts).toEqual([
      expect.objectContaining({ name: 'Pat Venue', title: 'Production manager', org_name: 'Test Hall', org_role: 'Venue', phone: '555-0109' }),
    ]);
    expect(sheet.crew).toEqual([expect.objectContaining({ name: 'Sam Crew', role: 'FOH Engineer', phone: '555-0101' })]);
    expect(sheet.documents).toEqual([{ id: 'att-1', file_name: 'stage-plot.pdf', file_path: 'org/att-1.pdf' }]);
  });

  it('saves no money, rates, fees or internal notes', () => {
    const text = JSON.stringify(buildDayOfShowSheet(GIG, CONTACTS as any, DOCS, 1000));
    expect(text).not.toMatch(/financials|"rate"|"fee"|"amount"|private notes|internal/);
  });
});

describe('loadDayOfShowSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getGig as any).mockResolvedValue(GIG);
    (getAllGigContacts as any).mockResolvedValue(CONTACTS);
    (getEntityAttachments as any).mockResolvedValue(DOCS);
    (idbStore.getAllDayOfShow as any).mockResolvedValue([]);
  });

  it('hands over the saved copy first, then saves and returns the fresh one', async () => {
    setOnline(true);
    const saved = { gig_id: 'gig-1', saved_at: 1 };
    (idbStore.getDayOfShow as any).mockResolvedValue(saved);
    const onCached = vi.fn();
    const sheet = await loadDayOfShowSheet('gig-1', onCached);
    expect(onCached).toHaveBeenCalledWith(saved);
    expect(sheet?.venue?.name).toBe('Test Hall');
    expect(idbStore.putDayOfShow).toHaveBeenCalledWith(expect.objectContaining({ gig_id: 'gig-1' }));
  });

  it('offline, returns the saved copy without asking the server', async () => {
    setOnline(false);
    const saved = { gig_id: 'gig-1', saved_at: 1 };
    (idbStore.getDayOfShow as any).mockResolvedValue(saved);
    expect(await loadDayOfShowSheet('gig-1', vi.fn())).toBe(saved);
    expect(getGig).not.toHaveBeenCalled();
    setOnline(true);
  });

  it('offline with nothing saved, returns null', async () => {
    setOnline(false);
    (idbStore.getDayOfShow as any).mockResolvedValue(undefined);
    expect(await loadDayOfShowSheet('gig-1', vi.fn())).toBeNull();
    setOnline(true);
  });

  it('keeps the saved copy when the server cannot be reached (poor signal)', async () => {
    setOnline(true);
    const saved = { gig_id: 'gig-1', saved_at: 1 };
    (idbStore.getDayOfShow as any).mockResolvedValue(saved);
    (getAllGigContacts as any).mockRejectedValue(new Error('Failed to fetch'));
    expect(await loadDayOfShowSheet('gig-1', vi.fn())).toBe(saved);
    expect(idbStore.putDayOfShow).not.toHaveBeenCalled();
  });

  it('with nothing saved, a failed load is an error', async () => {
    setOnline(true);
    (idbStore.getDayOfShow as any).mockResolvedValue(undefined);
    (getGig as any).mockRejectedValue(new Error('Failed to fetch'));
    await expect(loadDayOfShowSheet('gig-1', vi.fn())).rejects.toThrow('Failed to fetch');
  });
});

describe('pruneDayOfShow', () => {
  it('removes sheets for gigs that ended more than a day ago', async () => {
    const now = new Date('2026-11-10T12:00:00Z').getTime();
    (idbStore.getAllDayOfShow as any).mockResolvedValue([
      { gig_id: 'old', gig: { end: '2026-11-09T06:00:00Z', start: '2026-11-09T01:00:00Z' } },
      { gig_id: 'recent', gig: { end: '2026-11-10T06:00:00Z', start: '2026-11-10T01:00:00Z' } },
      { gig_id: 'soon', gig: { end: '2026-11-12T06:00:00Z', start: '2026-11-12T01:00:00Z' } },
    ]);
    await pruneDayOfShow(now);
    expect(idbStore.deleteDayOfShow).toHaveBeenCalledTimes(1);
    expect(idbStore.deleteDayOfShow).toHaveBeenCalledWith('old');
  });

  it("removes those gigs' saved documents too", async () => {
    vi.mocked(removeSavedDocumentsForGig).mockClear();
    const now = new Date('2026-11-10T12:00:00Z').getTime();
    (idbStore.getAllDayOfShow as any).mockResolvedValue([
      { gig_id: 'old', gig: { end: '2026-11-09T06:00:00Z', start: '2026-11-09T01:00:00Z' } },
      { gig_id: 'soon', gig: { end: '2026-11-12T06:00:00Z', start: '2026-11-12T01:00:00Z' } },
    ]);
    await pruneDayOfShow(now);
    expect(removeSavedDocumentsForGig).toHaveBeenCalledTimes(1);
    expect(removeSavedDocumentsForGig).toHaveBeenCalledWith('old');
  });
});

describe('shouldSaveAhead', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('saves a gig on today or starting within 24 hours', () => {
    expect(shouldSaveAhead({ ...GIG, start: '2026-11-11T10:00:00Z', end: '2026-11-11T14:00:00Z' }, now)).toBe(true);
    expect(shouldSaveAhead({ ...GIG, start: '2026-11-10T11:00:00Z', end: '2026-11-10T14:00:00Z' }, now)).toBe(true);
  });
  it('does not save one further out, ended, or cancelled', () => {
    expect(shouldSaveAhead({ ...GIG, start: '2026-11-12T20:00:00Z', end: '2026-11-12T23:00:00Z' }, now)).toBe(false);
    expect(shouldSaveAhead({ ...GIG, start: '2026-11-10T01:00:00Z', end: '2026-11-10T05:00:00Z' }, now)).toBe(false);
    expect(shouldSaveAhead({ ...GIG, start: '2026-11-10T14:00:00Z', status: 'Cancelled' }, now)).toBe(false);
  });
});

describe('loadTodayCandidates', () => {
  beforeEach(() => vi.clearAllMocks());

  it("Staff: the person's own assigned gigs (device copy first)", async () => {
    setOnline(true);
    (loadMyUpcomingAssignments as any).mockImplementation(async (onCached: any) => {
      onCached([{ gig: { id: 'cached' } }]);
      return [{ gig: { id: 'g1', title: 'A' } }, { gig: { id: 'g2', title: 'B' } }];
    });
    const onCached = vi.fn();
    const gigs = await loadTodayCandidates({ role: 'Staff', orgId: 'org-1' }, onCached);
    expect(onCached).toHaveBeenCalledWith([expect.objectContaining({ id: 'cached' })]);
    expect(gigs.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(packingListService.fetchUpcomingGigs).not.toHaveBeenCalled();
  });

  it("Admin and Manager: the selected organization's gigs only", async () => {
    setOnline(true);
    (packingListService.fetchUpcomingGigs as any).mockResolvedValue([
      { id: 'mine', participants: [{ organization_id: 'org-1' }] },
      { id: 'other', participants: [{ organization_id: 'org-2' }] },
    ]);
    const gigs = await loadTodayCandidates({ role: 'Manager', orgId: 'org-1' }, vi.fn());
    expect(gigs.map((g) => g.id)).toEqual(['mine']);
  });

  it('Admin and Manager offline: the gigs saved on the device', async () => {
    setOnline(false);
    (idbStore.getGigs as any).mockResolvedValue([
      { id: 'mine', participants: [{ organization_id: 'org-1' }] },
      { id: 'other', participants: [{ organization_id: 'org-2' }] },
    ]);
    const gigs = await loadTodayCandidates({ role: 'Admin', orgId: 'org-1' }, vi.fn());
    expect(gigs.map((g) => g.id)).toEqual(['mine']);
    expect(packingListService.fetchUpcomingGigs).not.toHaveBeenCalled();
    setOnline(true);
  });

  it('Admin and Manager: falls back to the device copy when the server cannot be reached', async () => {
    setOnline(true);
    (packingListService.fetchUpcomingGigs as any).mockRejectedValue(new Error('Failed to fetch'));
    (idbStore.getGigs as any).mockResolvedValue([{ id: 'mine', participants: [{ organization_id: 'org-1' }] }]);
    const gigs = await loadTodayCandidates({ role: 'Admin', orgId: 'org-1' }, vi.fn());
    expect(gigs.map((g) => g.id)).toEqual(['mine']);
  });
});

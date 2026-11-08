import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getGig,
  getGigsForOrganization,
  getGigOptionsForOrganization,
  deleteGig,
  getGigFinancials,
  getGigFinancialsByPurchaseId,
  deleteGigFinancial,
  removeKitFromGig,
  getGigKits,
  getAllGigAccountingSummaries,
  completeStaffAssignment,
  createGig,
  updateGig,
  duplicateGig,
} from './gig.service';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';

vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('../utils/supabase/auth-utils', () => ({
  requireAuth: vi.fn(),
}));

// googleCalendar.service is called by deleteGigFromAllCalendars; stub it out
vi.mock('./googleCalendar.service', () => ({
  syncGigToCalendar: vi.fn().mockResolvedValue(undefined),
  deleteGigFromCalendar: vi.fn().mockResolvedValue(undefined),
  deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
  debouncedSyncGigToAllCalendars: vi.fn(),
}));
import { deleteCalendarEvent, deleteGigFromCalendar } from './googleCalendar.service';

// Helper: build a chainable Supabase query builder that resolves to `result`
function makeChain(result: { data: any; error: any }) {
  const chain: any = {};
  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'in', 'not', 'is', 'or',
    'order', 'limit', 'lte', 'gte',
  ];
  chainMethods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain); });
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  // Make the chain thenable so it resolves when awaited directly
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

// activityLog.service is used for tracking changes
vi.mock('./activityLog.service', () => ({
  logActivity: vi.fn().mockResolvedValue({ success: true }),
}));

import { logActivity } from './activityLog.service';

describe('gig.service', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    (createClient as any).mockReturnValue(mockSupabase);
  });

  // ─── getGig ───────────────────────────────────────────────────────────────

  describe('getGig', () => {
    it('returns a processed gig with staff_slots when found', async () => {
      const rawGig = {
        id: 'gig-1',
        title: 'Test Gig',
        start: '2026-03-15T20:00:00.000Z',
        end: '2026-03-16T01:00:00.000Z',
        participants: [],
        staff_slots: [
          {
            id: 'slot-1',
            role_info: { name: 'Sound Engineer' },
            required_count: 2,
            assignments: [
              { id: 'assign-1', user_id: 'user-1', user: { id: 'user-1', email: 'a@b.com' } },
            ],
          },
        ],
        kit_assignments: [],
        financials: [],
      };

      mockSupabase.from.mockReturnValue(makeChain({ data: rawGig, error: null }));

      const result = await getGig('gig-1');

      expect(result.id).toBe('gig-1');
      expect(result.staff_slots[0].role).toBe('Sound Engineer');
      expect(result.staff_slots[0].count).toBe(2);
      expect(result.staff_slots[0].staff_assignments[0].user_id).toBe('user-1');
    });

    it('queries the gigs table with the correct id', async () => {
      const chain = makeChain({ data: { id: 'gig-1', title: 'G', staff_slots: [], participants: [] }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      await getGig('gig-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('gigs');
      expect(chain.eq).toHaveBeenCalledWith('id', 'gig-1');
      expect(chain.single).toHaveBeenCalled();
    });

    it("loads each crew member's phone for the gig sheet (#12)", async () => {
      const chain = makeChain({ data: { id: 'gig-1', title: 'G', staff_slots: [], participants: [] }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      await getGig('gig-1');

      const selectArg = String(chain.select.mock.calls[0][0]).replace(/\s+/g, ' ');
      expect(selectArg).toMatch(/assignments:gig_staff_assignments\( \*, user:user_id\([^)]*\bphone\b[^)]*\)/);
    });

    it('throws when gig is not found (null data)', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));

      await expect(getGig('missing-id')).rejects.toThrow('Gig not found');
    });

    it('propagates Supabase errors via handleApiError', async () => {
      const dbError = new Error('relation does not exist');
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: dbError }));

      await expect(getGig('gig-1')).rejects.toThrow('relation does not exist');
    });
  });

  // ─── getGigsForOrganization ────────────────────────────────────────────────

  describe('getGigsForOrganization', () => {
    it('returns an empty array when the org has no gig participants', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: [], error: null }));

      const result = await getGigsForOrganization('org-1');

      expect(result).toEqual([]);
    });

    it('fetches gig IDs from gig_participants then loads gig details', async () => {
      const participantChain = makeChain({ data: [{ gig_id: 'gig-1' }], error: null });
      const gigChain = makeChain({
        data: [
          {
            id: 'gig-1',
            title: 'Festival',
            participants: [
              { role: 'Venue', organization: { id: 'venue-org', name: 'The Venue' } },
              { role: 'Act', organization: { id: 'act-org', name: 'The Band' } },
            ],
          },
        ],
        error: null,
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_participants') return participantChain;
        if (table === 'gigs') return gigChain;
        return makeChain({ data: [], error: null });
      });

      const result = await getGigsForOrganization('org-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('gig-1');
      // Venue and act are mapped for UI convenience
      expect(result[0].venue?.name).toBe('The Venue');
      expect(result[0].act?.name).toBe('The Band');
    });

    it('propagates errors from the gig_participants query', async () => {
      const dbError = new Error('connection refused');
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: dbError }));

      await expect(getGigsForOrganization('org-1')).rejects.toThrow('connection refused');
    });
  });

  // ─── getGigOptionsForOrganization ─────────────────────────────────────────

  describe('getGigOptionsForOrganization', () => {
    const setup = (gigRows: any[]) => {
      const participantChain = makeChain({ data: [{ gig_id: 'gig-1' }], error: null });
      const gigChain = makeChain({ data: gigRows, error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_participants') return participantChain;
        if (table === 'gigs') return gigChain;
        return makeChain({ data: [], error: null });
      });
      return { participantChain, gigChain };
    };

    it('returns [] when the org participates in no gigs', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: [], error: null }));
      expect(await getGigOptionsForOrganization('org-1')).toEqual([]);
    });

    it('maps venue/act names and does not filter by date when no aroundDate is given', async () => {
      const { gigChain } = setup([
        {
          id: 'gig-1',
          title: 'Festival',
          start: '2026-06-01T18:00:00Z',
          participants: [
            { role: 'Venue', organization: { name: 'The Venue' } },
            { role: 'Act', organization: { name: 'The Band' } },
          ],
        },
      ]);

      const result = await getGigOptionsForOrganization('org-1');

      expect(gigChain.or).not.toHaveBeenCalled();
      expect(result).toEqual([
        { id: 'gig-1', title: 'Festival', start: '2026-06-01T18:00:00Z', venue: { name: 'The Venue' }, act: { name: 'The Band' } },
      ]);
    });

    it('scopes to a ±window around aroundDate and always keeps the linked gig', async () => {
      const { gigChain } = setup([]);

      await getGigOptionsForOrganization('org-1', { aroundDate: '2025-12-19', windowDays: 21, ensureGigId: 'gig-far' });

      expect(gigChain.or).toHaveBeenCalledTimes(1);
      const orArg = (gigChain.or as any).mock.calls[0][0] as string;
      expect(orArg).toContain('start.gte.2025-11-28T00:00:00.000Z');
      expect(orArg).toContain('start.lte.2026-01-09T23:59:59.999Z');
      expect(orArg).toContain('id.eq.gig-far');
    });

    it('ignores an unparseable aroundDate rather than filtering everything out', async () => {
      const { gigChain } = setup([]);
      await getGigOptionsForOrganization('org-1', { aroundDate: 'not-a-date' });
      expect(gigChain.or).not.toHaveBeenCalled();
    });
  });

  // ─── deleteGig ────────────────────────────────────────────────────────────

  describe('deleteGig', () => {
    it('deletes the gig from the database', async () => {
      // gig_sync_status returns empty → no calendar deletions needed
      const syncStatusChain = makeChain({ data: [], error: null });
      // .select() returns the deleted row → confirms a row was actually removed
      const gigDeleteChain = makeChain({ data: [{ id: 'gig-1' }], error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_sync_status') return syncStatusChain;
        if (table === 'gigs') return gigDeleteChain;
        return makeChain({ data: [], error: null });
      });

      const result = await deleteGig('gig-1');

      expect(result).toEqual({ success: true });
      expect(gigDeleteChain.delete).toHaveBeenCalled();
      expect(gigDeleteChain.eq).toHaveBeenCalledWith('id', 'gig-1');
    });

    it('propagates Supabase errors on delete', async () => {
      const dbError = new Error('foreign key constraint');
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_sync_status') return makeChain({ data: [], error: null });
        return makeChain({ data: null, error: dbError });
      });

      await expect(deleteGig('gig-1')).rejects.toThrow('foreign key constraint');
    });

    // A refused delete affects 0 rows with no error; deleteGig says why (#175 review).
    const refused = (gig: any, children: any[], participants: any[]) => {
      const gigCalls = [
        makeChain({ data: [], error: null }),     // the delete: no rows
        makeChain({ data: gig, error: null }),    // the gig and its owner
        makeChain({ data: children, error: null }), // its child gigs
      ];
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gigs') return gigCalls.shift() ?? makeChain({ data: [], error: null });
        if (table === 'gig_participants') return makeChain({ data: participants, error: null });
        return makeChain({ data: [], error: null });
      });
    };
    const owner = { id: 'gig-1', owner_organization_id: 'org-o' };

    it('throws when no row was deleted and the gig is gone', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      refused(null, [], []);
      await expect(deleteGig('gig-1')).rejects.toThrow(/not found/i);
    });

    it('says to cancel instead when another claimed organization is on the gig', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      refused(owner, [], [
        { organization_id: 'org-o', organization: { claimed: true } },
        { organization_id: 'org-b', organization: { claimed: true } },
      ]);
      await expect(deleteGig('gig-1')).rejects.toThrow(/other organizations.*Cancel/is);
    });

    it('says so when the gig has child gigs', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      refused(owner, [{ id: 'child-1' }], [{ organization_id: 'org-o', organization: { claimed: true } }]);
      await expect(deleteGig('gig-1')).rejects.toThrow(/child gigs/i);
    });

    it("says only the owner's Admins can delete when nothing else is in the way", async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      refused(owner, [], [
        { organization_id: 'org-o', organization: { claimed: true } },
        { organization_id: 'org-v', organization: { claimed: false } },
      ]);
      await expect(deleteGig('gig-1')).rejects.toThrow(/Admin of the gig's owner organization/);
    });

    // #175: calendar events go only once the gig is gone. Their sync rows are
    // deleted with the gig, so the event ids are read first.
    it('removes the calendar events only after the gig was deleted', async () => {
      const syncChain = makeChain({ data: [{ user_id: 'u-1', google_event_id: 'ev-1' }], error: null });
      const gigChain = makeChain({ data: [{ id: 'gig-1' }], error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_sync_status') return syncChain;
        if (table === 'gigs') return gigChain;
        return makeChain({ data: [], error: null });
      });

      await deleteGig('gig-1');

      expect(deleteCalendarEvent).toHaveBeenCalledWith('u-1', 'ev-1');
      expect((deleteCalendarEvent as any).mock.invocationCallOrder[0])
        .toBeGreaterThan(gigChain.delete.mock.invocationCallOrder[0]);
    });

    it('leaves the calendar alone when the delete is refused', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_sync_status') return makeChain({ data: [{ user_id: 'u-1', google_event_id: 'ev-1' }], error: null });
        return makeChain({ data: [], error: null });
      });

      await expect(deleteGig('gig-1')).rejects.toThrow();
      expect(deleteCalendarEvent).not.toHaveBeenCalled();
      expect(deleteGigFromCalendar).not.toHaveBeenCalled();
    });

    it('still reports the delete as done when a calendar event fails to go', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (deleteCalendarEvent as any).mockRejectedValueOnce(new Error('token expired'));
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_sync_status') return makeChain({ data: [{ user_id: 'u-1', google_event_id: 'ev-1' }], error: null });
        if (table === 'gigs') return makeChain({ data: [{ id: 'gig-1' }], error: null });
        return makeChain({ data: [], error: null });
      });

      await expect(deleteGig('gig-1')).resolves.toEqual({ success: true });
    });
  });

  // ─── getGigFinancials ─────────────────────────────────────────────────────

  describe('getGigFinancials', () => {
    it('returns financials for a gig', async () => {
      const mockFins = [
        { id: 'fin-1', amount: 500, gig_id: 'gig-1' },
        { id: 'fin-2', amount: 250, gig_id: 'gig-1' },
      ];
      const chain = makeChain({ data: mockFins, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getGigFinancials('gig-1');

      expect(result).toHaveLength(2);
      expect(mockSupabase.from).toHaveBeenCalledWith('gig_financials');
      expect(chain.eq).toHaveBeenCalledWith('gig_id', 'gig-1');
    });

    it('filters by organizationId when provided', async () => {
      const chain = makeChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      await getGigFinancials('gig-1', 'org-1');

      expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });

    it('returns empty array when there are no financials', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));
      const result = await getGigFinancials('gig-1');
      expect(result).toEqual([]);
    });

    it('enriches each row with attachment_count from entity_attachments in one extra query', async () => {
      const finChain = makeChain({
        data: [
          { id: 'fin-1', amount: 500, gig_id: 'gig-1' },
          { id: 'fin-2', amount: 250, gig_id: 'gig-1' },
        ],
        error: null,
      });
      const attachChain = makeChain({
        data: [{ entity_id: 'fin-1' }, { entity_id: 'fin-1' }],
        error: null,
      });
      mockSupabase.from.mockImplementation((table: string) =>
        table === 'entity_attachments' ? attachChain : finChain
      );

      const result = (await getGigFinancials('gig-1')) as any[];

      expect(attachChain.eq).toHaveBeenCalledWith('entity_type', 'gig_financial');
      expect(attachChain.in).toHaveBeenCalledWith('entity_id', ['fin-1', 'fin-2']);
      expect(result.find((r) => r.id === 'fin-1')?.attachment_count).toBe(2);
      expect(result.find((r) => r.id === 'fin-2')?.attachment_count).toBe(0);
    });

    it('leaves attachment_count at 0 when the attachment lookup fails', async () => {
      const finChain = makeChain({ data: [{ id: 'fin-1', amount: 10, gig_id: 'gig-1' }], error: null });
      const attachChain = makeChain({ data: null, error: { message: 'boom' } });
      mockSupabase.from.mockImplementation((table: string) =>
        table === 'entity_attachments' ? attachChain : finChain
      );

      const result = (await getGigFinancials('gig-1')) as any[];
      expect(result[0].attachment_count).toBe(0);
    });
  });

  // ─── getGigFinancialsByPurchaseId ─────────────────────────────────────────

  describe('getGigFinancialsByPurchaseId', () => {
    it('queries gig_financials by purchase_id', async () => {
      const chain = makeChain({ data: [{ id: 'fin-1', purchase_id: 'line-1', gig_id: 'gig-1' }], error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getGigFinancialsByPurchaseId('line-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('gig_financials');
      expect(chain.eq).toHaveBeenCalledWith('purchase_id', 'line-1');
      expect(result).toHaveLength(1);
    });

    it('returns [] when nothing is linked', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));
      const result = await getGigFinancialsByPurchaseId('line-x');
      expect(result).toEqual([]);
    });
  });

  // ─── deleteGigFinancial ───────────────────────────────────────────────────

  describe('deleteGigFinancial', () => {
    it('deletes the financial record by id', async () => {
      const chain = makeChain({ data: [{ id: 'fin-1' }], error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await deleteGigFinancial('fin-1');

      expect(result).toEqual({ success: true });
      expect(mockSupabase.from).toHaveBeenCalledWith('gig_financials');
      expect(chain.eq).toHaveBeenCalledWith('id', 'fin-1');
    });

    it('propagates errors on delete', async () => {
      const dbError = new Error('not found');
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: dbError }));

      await expect(deleteGigFinancial('fin-1')).rejects.toThrow('not found');
    });

    it('throws when no row was deleted (RLS denied)', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: [], error: null }));
      await expect(deleteGigFinancial('fin-1')).rejects.toThrow(/permission|not found/i);
    });

    it('removes the storage blob only for attachments this record solely owns', async () => {
      const remove = vi.fn().mockResolvedValue({ data: [], error: null });
      mockSupabase.storage = { from: vi.fn().mockReturnValue({ remove }) };

      // att-sole is referenced once (only by this record), att-shared twice.
      const refCounts: Record<string, number> = { 'att-sole': 1, 'att-shared': 2 };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_financials') return makeChain({ data: [{ id: 'fin-1' }], error: null });
        if (table === 'entity_attachments') {
          const chain: any = makeChain({
            data: [
              { attachment_id: 'att-sole', attachment: { file_path: 'org/sole.pdf' } },
              { attachment_id: 'att-shared', attachment: { file_path: 'org/shared.pdf' } },
            ],
            error: null,
          });
          chain.select = vi.fn((_cols: string, opts?: any) =>
            opts?.head
              ? { eq: (_c: string, v: string) => Promise.resolve({ data: null, error: null, count: refCounts[v] ?? 1 }) }
              : chain
          );
          return chain;
        }
        return makeChain({ data: [], error: null });
      });

      const result = await deleteGigFinancial('fin-1');

      expect(result).toEqual({ success: true });
      expect(remove).toHaveBeenCalledWith(['org/sole.pdf']);
      expect(remove).not.toHaveBeenCalledWith(expect.arrayContaining(['org/shared.pdf']));
    });
  });

  // ─── removeKitFromGig ─────────────────────────────────────────────────────

  describe('removeKitFromGig', () => {
    it('deletes the kit assignment by id', async () => {
      const chain = makeChain({ data: [{ id: 'assignment-1' }], error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await removeKitFromGig('assignment-1');

      expect(result).toEqual({ success: true });
      expect(mockSupabase.from).toHaveBeenCalledWith('gig_kit_assignments');
      expect(chain.eq).toHaveBeenCalledWith('id', 'assignment-1');
    });

    it('propagates errors on delete', async () => {
      const dbError = new Error('constraint violation');
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: dbError }));

      await expect(removeKitFromGig('assignment-1')).rejects.toThrow('constraint violation');
    });

    it('throws when no row was deleted (RLS denied)', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: [], error: null }));
      await expect(removeKitFromGig('assignment-1')).rejects.toThrow(/permission|not found/i);
    });
  });

  // ─── getGigKits ───────────────────────────────────────────────────────────

  describe('getGigKits', () => {
    it('returns kit assignments for a gig', async () => {
      const mockAssignments = [
        { id: 'assign-1', gig_id: 'gig-1', kit: { id: 'kit-1', name: 'PA System' } },
      ];
      const chain = makeChain({ data: mockAssignments, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getGigKits('gig-1');

      expect(result).toHaveLength(1);
      expect(chain.eq).toHaveBeenCalledWith('gig_id', 'gig-1');
    });

    it('filters by organizationId when provided', async () => {
      const chain = makeChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      await getGigKits('gig-1', 'org-1');

      expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });

    it('returns empty array when data is null', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));
      const result = await getGigKits('gig-1');
      expect(result).toEqual([]);
    });
  });

  // ─── getAllGigAccountingSummaries ──────────────────────────────────────────

  describe('getAllGigAccountingSummaries', () => {
    function setupMocks({
      participants = [],
      gigs = [],
      financials = [],
      assignments = [],
    }: {
      participants?: any[];
      gigs?: any[];
      financials?: any[];
      assignments?: any[];
    }) {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_participants') return makeChain({ data: participants, error: null });
        if (table === 'gigs') return makeChain({ data: gigs, error: null });
        if (table === 'gig_financials') return makeChain({ data: financials, error: null });
        if (table === 'gig_staff_assignments') return makeChain({ data: assignments, error: null });
        return makeChain({ data: [], error: null });
      });
    }

    it('returns empty array when org has no gigs', async () => {
      setupMocks({ participants: [] });
      const result = await getAllGigAccountingSummaries('org-1');
      expect(result).toEqual([]);
    });

    // Money rows in the post-2026-10 shape: direction + stage.
    const fin = (id: string, gig_id: string, direction: 'in' | 'out', stage: string, amount: number, extra: any = {}) => ({
      id, gig_id, direction, stage, amount,
      amount_settled: stage === 'paid' ? amount : null,
      due_date: null,
      paid_at: stage === 'paid' ? '2026-01-02T00:00:00Z' : null,
      ...extra,
    });
    const pastGig = { id: 'gig-1', title: 'G', status: 'Completed', start: '2026-01-01T00:00:00Z', end: '2026-01-01T23:00:00Z' };

    it('correctly groups financials by gig across multiple gigs', async () => {
      setupMocks({
        participants: [{ gig_id: 'gig-1' }, { gig_id: 'gig-2' }],
        gigs: [
          { id: 'gig-1', title: 'Gig One', status: 'Completed', start: '2026-01-01T00:00:00Z', end: '2026-01-01T23:00:00Z' },
          { id: 'gig-2', title: 'Gig Two', status: 'Booked', start: '2099-06-01T00:00:00Z', end: '2099-06-01T23:00:00Z' },
        ],
        financials: [
          // $1,000 contract: $500 received, $500 balance still contracted
          fin('f1', 'gig-1', 'in', 'contracted', 500),
          fin('f2', 'gig-1', 'in', 'paid', 500),
          fin('f3', 'gig-2', 'in', 'contracted', 2000),
        ],
        assignments: [],
      });

      const result = await getAllGigAccountingSummaries('org-1');

      expect(result).toHaveLength(2);

      const gig1 = result.find(r => r.gigId === 'gig-1')!;
      expect(gig1.contractAmount).toBe(1000);
      expect(gig1.received).toBe(500);
      expect(gig1.outstandingRevenue).toBe(500);
      expect(gig1.dueRevenue).toBe(500); // the gig is over
      expect(gig1.moneyInBadge).toEqual({ label: 'Payment due', tone: 'attention' });

      const gig2 = result.find(r => r.gigId === 'gig-2')!;
      expect(gig2.contractAmount).toBe(2000);
      expect(gig2.received).toBe(0);
      expect(gig2.dueRevenue).toBe(0); // not yet played
      expect(gig2.moneyInBadge).toEqual({ label: 'Contracted', tone: 'pending' });
    });

    it('counts money in from accepted on, never bids, declines or cancellations', async () => {
      setupMocks({
        participants: [{ gig_id: 'gig-1' }],
        gigs: [pastGig],
        financials: [
          fin('f1', 'gig-1', 'in', 'accepted', 1000),
          fin('f2', 'gig-1', 'in', 'quoted', 1800),
          fin('f3', 'gig-1', 'in', 'declined', 500),
          fin('f4', 'gig-1', 'in', 'cancelled', 700),
        ],
      });
      const [result] = await getAllGigAccountingSummaries('org-1');
      expect(result.contractAmount).toBe(1000);
    });

    it('counts an overpaid fee at what was received', async () => {
      setupMocks({
        participants: [{ gig_id: 'gig-1' }],
        gigs: [pastGig],
        financials: [fin('f1', 'gig-1', 'in', 'paid', 300, { amount_settled: 450 })],
      });
      const [result] = await getAllGigAccountingSummaries('org-1');
      expect(result.contractAmount).toBe(450);
      expect(result.received).toBe(450);
      expect(result.outstandingRevenue).toBe(0);
    });

    it('classifies money out: committed and unpaid as expected, paid as actual, bids and declines excluded', async () => {
      setupMocks({
        participants: [{ gig_id: 'gig-1' }],
        gigs: [pastGig],
        financials: [
          fin('f1', 'gig-1', 'in', 'contracted', 5000),
          fin('f2', 'gig-1', 'out', 'quoted', 400),
          fin('f3', 'gig-1', 'out', 'contracted', 600),
          fin('f4', 'gig-1', 'out', 'invoiced', 400),
          fin('f5', 'gig-1', 'out', 'paid', 800),
          fin('f6', 'gig-1', 'out', 'declined', 999),
          fin('f7', 'gig-1', 'out', 'cancelled', 999),
        ],
      });

      const [result] = await getAllGigAccountingSummaries('org-1');
      expect(result.expectedSubContractCosts).toBe(1000);
      expect(result.actualCosts).toBe(800);
      expect(result.paymentsToMake).toBe(1000);
      expect(result.totalCosts).toBe(1800);
    });

    it('counts staff owed (a finalized assignment) in paymentsToMake, and booked staff as expected cost', async () => {
      setupMocks({
        participants: [{ gig_id: 'gig-1' }],
        gigs: [pastGig],
        financials: [
          fin('f1', 'gig-1', 'in', 'contracted', 5000),
          fin('labor-fin', 'gig-1', 'out', 'invoiced', 200, { staff_assignment_id: 'assign-1' }),
        ],
        assignments: [
          { id: 'assign-1', fee: 200, rate: null, status: 'Confirmed', completed_at: '2026-01-02T00:00:00Z', slot: { gig_id: 'gig-1', organization_id: 'org-1' } },
          { id: 'assign-2', fee: 150, rate: null, status: 'Confirmed', completed_at: null, slot: { gig_id: 'gig-1', organization_id: 'org-1' } },
        ],
      });

      const [result] = await getAllGigAccountingSummaries('org-1');
      expect(result.paymentsToMake).toBe(200);
      expect(result.paymentsDue).toBe(200);
      expect(result.expectedStaffCosts).toBe(150);
      expect(result.totalCosts).toBe(350);
    });

    it('projects a booked rate over the units the gig spans, not once (#213)', async () => {
      // 18:00–03:00 in Los Angeles: 9 hours, one day
      const nightGig = { ...pastGig, start: '2026-10-11T01:00:00Z', end: '2026-10-11T10:00:00Z', timezone: 'America/Los_Angeles' };
      const slot = { gig_id: 'gig-1', organization_id: 'org-1' };
      setupMocks({
        participants: [{ gig_id: 'gig-1' }],
        gigs: [nightGig],
        assignments: [
          { id: 'hand', fee: null, rate: 35, rate_unit: 'hour', status: 'Confirmed', completed_at: null, slot },
          { id: 'foh', fee: 350, rate: null, rate_unit: 'hour', status: 'Requested', completed_at: null, slot },
          // Finalized: its money-out row counts instead, at rate × units entered
          { id: 'done', fee: null, rate: 35, rate_unit: 'hour', units_completed: 4, status: 'Confirmed', completed_at: '2026-10-12T00:00:00Z', slot },
        ],
      });

      const [result] = await getAllGigAccountingSummaries('org-1');
      expect(result.expectedStaffCosts).toBe(315 + 350);
    });

    it('treats an invoice as not yet due until its due date, even after the gig', async () => {
      setupMocks({
        participants: [{ gig_id: 'gig-1' }],
        gigs: [pastGig],
        financials: [fin('f1', 'gig-1', 'in', 'invoiced', 750, { due_date: '2099-10-26' })],
      });
      const [result] = await getAllGigAccountingSummaries('org-1');
      expect(result.outstandingRevenue).toBe(750);
      expect(result.dueRevenue).toBe(0);
      expect(result.moneyInBadge?.tone).toBe('pending');
    });

    it('derivates paymentHealth as all-clear when no outstanding revenue or payments', async () => {
      setupMocks({
        participants: [{ gig_id: 'gig-1' }],
        gigs: [{ ...pastGig, status: 'Settled' }],
        financials: [fin('f1', 'gig-1', 'in', 'paid', 1000)],
      });

      const [result] = await getAllGigAccountingSummaries('org-1');
      expect(result.paymentHealth).toBe('all-clear');
    });

    it('derivates paymentHealth as revenue-outstanding when revenue outstanding but no payments due', async () => {
      setupMocks({
        participants: [{ gig_id: 'gig-1' }],
        gigs: [pastGig],
        financials: [fin('f1', 'gig-1', 'in', 'contracted', 400), fin('f2', 'gig-1', 'in', 'paid', 600)],
      });

      const [result] = await getAllGigAccountingSummaries('org-1');
      expect(result.paymentHealth).toBe('revenue-outstanding');
    });

    it('derivates paymentHealth as payments-due when payments owed but revenue fully received', async () => {
      setupMocks({
        participants: [{ gig_id: 'gig-1' }],
        gigs: [pastGig],
        financials: [fin('f1', 'gig-1', 'in', 'paid', 1000), fin('f3', 'gig-1', 'out', 'contracted', 300)],
      });

      const [result] = await getAllGigAccountingSummaries('org-1');
      expect(result.paymentHealth).toBe('payments-due');
    });

    it('derivates paymentHealth as both when both outstanding revenue and payments due', async () => {
      setupMocks({
        participants: [{ gig_id: 'gig-1' }],
        gigs: [pastGig],
        financials: [
          fin('f1', 'gig-1', 'in', 'contracted', 500),
          fin('f2', 'gig-1', 'in', 'paid', 500),
          fin('f3', 'gig-1', 'out', 'contracted', 300),
        ],
      });

      const [result] = await getAllGigAccountingSummaries('org-1');
      expect(result.paymentHealth).toBe('both');
    });

    it('propagates Supabase errors from gig_participants query', async () => {
      const dbError = new Error('permission denied');
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_participants') return makeChain({ data: null, error: dbError });
        return makeChain({ data: [], error: null });
      });

      await expect(getAllGigAccountingSummaries('org-1')).rejects.toThrow('permission denied');
    });
  });

  // ─── completeStaffAssignment ──────────────────────────────────────────────

  // B5: finalizing is one database call (finalize_staff_assignment), which writes the labor row
  // (amount, gig-date dating, Contract labor) and the assignment's back-link together.
  describe('completeStaffAssignment', () => {
    beforeEach(() => {
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1' } });
    });

    it('finalizes in one call, passing the units as entered', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: 'fin-1', error: null });
      const result = await completeStaffAssignment('as-1', 2.5);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('finalize_staff_assignment', { p_assignment_id: 'as-1', p_units: 2.5 });
      expect(mockSupabase.from).not.toHaveBeenCalledWith('gig_financials');
      expect(result).toEqual({ success: true, financialId: 'fin-1' });
    });

    it('passes 0 units as 0, and no units (a fee) as null', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: 'fin-1', error: null });
      await completeStaffAssignment('as-1', 0);
      await completeStaffAssignment('as-2');
      expect(mockSupabase.rpc).toHaveBeenNthCalledWith(1, 'finalize_staff_assignment', { p_assignment_id: 'as-1', p_units: 0 });
      expect(mockSupabase.rpc).toHaveBeenNthCalledWith(2, 'finalize_staff_assignment', { p_assignment_id: 'as-2', p_units: null });
    });

    it('fails, writing nothing else, when the database refuses (e.g. a filed year)', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'The 2025 tax year is locked (filed).' } });
      await expect(completeStaffAssignment('as-1')).rejects.toBeTruthy();
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  // ─── createGig ──────────────────────────────────────────────────────────────

  describe('createGig', () => {
    it('logs gig.created after successful RPC', async () => {
      const gigData = { title: 'New Gig', primary_organization_id: 'org-1' };
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [{ id: 'new-gig-1' }], error: null });
      mockSupabase.from.mockReturnValue(makeChain({ data: { name: 'Acme' }, error: null }));
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1', email: 'a@b.com', user_metadata: { first_name: 'Jane', last_name: 'Doe' } } });

      await createGig(gigData);

      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'gig.created',
        entity_id: 'new-gig-1',
        context: expect.objectContaining({
          actor_display_name: 'Jane Doe',
          gig_title: 'New Gig'
        })
      }));
    });

    it('dates the import payment in the gig\'s time zone, not UTC (#93)', async () => {
      // 8 PM Pacific on March 14 is already March 15 in UTC.
      const gigData = {
        title: 'Late Show', primary_organization_id: 'org-1', amount: '500',
        start: '2026-03-15T03:00:00.000Z', timezone: 'America/Los_Angeles',
      };
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [{ id: 'new-gig-1' }], error: null });
      const financialsChain = makeChain({ data: { id: 'fin-1' }, error: null });
      mockSupabase.from.mockImplementation((table: string) =>
        table === 'gig_financials' ? financialsChain : makeChain({ data: { id: 'new-gig-1', name: 'Acme' }, error: null })
      );
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1' } });

      await createGig(gigData, { skipActivityLog: true });

      const inserted = financialsChain.insert.mock.calls[0][0];
      expect(inserted).toMatchObject({ description: 'Payment from import', date: '2026-03-14' });
    });

    // #175: only an Admin of the owner can delete a gig, so the rollback of a failed import
    // payment can't always run. Then the error says plainly what happened.
    describe('when the import payment fails', () => {
      const gigData = { title: 'Late Show', primary_organization_id: 'org-1', amount: '500', start: '2026-03-15T03:00:00.000Z', timezone: 'UTC' };
      const setup = (deleted: any[]) => {
        mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [{ id: 'new-gig-1' }], error: null });
        mockSupabase.from.mockImplementation((table: string) =>
          table === 'gig_financials' ? makeChain({ data: null, error: { message: 'payment refused' } })
            : table === 'gigs' ? makeChain({ data: deleted, error: null })
              : makeChain({ data: null, error: null }));
        (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1' } });
      };

      it('rolls the gig back when it can, and reports the payment error', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        setup([{ id: 'new-gig-1' }]);
        await expect(createGig(gigData, { skipActivityLog: true })).rejects.toMatchObject({ message: 'payment refused' });
        consoleError.mockRestore();
      });

      it('says the gig was created without its payment when it can\'t be rolled back', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        setup([]);
        await expect(createGig(gigData, { skipActivityLog: true })).rejects.toThrow(
          "The gig was created, but its payment couldn't be saved (payment refused). Add the payment on the gig's Financials.");
        consoleError.mockRestore();
      });
    });

    it('skips logging when skipActivityLog is true', async () => {
      const gigData = { title: 'New Gig', primary_organization_id: 'org-1' };
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [{ id: 'new-gig-1' }], error: null });
      // Mock for getGig
      mockSupabase.from.mockReturnValue(makeChain({ data: { id: 'new-gig-1', title: 'New Gig', staff_slots: [], participants: [] }, error: null }));
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1' } });

      await createGig(gigData, { skipActivityLog: true });

      expect(logActivity).not.toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'gig.created'
      }));
    });
  });

  // ─── updateGig ──────────────────────────────────────────────────────────────

  describe('updateGig', () => {
    it('logs gig.notes_updated when notes change', async () => {
      const gigId = 'gig-1';
      const gigData = { notes: 'Updated notes' };
      const preGig = { id: 'gig-1', title: 'Test Gig', notes: 'Old notes' };

      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1' } });
      
      // Mock participants and memberships for permission check
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_participants') return makeChain({ data: [{ organization_id: 'org-1' }], error: null });
        if (table === 'organization_members') return makeChain({ data: [{ organization_id: 'org-1', role: 'Admin' }], error: null });
        if (table === 'organizations') return makeChain({ data: { name: 'Acme' }, error: null });
        if (table === 'gigs') return makeChain({ data: preGig, error: null });
        return makeChain({ data: [], error: null });
      });

      await updateGig(gigId, gigData);

      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'gig.notes_updated',
        context: expect.objectContaining({
          notes_changed: true
        })
      }));
    });

    it('does NOT log gig.notes_updated when notes are unchanged', async () => {
      const gigId = 'gig-1';
      const gigData = { notes: 'Old notes' };
      const preGig = { id: 'gig-1', title: 'Test Gig', notes: 'Old notes' };

      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1' } });
      
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_participants') return makeChain({ data: [{ organization_id: 'org-1' }], error: null });
        if (table === 'organization_members') return makeChain({ data: [{ organization_id: 'org-1', role: 'Admin' }], error: null });
        if (table === 'organizations') return makeChain({ data: { name: 'Acme' }, error: null });
        if (table === 'gigs') return makeChain({ data: preGig, error: null });
        return makeChain({ data: [], error: null });
      });

      await updateGig(gigId, gigData);

      expect(logActivity).not.toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'gig.notes_updated'
      }));
    });

    it('does NOT log gig.rescheduled when only the title changes (start/end resubmitted as an equivalent instant)', async () => {
      const gigId = 'gig-1';
      // Same instants as preGig, just formatted the way the browser's
      // Date#toISOString() would produce them, rather than Postgres' `+00:00` form.
      const gigData = {
        title: 'New Title',
        start: '2026-09-20T14:00:00.000Z',
        end: '2026-09-20T18:00:00.000Z',
      };
      const preGig = { id: 'gig-1', title: 'Old Title', notes: 'notes', start: '2026-09-20T14:00:00+00:00', end: '2026-09-20T18:00:00+00:00' };

      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1' } });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_participants') return makeChain({ data: [{ organization_id: 'org-1' }], error: null });
        if (table === 'organization_members') return makeChain({ data: [{ organization_id: 'org-1', role: 'Admin' }], error: null });
        if (table === 'organizations') return makeChain({ data: { name: 'Acme' }, error: null });
        if (table === 'gigs') return makeChain({ data: preGig, error: null });
        return makeChain({ data: [], error: null });
      });

      await updateGig(gigId, gigData);

      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'gig.renamed' }));
      expect(logActivity).not.toHaveBeenCalledWith(expect.objectContaining({ event_type: 'gig.rescheduled' }));
    });

    it('still logs gig.rescheduled when start/end actually change', async () => {
      const gigId = 'gig-1';
      const gigData = {
        start: '2026-09-21T14:00:00.000Z',
        end: '2026-09-21T18:00:00.000Z',
      };
      const preGig = { id: 'gig-1', title: 'Old Title', notes: 'notes', start: '2026-09-20T14:00:00+00:00', end: '2026-09-20T18:00:00+00:00' };

      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1' } });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_participants') return makeChain({ data: [{ organization_id: 'org-1' }], error: null });
        if (table === 'organization_members') return makeChain({ data: [{ organization_id: 'org-1', role: 'Admin' }], error: null });
        if (table === 'organizations') return makeChain({ data: { name: 'Acme' }, error: null });
        if (table === 'gigs') return makeChain({ data: preGig, error: null });
        return makeChain({ data: [], error: null });
      });

      await updateGig(gigId, gigData);

      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'gig.rescheduled',
        context: expect.objectContaining({
          from: { start: preGig.start, end: preGig.end },
          to: { start: gigData.start, end: gigData.end },
        }),
      }));
    });
  });

  // ─── duplicateGig ───────────────────────────────────────────────────────────

  describe('duplicateGig', () => {
    // create_gig_complex returns the new id; user_manages_gig_owner says whether the caller may copy.
    const dupRpc = (newId: string, managesOwner = true) => vi.fn((name: string) => Promise.resolve(
      name === 'user_manages_gig_owner' ? { data: managesOwner, error: null } : { data: [{ id: newId }], error: null }));

    // #175 (Cameron 10-13): only the owner's Admins and Managers duplicate a gig.
    it("refuses a caller who doesn't manage the gig's owner, and creates nothing", async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const originalGig = {
        id: 'g', title: 'Original', start: '2026-03-15T20:00:00.000Z', end: '2026-03-16T01:00:00.000Z', timezone: 'UTC',
        owner_organization_id: 'org-a', participants: [{ organization_id: 'org-a', role: 'Venue' }],
      };
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1', user_metadata: {} } });
      mockSupabase.from.mockImplementation((table: string) =>
        makeChain({ data: table === 'gigs' ? originalGig : [], error: null }));
      mockSupabase.rpc = dupRpc('new', false);

      await expect(duplicateGig('g')).rejects.toThrow("Only the gig owner's Admins and Managers can duplicate it.");
      expect(mockSupabase.rpc).toHaveBeenCalledWith('user_manages_gig_owner', { p_gig_id: 'g', p_user: 'user-1' });
      expect(mockSupabase.rpc).not.toHaveBeenCalledWith('create_gig_complex', expect.anything());
    });

    // #175 (Cameron 10-13): a copy gets only the original's active participants.
    it('leaves out participants that are Inactive on the original', async () => {
      const originalGig = {
        id: 'g', title: 'Original', start: '2026-03-15T20:00:00.000Z', end: '2026-03-16T01:00:00.000Z', timezone: 'UTC',
        owner_organization_id: 'org-a',
        participants: [
          { organization_id: 'org-a', role: 'Production', inactive: false },
          { organization_id: 'org-b', role: 'Sound', inactive: true },
          { organization_id: 'org-c', role: 'Act' },
        ],
      };
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1', user_metadata: {} } });
      mockSupabase.from.mockImplementation((table: string) =>
        makeChain({ data: table === 'gigs' ? originalGig : [], error: null }));
      mockSupabase.rpc = dupRpc('new');

      await duplicateGig('g');

      const rpcArgs = mockSupabase.rpc.mock.calls.find((c: any[]) => c[0] === 'create_gig_complex')[1];
      expect(rpcArgs.p_participants.map((p: any) => p.organization_id)).toEqual(['org-a', 'org-c']);
    });

    it('logs gig.created for duplicated gig', async () => {
      const gigId = 'original-gig-id';
      const originalGig = { 
        id: gigId, 
        title: 'Original', 
        primary_organization_id: 'org-1', 
        participants: [], 
        staff_slots: [],
        start: '2026-03-15T20:00:00.000Z',
        end: '2026-03-16T01:00:00.000Z',
        timezone: 'UTC'
      };
      const newGigId = 'new-gig-id';

      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1', user_metadata: { first_name: 'Jane', last_name: 'Doe' } } });
      
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gigs') return makeChain({ data: originalGig, error: null });
        if (table === 'organizations') return makeChain({ data: { name: 'Acme' }, error: null });
        return makeChain({ data: [], error: null });
      });
      mockSupabase.rpc = dupRpc(newGigId);

      await duplicateGig(gigId);

      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'gig.created',
        entity_id: newGigId,
        context: expect.objectContaining({
          gig_title: 'Original (Copy)'
        })
      }));
    });

    it("copies only the primary org's staff slots and kit assignments (#61)", async () => {
      const originalGig = {
        id: 'g', title: 'Original', start: '2026-03-15T20:00:00.000Z', end: '2026-03-16T01:00:00.000Z', timezone: 'UTC',
        owner_organization_id: 'org-a',
        participants: [
          { organization_id: 'org-a', role: 'Venue' },
          { organization_id: 'org-b', role: 'Sound' },
        ],
        // RLS can still return another org's slot the caller is booked into.
        staff_slots: [
          { staff_role_id: 'r', organization_id: 'org-a', required_count: 1, staff_assignments: [] },
          { staff_role_id: 'r', organization_id: 'org-b', required_count: 1, staff_assignments: [] },
        ],
        kit_assignments: [
          { kit_id: 'kit-a', organization_id: 'org-a' },
          { kit_id: 'kit-b', organization_id: 'org-b' },
        ],
      };
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1', user_metadata: {} } });
      const kitChain = makeChain({ data: [], error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gigs') return makeChain({ data: originalGig, error: null });
        if (table === 'gig_kit_assignments') return kitChain;
        return makeChain({ data: [], error: null });
      });
      mockSupabase.rpc = dupRpc('new');

      await duplicateGig('g');

      const rpcArgs = mockSupabase.rpc.mock.calls.find((c: any[]) => c[0] === 'create_gig_complex')[1];
      expect(rpcArgs.p_staff_slots.map((s: any) => s.organization_id)).toEqual(['org-a']);
      expect(kitChain.insert).toHaveBeenCalledWith([expect.objectContaining({ kit_id: 'kit-a', organization_id: 'org-a' })]);
    });

    // #175 review: a copy the database refuses (e.g. a locked tax year) is reported, not dropped.
    it("reports the parts that couldn't be copied", async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const originalGig = {
        id: 'g', title: 'Original', start: '2026-03-15T20:00:00.000Z', end: '2026-03-16T01:00:00.000Z', timezone: 'UTC',
        owner_organization_id: 'org-a',
        participants: [{ organization_id: 'org-a', role: 'Venue' }],
        financials: [{ organization_id: 'org-a', amount: 100, direction: 'in', stage: 'accepted' }],
        kit_assignments: [{ kit_id: 'kit-a', organization_id: 'org-a' }],
      };
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1', user_metadata: {} } });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gigs') return makeChain({ data: originalGig, error: null });
        if (table === 'gig_financials') return makeChain({ data: null, error: { message: 'tax year 2025 is locked' } });
        if (table === 'gig_kit_assignments') return makeChain({ data: null, error: { message: 'kit is retired' } });
        return makeChain({ data: [], error: null });
      });
      mockSupabase.rpc = dupRpc('new');

      await expect(duplicateGig('g')).rejects.toThrow(/copied.*financials \(tax year 2025 is locked\).*kit assignments \(kit is retired\)/s);
      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'gig.created', entity_id: 'new' }));
    });

    it('sends staff slots in the shape create_gig_complex reads, unstaffed (#102)', async () => {
      // create_gig_complex reads v_slot->>'role' (a role name), 'organization_id',
      // 'required_count' and 'notes'. It never reads staff_role_id or assignments.
      const originalGig = {
        id: 'g', title: 'Original', start: '2026-03-15T20:00:00.000Z', end: '2026-03-16T01:00:00.000Z', timezone: 'UTC',
        owner_organization_id: 'org-a',
        participants: [{ organization_id: 'org-a', role: 'Venue' }],
        staff_slots: [
          {
            id: 'slot-1', gig_id: 'g', staff_role_id: 'role-uuid', organization_id: 'org-a',
            required_count: 2, notes: 'Bring headset',
            role_info: { name: 'Audio Engineer' },
            assignments: [{ id: 'sa-1', user_id: 'u-1', status: 'Confirmed', rate: 50, fee: null, notes: null }],
          },
        ],
      };
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1', user_metadata: {} } });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gigs') return makeChain({ data: originalGig, error: null });
        return makeChain({ data: [], error: null });
      });
      mockSupabase.rpc = dupRpc('new');

      await duplicateGig('g');

      const rpcArgs = mockSupabase.rpc.mock.calls.find((c: any[]) => c[0] === 'create_gig_complex')[1];
      expect(rpcArgs.p_staff_slots).toEqual([
        { role: 'Audio Engineer', organization_id: 'org-a', required_count: 2, notes: 'Bring headset' },
      ]);
    });

    // #175: the copy belongs to the owner organization, not the Venue.
    it("copies the gig for its owner organization, with only the owner's financials, slots and kits", async () => {
      const originalGig = {
        id: 'g', title: 'Original', start: '2026-03-15T20:00:00.000Z', end: '2026-03-16T01:00:00.000Z', timezone: 'UTC',
        owner_organization_id: 'org-owner',
        participants: [
          { organization_id: 'org-venue', role: 'Venue' },
          { organization_id: 'org-owner', role: 'Production' },
        ],
        staff_slots: [
          { role: 'Audio', organization_id: 'org-venue', required_count: 1 },
          { role: 'Audio', organization_id: 'org-owner', required_count: 1 },
        ],
        kit_assignments: [
          { kit_id: 'kit-v', organization_id: 'org-venue' },
          { kit_id: 'kit-o', organization_id: 'org-owner' },
        ],
        financials: [
          { organization_id: 'org-venue', amount: 100, direction: 'out', stage: 'accepted' },
          { organization_id: 'org-owner', amount: 200, direction: 'in', stage: 'accepted' },
        ],
      };
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1', user_metadata: {} } });
      const finChain = makeChain({ data: [], error: null });
      const kitChain = makeChain({ data: [], error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gigs') return makeChain({ data: originalGig, error: null });
        if (table === 'gig_financials') return finChain;
        if (table === 'gig_kit_assignments') return kitChain;
        return makeChain({ data: [], error: null });
      });
      mockSupabase.rpc = dupRpc('new');

      await duplicateGig('g');

      const rpcArgs = mockSupabase.rpc.mock.calls.find((c: any[]) => c[0] === 'create_gig_complex')[1];
      expect(rpcArgs.p_gig_data.primary_organization_id).toBe('org-owner');
      expect(rpcArgs.p_staff_slots.map((s: any) => s.organization_id)).toEqual(['org-owner']);
      expect(finChain.insert).toHaveBeenCalledWith([expect.objectContaining({ organization_id: 'org-owner', amount: 200 })]);
      expect(kitChain.insert).toHaveBeenCalledWith([expect.objectContaining({ kit_id: 'kit-o' })]);
    });
  });
});

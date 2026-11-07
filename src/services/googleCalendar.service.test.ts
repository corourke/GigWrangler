import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../utils/supabase/client';

// Mock Supabase client
vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

describe('googleCalendar.service', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      upsert: vi.fn().mockReturnThis(),
      functions: {
        invoke: vi.fn(),
      },
    };

    (createClient as any).mockReturnValue(mockSupabase);
  });

  it('should export required functions', async () => {
    const service = await import('./googleCalendar.service');

    expect(typeof service.getGoogleAuthUrl).toBe('function');
    expect(typeof service.getUserGoogleCalendarSettings).toBe('function');
    expect(typeof service.connectGoogleCalendar).toBe('function');
    expect(typeof service.disconnectGoogleCalendar).toBe('function');
    expect(typeof service.getGigSyncStatus).toBe('function');
    expect(typeof service.updateGigSyncStatus).toBe('function');
    expect(typeof service.syncGigToCalendar).toBe('function');
    expect(typeof service.deleteGigFromCalendar).toBe('function');
    expect(typeof service.getUserCalendars).toBe('function');
    expect(typeof service.getSyncLogs).toBe('function');
    expect(typeof service.getSyncStatusSummary).toBe('function');
  });

  describe('all-day gig calendar sync bug regression tests', () => {
    it('correctly identifies an all-day gig and formats exclusive end date (+1 day)', async () => {
      const service = await import('./googleCalendar.service');

      // 1. Mock settings query response
      const mockSettings = {
        id: 'settings-1',
        user_id: 'user-123',
        calendar_id: 'cal-123',
        calendar_name: 'Primary',
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        is_enabled: true,
        sync_filters: {},
      };

      // 2. Mock gig sync status query (no existing sync)
      mockSupabase.maybeSingle
        .mockResolvedValueOnce({ data: mockSettings, error: null }) // first maybeSingle call for settings
        .mockResolvedValueOnce({ data: null, error: null })          // second maybeSingle call for existing gig sync
        .mockResolvedValueOnce({                                     // third maybeSingle call for update gig sync status return
          data: {
            id: 'sync-status-1',
            gig_id: 'gig-123',
            user_id: 'user-123',
            google_event_id: 'google-event-123',
            sync_status: 'synced',
          },
          error: null
        });

      // 3. Mock edge function invoke success
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { event_id: 'google-event-123' },
        error: null,
      });

      // June 26, 2026 is noon UTC. This represents an all-day event
      const gigData = {
        title: 'All-Day Gig',
        start: '2026-06-26T12:00:00.000Z',
        end: '2026-06-26T12:00:00.000Z',
        timezone: 'America/Los_Angeles',
        description: 'Testing all-day logic',
        venue: { name: 'Main Stage' },
      };

      const result = await service.syncGigToCalendar('user-123', 'gig-123', gigData);

      expect(result.eventId).toBe('google-event-123');
      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'server/integrations/google-calendar/events',
        expect.objectContaining({
          body: expect.objectContaining({
            event_data: expect.objectContaining({
              summary: 'All-Day Gig',
              start: { date: '2026-06-26' },
              end: { date: '2026-06-27' }, // Exclusive end date (inclusive end date + 1 day)
            }),
          }),
        })
      );
    });

    it('sends a timed gig as all-day in its local dates, times and venue in the description (#117)', async () => {
      const service = await import('./googleCalendar.service');

      const mockSettings = {
        id: 'settings-1',
        user_id: 'user-123',
        calendar_id: 'cal-123',
        calendar_name: 'Primary',
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        is_enabled: true,
        sync_filters: {},
      };

      mockSupabase.maybeSingle
        .mockResolvedValueOnce({ data: mockSettings, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: {
            id: 'sync-status-1',
            gig_id: 'gig-123',
            user_id: 'user-123',
            google_event_id: 'google-event-123',
            sync_status: 'synced',
          },
          error: null
        });

      mockSupabase.functions.invoke.mockResolvedValue({
        data: { event_id: 'google-event-123' },
        error: null,
      });

      // Timed gig, 1:00 PM to 4:00 PM in Los Angeles
      const gigData = {
        title: 'Evening Show',
        start: '2026-06-26T20:00:00.000Z',
        end: '2026-06-26T23:00:00.000Z',
        timezone: 'America/Los_Angeles',
        description: '3-hour set',
        venue: { name: 'Club Room' },
      };

      const result = await service.syncGigToCalendar('user-123', 'gig-123', gigData);

      expect(result.eventId).toBe('google-event-123');
      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'server/integrations/google-calendar/events',
        expect.objectContaining({
          body: expect.objectContaining({
            event_data: expect.objectContaining({
              summary: 'Evening Show',
              start: { date: '2026-06-26' },
              end: { date: '2026-06-27' },
              location: 'Club Room',
              description: expect.stringMatching(/^1:00 PM – 4:00 PM PDT\nClub Room\n\n3-hour set\n\n\[View in GigWrangler\]/),
            }),
          }),
        })
      );
    });
  });

  describe('sync error diagnostics (issue #9 regression)', () => {
    const mockSettings = {
      id: 'settings-1',
      user_id: 'user-123',
      calendar_id: 'cal-123',
      calendar_name: 'Act4Audio',
      token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      is_enabled: true,
      sync_filters: {},
    };

    function makeFunctionsHttpError(body: any, status: number) {
      const mockResponse = {
        json: () => Promise.resolve(body),
        clone: () => ({ json: () => Promise.resolve(body) }),
        status,
      };
      return { name: 'FunctionsHttpError', context: { response: mockResponse } };
    }

    it('persists Google\'s real permission error, not the generic Supabase wrapper text, when a sync fails', async () => {
      const service = await import('./googleCalendar.service');

      mockSupabase.maybeSingle
        .mockResolvedValueOnce({ data: mockSettings, error: null }) // settings lookup
        .mockResolvedValueOnce({ data: null, error: null })          // no existing sync
        .mockResolvedValueOnce({                                     // updateGigSyncStatus's own upsert result
          data: { id: 'sync-status-1', gig_id: 'gig-123', user_id: 'user-123', sync_status: 'failed' },
          error: null,
        });

      const functionsErr = makeFunctionsHttpError(
        { error: 'Failed to create/update event', details: 'You need to have writer access to this calendar.' },
        403
      );
      mockSupabase.functions.invoke.mockResolvedValue({ data: null, error: functionsErr });

      const gigData = {
        title: 'St. Raymond Festival',
        start: '2026-10-03T20:00:00.000Z',
        end: '2026-10-03T23:00:00.000Z',
        timezone: 'America/Los_Angeles',
      };

      await expect(service.syncGigToCalendar('user-123', 'gig-123', gigData)).rejects.toThrow(
        'You need to have writer access to this calendar.'
      );

      const failedUpsertCall = mockSupabase.upsert.mock.calls.find(
        (call: any[]) => call[0]?.sync_status === 'failed'
      );
      expect(failedUpsertCall).toBeDefined();
      expect(failedUpsertCall![0].sync_error).toBe('You need to have writer access to this calendar.');
      expect(failedUpsertCall![0].sync_error).not.toContain('non-2xx');
    });

    it('still treats an already-deleted (404) calendar event as successfully removed after unwrapping the error', async () => {
      const service = await import('./googleCalendar.service');

      mockSupabase.maybeSingle
        .mockResolvedValueOnce({ data: { google_event_id: 'stale-event-1' }, error: null }) // existing sync status
        .mockResolvedValueOnce({ data: mockSettings, error: null })                          // settings lookup
        .mockResolvedValueOnce({                                                             // updateGigSyncStatus's own upsert result
          data: { id: 'sync-status-1', gig_id: 'gig-123', user_id: 'user-123', sync_status: 'removed' },
          error: null,
        });

      const functionsErr = makeFunctionsHttpError(
        { error: 'Failed to delete event', details: 'Not Found (404)' },
        404
      );
      mockSupabase.functions.invoke.mockResolvedValue({ data: null, error: functionsErr });

      await service.deleteGigFromCalendar('user-123', 'gig-123');

      const removedUpsertCall = mockSupabase.upsert.mock.calls.find(
        (call: any[]) => call[0]?.sync_status === 'removed'
      );
      expect(removedUpsertCall).toBeDefined();
      expect(removedUpsertCall![0].sync_error).toBeNull();
    });
    // #175: after a gig is deleted its sync row is gone too, so the event is
    // removed by its id, with nothing written back.
    describe('deleteCalendarEvent', () => {
      it('removes the event by id and writes no sync status', async () => {
        const service = await import('./googleCalendar.service');
        mockSupabase.maybeSingle.mockResolvedValueOnce({ data: mockSettings, error: null });
        mockSupabase.functions.invoke.mockResolvedValue({ data: { success: true }, error: null });

        await service.deleteCalendarEvent('user-123', 'ev-9');

        expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
          'server/integrations/google-calendar/events',
          { method: 'DELETE', body: { event_id: 'ev-9' } },
        );
        expect(mockSupabase.upsert).not.toHaveBeenCalled();
      });

      it('treats an event that is already gone as removed', async () => {
        const service = await import('./googleCalendar.service');
        mockSupabase.maybeSingle.mockResolvedValueOnce({ data: mockSettings, error: null });
        mockSupabase.functions.invoke.mockResolvedValue({
          data: null, error: makeFunctionsHttpError({ error: 'Failed to delete event', details: 'Not Found (404)' }, 404),
        });

        await expect(service.deleteCalendarEvent('user-123', 'ev-9')).resolves.toBeUndefined();
      });

      it("reports Google's reason when the event can't be removed", async () => {
        const service = await import('./googleCalendar.service');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockSupabase.maybeSingle.mockResolvedValueOnce({ data: mockSettings, error: null });
        mockSupabase.functions.invoke.mockResolvedValue({
          data: null, error: makeFunctionsHttpError({ error: 'Failed to delete event', details: 'Forbidden' }, 403),
        });

        await expect(service.deleteCalendarEvent('user-123', 'ev-9')).rejects.toThrow('Forbidden');
      });
    });
  });

  // #175: a gig the organization is Inactive on is left out of its calendar sync.
  describe('syncAllGigsForUser', () => {
    it('removes a gig the organization is Inactive on instead of syncing it', async () => {
      const service = await import('./googleCalendar.service');
      const settings = {
        id: 's-1', user_id: 'user-123', calendar_id: 'cal-123',
        token_expires_at: new Date(Date.now() + 3600000).toISOString(), is_enabled: true, sync_filters: {},
      };
      const gigs = [
        { id: 'gig-on', title: 'On', start: '2026-10-03T20:00:00.000Z', end: '2026-10-03T23:00:00.000Z', timezone: 'UTC', status: 'Booked', participants: [] },
        { id: 'gig-off', title: 'Off', start: '2026-10-04T20:00:00.000Z', end: '2026-10-04T23:00:00.000Z', timezone: 'UTC', status: 'Booked', participants: [] },
      ];
      const answers: Record<string, any> = {
        user_google_calendar_settings: { data: settings, error: null },
        gig_participants: {
          data: [{ gig_id: 'gig-on', inactive: false }, { gig_id: 'gig-off', inactive: true }], error: null,
        },
        gigs: { data: gigs, error: null },
        gig_sync_status: { data: { google_event_id: 'ev-off' }, error: null },
      };
      mockSupabase.from = vi.fn((table: string) => {
        const b: any = {};
        ['select', 'eq', 'in', 'not', 'upsert', 'update', 'order', 'limit'].forEach((m) => { b[m] = vi.fn(() => b); });
        const answer = answers[table] ?? { data: null, error: null };
        b.maybeSingle = vi.fn(() => Promise.resolve(answer));
        b.single = vi.fn(() => Promise.resolve(answer));
        b.then = (res: any, rej: any) => Promise.resolve(answer).then(res, rej);
        return b;
      });
      mockSupabase.functions.invoke.mockResolvedValue({ data: { eventId: 'ev-new', success: true }, error: null });
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await service.syncAllGigsForUser('user-123', 'org-1');

      expect(result.total).toBe(1);
      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'server/integrations/google-calendar/events',
        expect.objectContaining({ method: 'DELETE', body: expect.objectContaining({ event_id: 'ev-off' }) }),
      );
    });
  });

  describe('bulkSyncAllGigsServerSide', () => {
    it('successfully queries all gigs and invokes sync-gig-all-users for each', async () => {
      const service = await import('./googleCalendar.service');

      // Mock select query to return gigs
      const mockGigs = [
        { id: 'gig-1', title: 'Gig One' },
        { id: 'gig-2', title: 'Gig Two' },
      ];
      mockSupabase.from.mockReturnThis();
      mockSupabase.select.mockResolvedValue({ data: mockGigs, error: null });

      // Mock invoke success
      mockSupabase.functions.invoke.mockResolvedValue({ data: { success: true }, error: null });

      const progressSpy = vi.fn();
      const result = await service.bulkSyncAllGigsServerSide(progressSpy);

      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
      expect(result.failed).toBe(0);

      expect(mockSupabase.from).toHaveBeenCalledWith('gigs');
      expect(mockSupabase.select).toHaveBeenCalledWith('id, title');
      expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(2);
      expect(mockSupabase.functions.invoke).toHaveBeenNthCalledWith(
        1,
        'server/integrations/google-calendar/sync-gig-all-users',
        expect.objectContaining({
          method: 'POST',
          body: { gig_id: 'gig-1', origin: expect.any(String) },
        })
      );
      expect(mockSupabase.functions.invoke).toHaveBeenNthCalledWith(
        2,
        'server/integrations/google-calendar/sync-gig-all-users',
        expect.objectContaining({
          method: 'POST',
          body: { gig_id: 'gig-2', origin: expect.any(String) },
        })
      );
      expect(progressSpy).toHaveBeenCalledTimes(2);
      expect(progressSpy).toHaveBeenNthCalledWith(1, 1, 2);
      expect(progressSpy).toHaveBeenNthCalledWith(2, 2, 2);
    });
  });
});

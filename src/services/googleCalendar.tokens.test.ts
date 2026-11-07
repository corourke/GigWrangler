import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient } from '../utils/supabase/client';

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));

// The browser never holds Google tokens: the server keeps them and makes every Google call.
describe('googleCalendar.service never handles Google tokens', () => {
  let supabase: any;
  let tableCalls: { table: string; op: string; arg?: any }[];

  beforeEach(() => {
    vi.clearAllMocks();
    tableCalls = [];
    const chain = (table: string): any => {
      const c: any = {};
      for (const op of ['select', 'eq', 'order', 'limit', 'update', 'upsert', 'insert', 'delete', 'in']) {
        c[op] = vi.fn((arg?: any) => { tableCalls.push({ table, op, arg }); return c; });
      }
      c.maybeSingle = vi.fn().mockResolvedValue({
        data: { id: 's1', user_id: 'u1', calendar_id: 'cal-1', calendar_name: 'Gigs', token_expires_at: '2000-01-01T00:00:00Z', is_enabled: true, sync_filters: {} },
        error: null,
      });
      c.single = c.maybeSingle;
      return c;
    };
    supabase = { from: vi.fn((t: string) => chain(t)), functions: { invoke: vi.fn() } };
    (createClient as any).mockReturnValue(supabase);
  });

  const bodies = () => supabase.functions.invoke.mock.calls.map((c: any[]) => JSON.stringify(c[1]?.body ?? {}));

  it('connects by handing the code to the server, which stores the tokens', async () => {
    const service: any = await import('./googleCalendar.service');
    supabase.functions.invoke.mockResolvedValue({ data: { connected: true }, error: null });
    await service.connectGoogleCalendar('auth-code');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('server/integrations/google-calendar/connect', {
      method: 'POST',
      body: { code: 'auth-code', redirect_uri: expect.stringMatching(/\/auth\/google-calendar\/callback$/) },
    });
    expect(tableCalls.filter((c) => c.table === 'user_google_calendar_settings' && c.op !== 'select' && c.op !== 'eq')).toEqual([]);
  });

  it('reads settings without the token columns', async () => {
    const service: any = await import('./googleCalendar.service');
    await service.getUserGoogleCalendarSettings('u1');
    const select = tableCalls.find((c) => c.table === 'user_google_calendar_settings' && c.op === 'select');
    expect(select?.arg).not.toMatch(/access_token|refresh_token|\*/);
  });

  it('lists calendars, writes and deletes events without sending a token, even when the stored one has expired', async () => {
    const service: any = await import('./googleCalendar.service');
    supabase.functions.invoke.mockImplementation((path: string) => Promise.resolve(
      path.endsWith('/calendars') ? { data: { calendars: [] }, error: null } : { data: { event_id: 'e1', success: true }, error: null },
    ));
    await service.getUserCalendars('u1');
    await service.syncGigToCalendar('u1', 'gig-1', { title: 'Show', start: '2026-07-11T02:00:00Z', end: '2026-07-11T06:00:00Z', timezone: 'UTC' });
    await service.deleteCalendarEvent('u1', 'e1');
    expect(supabase.functions.invoke.mock.calls.map((c: any[]) => c[0])).not.toContain('server/integrations/google-calendar/refresh-token');
    for (const body of bodies()) expect(body).not.toMatch(/access_token|refresh_token/);
  });

  it('disconnects through the server, which revokes the tokens at Google', async () => {
    const service: any = await import('./googleCalendar.service');
    supabase.functions.invoke.mockResolvedValue({ data: { success: true }, error: null });
    await service.disconnectGoogleCalendar();
    expect(supabase.functions.invoke).toHaveBeenCalledWith('server/integrations/google-calendar/connection', { method: 'DELETE' });
    expect(tableCalls.filter((c) => c.op === 'delete')).toEqual([]);
  });

  it('has no token functions left, and no token in the source', async () => {
    const service: any = await import('./googleCalendar.service');
    expect(service.exchangeCodeForTokens).toBeUndefined();
    expect(service.refreshAccessToken).toBeUndefined();
    expect(readFileSync('src/services/googleCalendar.service.ts', 'utf8')).not.toMatch(/refresh_token|access_token/);
  });
});

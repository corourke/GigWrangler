/** Characterization tests (A14): the lock arms only with an enrolled device, and unlocks by passkey. */
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useMobileLock } from './useMobileLock';
import { startAuthentication } from '@simplewebauthn/browser';

const db = vi.hoisted(() => ({ devices: [] as { id: string }[], fail: false, invoke: vi.fn(), tables: [] as string[] }));
vi.mock('../utils/supabase/client', () => ({
  createClient: () => ({
    functions: { invoke: db.invoke },
    from: (table: string) => {
      db.tables.push(table);
      return {
        select: () => ({
          limit: async () => (db.fail ? { data: null, error: new Error('boom') } : { data: db.devices, error: null }),
        }),
      };
    },
  }),
}));
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  db.devices = [];
  db.fail = false;
  db.tables = [];
  localStorage.clear();
});

describe('useMobileLock: arming', () => {
  it('locks once an enrolled device is known', async () => {
    db.devices = [{ id: 'd1' }];
    const { result } = renderHook(() => useMobileLock('pat@example.com', true));
    await waitFor(() => expect(db.tables).toContain('user_devices'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => result.current.lock());
    expect(result.current.isLocked).toBe(true);
    expect(localStorage.getItem('mobile_locked')).toBe('true');
  });

  it('never locks without an enrolled device', async () => {
    const { result } = renderHook(() => useMobileLock('pat@example.com', true));
    await waitFor(() => expect(db.tables).toContain('user_devices'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => result.current.lock());
    expect(result.current.isLocked).toBe(false);
  });

  it('never locks when the device check fails', async () => {
    db.fail = true;
    db.devices = [{ id: 'd1' }];
    const { result } = renderHook(() => useMobileLock('pat@example.com', true));
    await waitFor(() => expect(db.tables).toContain('user_devices'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => result.current.lock());
    expect(result.current.isLocked).toBe(false);
  });

  it('does not check devices on desktop', async () => {
    renderHook(() => useMobileLock('pat@example.com', false));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(db.tables).toEqual([]);
  });
});

describe('useMobileLock: unlock', () => {
  it('asks for options, the passkey, then the server check, and unlocks', async () => {
    db.devices = [{ id: 'd1' }];
    db.invoke.mockImplementation(async (path: string) =>
      path.endsWith('/options') ? { data: { challenge: 'c' }, error: null } : { data: { success: true }, error: null });
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'cred' } as any);
    const { result } = renderHook(() => useMobileLock('pat@example.com', true));
    await waitFor(() => expect(db.tables).toContain('user_devices'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => result.current.lock());
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.unlock(); });
    expect(ok).toBe(true);
    expect(result.current.isLocked).toBe(false);
    expect(db.invoke).toHaveBeenCalledWith('server/webauthn/authenticate/options', { method: 'POST', body: { email: 'pat@example.com' } });
    expect(db.invoke).toHaveBeenCalledWith('server/webauthn/authenticate/verify', {
      method: 'POST', body: { authenticationResponse: { id: 'cred' }, email: 'pat@example.com' },
    });
  });

  it('stays locked and says why when the server refuses', async () => {
    const { toast } = await import('sonner');
    db.invoke.mockResolvedValue({ data: { error: 'No registered devices found' }, error: null });
    const { result } = renderHook(() => useMobileLock('pat@example.com', true));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.unlock(); });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('No registered devices found');
  });
});

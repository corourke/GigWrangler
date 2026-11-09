/** The mobile lock's server calls (A14): moved out of useMobileLock. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasEnrolledDevice, getUnlockOptions, verifyUnlock } from './mobileLock.service';

const db = vi.hoisted(() => ({ result: { data: [] as unknown[] | null, error: null as unknown }, invoke: vi.fn(), table: '' }));
vi.mock('../../utils/supabase/client', () => ({
  createClient: () => ({
    functions: { invoke: db.invoke },
    from: (table: string) => { db.table = table; return { select: () => ({ limit: async () => db.result }) }; },
  }),
}));

beforeEach(() => { vi.clearAllMocks(); db.result = { data: [], error: null }; });

describe('mobileLock.service', () => {
  it('hasEnrolledDevice: any row in user_devices; an error counts as none', async () => {
    db.result = { data: [{ id: 'd1' }], error: null };
    expect(await hasEnrolledDevice()).toBe(true);
    expect(db.table).toBe('user_devices');
    db.result = { data: [], error: null };
    expect(await hasEnrolledDevice()).toBe(false);
    db.result = { data: null, error: new Error('boom') };
    expect(await hasEnrolledDevice()).toBe(false);
  });

  it('getUnlockOptions and verifyUnlock call the WebAuthn endpoints and surface their errors', async () => {
    db.invoke.mockResolvedValueOnce({ data: { challenge: 'c' }, error: null });
    expect(await getUnlockOptions('pat@example.com')).toEqual({ challenge: 'c' });
    db.invoke.mockResolvedValueOnce({ data: { error: 'No registered devices found' }, error: null });
    await expect(getUnlockOptions('pat@example.com')).rejects.toThrow('No registered devices found');
    db.invoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    expect(await verifyUnlock({ id: 'cred' }, 'pat@example.com')).toEqual({ success: true });
    expect(db.invoke).toHaveBeenLastCalledWith('server/webauthn/authenticate/verify', {
      method: 'POST', body: { authenticationResponse: { id: 'cred' }, email: 'pat@example.com' },
    });
  });
});

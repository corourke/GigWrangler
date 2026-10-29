import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useMobileLock } from './useMobileLock';

const invoke = vi.fn();
vi.mock('../utils/supabase/client', () => ({
  createClient: () => ({
    functions: { invoke },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }) }) }),
  }),
}));
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('useMobileLock — no email (#325)', () => {
  beforeEach(() => invoke.mockReset());

  // App passes `user?.email ?? undefined`: a user without an email can't unlock with a passkey.
  it('unlock gives up without asking the server', async () => {
    const { result } = renderHook(() => useMobileLock(undefined, true));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.unlock(); });
    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});

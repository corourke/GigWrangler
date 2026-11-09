import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useMobileLock } from './useMobileLock';
import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '../test/renderWithQuery';

// A10: the device check reads through react-query, keyed by the signed-in user.
const queryWrapper = () => {
  const client = makeTestQueryClient();
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
};

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
    const { result } = renderHook(() => useMobileLock(undefined, true, undefined), { wrapper: queryWrapper() });
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.unlock(); });
    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});

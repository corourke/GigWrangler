import { describe, it, expect, vi } from 'vitest';

// A14: whether the signed-in user is a platform Admin (it shows Edit Organization) comes from
// a service, not a call in the component.
const { getSession, rpc } = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn() }));
vi.mock('../utils/supabase/client', () => ({ createClient: () => ({ auth: { getSession }, rpc }) }));

import { isCurrentUserAdmin } from './user.service';

describe('isCurrentUserAdmin', () => {
  it('asks the database about the signed-in user', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(isCurrentUserAdmin()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('user_is_admin', { user_uuid: 'u1' });
  });

  it('is false with no session, without asking', async () => {
    rpc.mockClear();
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(isCurrentUserAdmin()).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is false when the database says no or errs', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(isCurrentUserAdmin()).resolves.toBe(false);
  });
});

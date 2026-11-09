import { describe, it, expect, vi, beforeEach } from 'vitest';

// A14: the dashboard's figures come through a service, not a call in the component.
const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));
vi.mock('../utils/supabase/client', () => ({
  createClient: () => ({ functions: { invoke }, auth: { getSession } }),
}));

import { getDashboardStats } from './dashboard.service';

describe('getDashboardStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: 't' } } });
  });

  it("returns the organization's figures", async () => {
    invoke.mockResolvedValue({ data: { gigsByStatus: { Booked: 2 } }, error: null });
    await expect(getDashboardStats('org-1')).resolves.toEqual({ gigsByStatus: { Booked: 2 } });
    expect(invoke).toHaveBeenCalledWith('server/organizations/org-1/dashboard', { method: 'GET' });
  });

  it('asks to sign in again without a session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(getDashboardStats('org-1')).rejects.toThrow('Not authenticated. Please sign in again.');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('throws when the server call fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockResolvedValue({ data: null, error: new Error('Edge Function returned a non-2xx status code') });
    await expect(getDashboardStats('org-1')).rejects.toThrow();
  });
});

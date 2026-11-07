import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { createClient } from '../utils/supabase/client';
import * as userService from '../services/user.service';

// Mock Supabase client
vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('../services/mobile/offlineOwner', () => ({
  claimOfflineStore: vi.fn().mockResolvedValue(undefined),
  releaseOfflineStore: vi.fn().mockResolvedValue(undefined),
}));
import { claimOfflineStore, releaseOfflineStore } from '../services/mobile/offlineOwner';

const getTwoFactorStatus = vi.fn().mockResolvedValue({ factors: [], needsCode: false, signedInWithGoogle: false });
vi.mock('../services/twoFactor.service', () => ({ getTwoFactorStatus: (...a: unknown[]) => getTwoFactorStatus(...a) }));

// Mock user service to simulate database hang
vi.mock('../services/user.service', () => ({
  getUserProfile: vi.fn(),
  getUserOrganizations: vi.fn(),
  getCompleteUserData: vi.fn(),
  createUserProfile: vi.fn(),
}));

describe('AuthContext Hang Reproduction', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      }),
      removeChannel: vi.fn().mockResolvedValue({}),
    };

    (createClient as any).mockReturnValue(mockSupabase);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  it('should remain in isLoading state if refreshProfile hangs indefinitely', async () => {
    // Simulate a hanging database call (infinite recursion)
    // This promise never resolves
    const hangingPromise = new Promise(() => {});
    (userService.getCompleteUserData as any).mockReturnValue(hangingPromise);

    let authChangeHandler: any;
    mockSupabase.auth.onAuthStateChange.mockImplementation((handler: any) => {
      authChangeHandler = handler;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Initial state
    expect(result.current.isLoading).toBe(true);

    // Trigger auth change with session
    await act(async () => {
      // This will trigger refreshProfile which will hang
      authChangeHandler('SIGNED_IN', { user: { id: 'user-1' } });
    });
    
    // It should still be loading because the promise hasn't resolved
    expect(result.current.isLoading).toBe(true);
  });

  it('should resolve and set loading to false when user data is fetched', async () => {
    const mockData = {
      profile: { id: 'user-1', email: 'test@example.com' },
      organizations: []
    };
    
    (userService.getCompleteUserData as any).mockResolvedValue(mockData);

    let authChangeHandler: any;
    mockSupabase.auth.onAuthStateChange.mockImplementation((handler: any) => {
      authChangeHandler = handler;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Trigger auth change with session
    await act(async () => {
      authChangeHandler('SIGNED_IN', { user: { id: 'user-1' } });
    });

    // Wait for the setTimeout(0) and the async RPC call
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 1000 });

    expect(result.current.user).toEqual(mockData.profile);
    expect(result.current.organizations).toEqual([]);
  });

  it('restores the previously selected organization from localStorage for a multi-org user (#26)', async () => {
    const org1 = { id: 'org-1', name: 'Org One' };
    const org2 = { id: 'org-2', name: 'Org Two' };
    localStorage.setItem('selectedOrganizationId', 'org-2');

    const mockData = {
      profile: { id: 'user-1', email: 'test@example.com' },
      organizations: [
        { organization: org1, role: 'Admin' },
        { organization: org2, role: 'Viewer' },
      ],
    };
    (userService.getCompleteUserData as any).mockResolvedValue(mockData);

    let authChangeHandler: any;
    mockSupabase.auth.onAuthStateChange.mockImplementation((handler: any) => {
      authChangeHandler = handler;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      // Simulates the org selection resetting on a hard refresh: the fetched
      // membership list has 2+ orgs, so without localStorage restoration this
      // would leave selectedOrganization null and bounce to the org picker.
      authChangeHandler('SIGNED_IN', { user: { id: 'user-1' } });
    });

    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 1000 });

    expect(result.current.selectedOrganization?.id).toBe('org-2');
  });

  it('does not restore a stored organization id the user is no longer a member of', async () => {
    const org1 = { id: 'org-1', name: 'Org One' };
    const org2 = { id: 'org-2', name: 'Org Two' };
    localStorage.setItem('selectedOrganizationId', 'org-stale');

    const mockData = {
      profile: { id: 'user-1', email: 'test@example.com' },
      organizations: [
        { organization: org1, role: 'Admin' },
        { organization: org2, role: 'Viewer' },
      ],
    };
    (userService.getCompleteUserData as any).mockResolvedValue(mockData);

    let authChangeHandler: any;
    mockSupabase.auth.onAuthStateChange.mockImplementation((handler: any) => {
      authChangeHandler = handler;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      authChangeHandler('SIGNED_IN', { user: { id: 'user-1' } });
    });

    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 1000 });

    expect(result.current.selectedOrganization).toBeNull();
  });

  it('persists the selection when selectOrganization is called, and clears it on logout', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      result.current.selectOrganization({ id: 'org-9', name: 'Org Nine' } as any);
    });
    expect(localStorage.getItem('selectedOrganizationId')).toBe('org-9');

    await act(async () => {
      await result.current.logout();
    });
    expect(localStorage.getItem('selectedOrganizationId')).toBeNull();
  });

  describe('a failed profile load (#94)', () => {
    function captureAuthHandler() {
      let handler: any;
      mockSupabase.auth.onAuthStateChange.mockImplementation((h: any) => {
        handler = h;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });
      return () => handler;
    }

    it('reports an error instead of treating the user as new, and recovers on retry', async () => {
      const getHandler = captureAuthHandler();
      (userService.getCompleteUserData as any).mockRejectedValueOnce(new Error('Failed to fetch'));

      const { result } = renderHook(() => useAuth(), { wrapper });
      await act(async () => {
        getHandler()('SIGNED_IN', { user: { id: 'user-1' } });
      });
      await vi.waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 1000 });

      expect(userService.createUserProfile).not.toHaveBeenCalled();
      expect(result.current.user).toBeNull();
      expect(result.current.profileLoadError).toBeTruthy();

      const org = { id: 'org-1', name: 'Org One' };
      (userService.getCompleteUserData as any).mockResolvedValueOnce({
        profile: { id: 'user-1', email: 'test@example.com' },
        organizations: [{ organization: org, role: 'Admin' }],
      });
      mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
      await act(async () => {
        await result.current.refreshProfile();
      });

      expect(result.current.profileLoadError).toBeNull();
      expect(result.current.user).toEqual({ id: 'user-1', email: 'test@example.com' });
      expect(result.current.selectedOrganization?.id).toBe('org-1');
    });

    it('keeps an already-loaded user and their organizations when a later refresh fails', async () => {
      const getHandler = captureAuthHandler();
      const org = { id: 'org-1', name: 'Org One' };
      (userService.getCompleteUserData as any).mockResolvedValueOnce({
        profile: { id: 'user-1', email: 'test@example.com' },
        organizations: [{ organization: org, role: 'Admin' }],
      });

      const { result } = renderHook(() => useAuth(), { wrapper });
      await act(async () => {
        getHandler()('SIGNED_IN', { user: { id: 'user-1' } });
      });
      await vi.waitFor(() => expect(result.current.user).not.toBeNull(), { timeout: 1000 });

      (userService.getCompleteUserData as any).mockRejectedValueOnce(new Error('Failed to fetch'));
      mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
      await act(async () => {
        await result.current.refreshProfile();
      });

      expect(userService.createUserProfile).not.toHaveBeenCalled();
      expect(result.current.user).toEqual({ id: 'user-1', email: 'test@example.com' });
      expect(result.current.organizations).toHaveLength(1);
      expect(result.current.selectedOrganization?.id).toBe('org-1');
    });

    it('still creates a profile for a genuinely new user', async () => {
      const getHandler = captureAuthHandler();
      (userService.getCompleteUserData as any).mockResolvedValueOnce({ profile: null, organizations: [] });
      (userService.createUserProfile as any).mockResolvedValueOnce({ id: 'user-1', email: 'new@example.com' });

      const { result } = renderHook(() => useAuth(), { wrapper });
      await act(async () => {
        getHandler()('SIGNED_IN', { user: { id: 'user-1' } });
      });
      await vi.waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 1000 });

      expect(userService.createUserProfile).toHaveBeenCalledTimes(1);
      expect(result.current.user).toEqual({ id: 'user-1', email: 'new@example.com' });
      expect(result.current.profileLoadError).toBeNull();
    });
  });
});

// The phone's offline copy belongs to the signed-in person: claimed at sign-in, cleared at sign-out.
describe('AuthContext: offline store', () => {
  let mockSupabase: any;
  let authChangeHandler: any;
  const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        onAuthStateChange: vi.fn().mockImplementation((handler: any) => {
          authChangeHandler = handler;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
      },
      channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }),
      removeChannel: vi.fn().mockResolvedValue({}),
    };
    (createClient as any).mockReturnValue(mockSupabase);
    (userService.getCompleteUserData as any).mockResolvedValue({ profile: { id: 'user-1', email: 'a@example.com' }, organizations: [] });
  });

  it('claims it for whoever signs in', async () => {
    renderHook(() => useAuth(), { wrapper });
    await act(async () => { authChangeHandler('SIGNED_IN', { user: { id: 'user-1' } }); });
    await vi.waitFor(() => expect(claimOfflineStore).toHaveBeenCalledWith('user-1'), { timeout: 1000 });
  });

  it('clears it on logout', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await result.current.logout(); });
    expect(releaseOfflineStore).toHaveBeenCalled();
  });

  it('clears it when the session ends elsewhere', async () => {
    renderHook(() => useAuth(), { wrapper });
    await act(async () => { authChangeHandler('SIGNED_OUT', null); });
    expect(releaseOfflineStore).toHaveBeenCalled();
  });
});

// An account an Admin created with a password must choose its own at first sign-in.
describe('AuthContext: a temporary password', () => {
  let authChangeHandler: any;
  const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    const mockSupabase: any = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        onAuthStateChange: vi.fn().mockImplementation((handler: any) => {
          authChangeHandler = handler;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
      },
      channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }),
      removeChannel: vi.fn().mockResolvedValue({}),
    };
    (createClient as any).mockReturnValue(mockSupabase);
    (userService.getCompleteUserData as any).mockResolvedValue({ profile: { id: 'user-1', email: 'a@example.com' }, organizations: [] });
  });

  it('says so when the session carries the flag, and clears it once the password is set', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      authChangeHandler('SIGNED_IN', { user: { id: 'user-1', app_metadata: { must_change_password: true } } });
    });
    await vi.waitFor(() => expect(result.current.mustChangePassword).toBe(true), { timeout: 1000 });
    act(() => result.current.passwordChanged());
    expect(result.current.mustChangePassword).toBe(false);
  });

  it('asks for the two-factor code when the session still needs it, and stops once it is entered (#361)', async () => {
    getTwoFactorStatus.mockResolvedValueOnce({ factors: [{ id: 'f1' }], needsCode: true, signedInWithGoogle: false });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { authChangeHandler('SIGNED_IN', { user: { id: 'user-1' } }); });
    await vi.waitFor(() => expect(result.current.twoFactorPending).toBe(true), { timeout: 1000 });
    act(() => result.current.twoFactorVerified());
    expect(result.current.twoFactorPending).toBe(false);
  });

  it('doesn\'t without the flag', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { authChangeHandler('SIGNED_IN', { user: { id: 'user-1' } }); });
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 1000 });
    expect(result.current.mustChangePassword).toBe(false);
  });
});

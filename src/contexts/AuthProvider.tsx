import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '../utils/supabase/client';
import type { User, Organization, OrganizationMembership } from '../utils/supabase/types';
import { getCompleteUserData, createUserProfile } from '../services/user.service';
import { convertPendingToActive } from '../services/organization.service';
import { claimOfflineStore, releaseOfflineStore } from '../services/mobile/offlineOwner';
import { getTwoFactorStatus, reminderUntil } from '../services/twoFactor.service';

/** Clearing the phone's offline copy must never block signing in or out. */
const quietly = (p: Promise<unknown>) => p.catch((err) => {
  if (import.meta.env.DEV) console.warn('[TRACE] AuthContext: offline store', err);
});
import { AuthContext } from './AuthContext';

// Persisted across reloads so a deep link doesn't bounce a multi-org user to
// the org picker just because in-memory state reset (see issue #26).
const SELECTED_ORG_STORAGE_KEY = 'selectedOrganizationId';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationMembership[]>([]);
  const [selectedOrganization, setSelectedOrganizationState] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const [twoFactorSetupRequired, setTwoFactorSetupRequired] = useState(false);
  const [twoFactorReminderUntil, setTwoFactorReminderUntil] = useState<string | null>(null);

  const selectOrganization = useCallback((org: Organization | null) => {
    setSelectedOrganizationState(org);
    try {
      if (org) {
        localStorage.setItem(SELECTED_ORG_STORAGE_KEY, org.id);
      } else {
        localStorage.removeItem(SELECTED_ORG_STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable (private browsing, etc.) - selection still works in-memory
    }
  }, []);

  const userRole = React.useMemo(() => {
    if (!selectedOrganization) return undefined;
    const membership = organizations.find(
      (m) => m.organization.id === selectedOrganization.id
    );
    return membership?.role;
  }, [selectedOrganization, organizations]);

  const isRefreshing = React.useRef(false);

  const refreshProfile = useCallback(async (providedSession?: any) => {
    if (isRefreshing.current) {
      if (import.meta.env.DEV) console.log('[TRACE] AuthContext: refreshProfile already in progress, skipping');
      return;
    }
    
    if (import.meta.env.DEV) console.log('[TRACE] AuthContext: refreshProfile starting');
    isRefreshing.current = true;
    
    const supabase = createClient();
    
    try {
      const session = providedSession || (await supabase.auth.getSession()).data.session;
      
      if (session?.user) {
        if (import.meta.env.DEV) console.log('[TRACE] AuthContext: Session found for user', session.user.id);
        
        setMustChangePassword((session.user as any).app_metadata?.must_change_password === true);

        // Two-factor sign-in (#361): a session that hasn't entered the code, or an Admin past the
        // grace period with no authenticator, does that first. Until then the database returns
        // nothing to this session, so nothing else is loaded.
        try {
          const twoFactor = await getTwoFactorStatus();
          setTwoFactorPending(twoFactor.needsCode);
          setTwoFactorSetupRequired(twoFactor.setupRequired);
          setTwoFactorReminderUntil(reminderUntil(twoFactor));
          if (twoFactor.needsCode || twoFactor.setupRequired) return;
        } catch (e) {
          if (import.meta.env.DEV) console.warn('[TRACE] AuthContext: Error reading two-factor status:', e);
        }

        // Ensure pending user is converted to active (e.g. after accepting invitation)
        if (session.user.email) {
          try {
            await convertPendingToActive(session.user.email, session.user.id);
          } catch (e) {
            if (import.meta.env.DEV) console.warn('[TRACE] AuthContext: Error converting pending user:', e);
          }
        }

        // The phone's offline copy is this person's: cleared first if someone else had it.
        await quietly(claimOfflineStore(session.user.id));

        // Fetch complete user data in one single secure RPC call
        if (import.meta.env.DEV) console.log('[TRACE] AuthContext: Fetching complete user data...');
        let completeUserData: Awaited<ReturnType<typeof getCompleteUserData>>;
        try {
          completeUserData = await getCompleteUserData(session.user.id);
        } catch (loadError: any) {
          // A failed request is not a new user (#94): keep whatever is loaded,
          // don't create a profile, and let RequireAuth offer a retry.
          if (import.meta.env.DEV) console.error('[TRACE] AuthContext: Could not load user data:', loadError);
          setProfileLoadError(loadError?.message || 'Could not load your account');
          return;
        }
        setProfileLoadError(null);
        const { profile, organizations: orgs } = completeUserData;
        
        if (import.meta.env.DEV) console.log('[TRACE] AuthContext: Complete user data fetch finished', { 
          hasProfile: !!profile, 
          orgCount: orgs?.length 
        });

        if (profile) {
          setUser(profile);
          setOrganizations(orgs);
          
          // Auto-select organization if appropriate
          if (!selectedOrganization) {
            if (orgs.length === 1) {
              selectOrganization(orgs[0].organization);
            } else {
              // Restore the last-selected org (e.g. after a hard refresh or
              // direct URL load) so RequireOrg doesn't bounce the user to
              // the picker while this state is still resetting.
              let storedOrgId: string | null = null;
              try {
                storedOrgId = localStorage.getItem(SELECTED_ORG_STORAGE_KEY);
              } catch {
                // ignore - fall through to no restoration
              }
              const restored = storedOrgId
                ? orgs.find(m => m.organization.id === storedOrgId)
                : undefined;
              if (restored) {
                selectOrganization(restored.organization);
              }
            }
          } else {
            const stillMember = orgs.find(m => m.organization.id === selectedOrganization.id);
            if (!stillMember) {
              selectOrganization(orgs.length === 1 ? orgs[0].organization : null);
            }
          }
        } else {
          if (import.meta.env.DEV) console.warn('[TRACE] AuthContext: No profile found for authenticated user, creating one...');
          // Create a new profile using Auth data if possible
          const newProfile = await createUserProfile({
            id: session.user.id,
            email: session.user.email || '',
            first_name: session.user.user_metadata?.first_name || '',
            last_name: session.user.user_metadata?.last_name || '',
          });
          setUser(newProfile);
          setOrganizations([]);
        }
      } else {
        if (import.meta.env.DEV) console.log('[TRACE] AuthContext: No session found in refreshProfile');
        setProfileLoadError(null);
        setUser(null);
        setOrganizations([]);
        selectOrganization(null);
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('[TRACE] AuthContext: Error refreshing profile:', error);
    } finally {
      if (import.meta.env.DEV) console.log('[TRACE] AuthContext: refreshProfile complete, setting isLoading=false');
      setIsLoading(false);
      isRefreshing.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-created only when the selected organization changes, as before
  }, [selectedOrganization]);

  const refreshProfileRef = React.useRef(refreshProfile);
  refreshProfileRef.current = refreshProfile;

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;
    
    if (import.meta.env.DEV) console.log('[TRACE] AuthContext: Initializing onAuthStateChange listener');
    
    // Listen for auth changes - this also handles the initial session check
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) {
          if (import.meta.env.DEV) console.log(`[TRACE] AuthContext: onAuthStateChange event ${event} ignored - unmounted`);
          return;
        }
        
        if (import.meta.env.DEV) console.log(`[TRACE] AuthContext: onAuthStateChange event: ${event} for user: ${session?.user?.id}`);
        
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session) {
          if (import.meta.env.DEV) console.log(`[TRACE] AuthContext: Scheduling refreshProfile for ${event}`);
          // Use setTimeout to break the call stack and avoid deadlocking the Supabase client initialization
          setTimeout(() => {
            if (mounted) {
              refreshProfileRef.current(session).catch(err => {
                if (import.meta.env.DEV) console.error(`[TRACE] AuthContext: Error in scheduled refreshProfile for ${event}:`, err);
              });
            }
          }, 0);
        } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
          if (import.meta.env.DEV) console.log(`[TRACE] AuthContext: Handling ${event} (no session)`);
          if (event === 'SIGNED_OUT') void quietly(releaseOfflineStore());
          setProfileLoadError(null);
          setUser(null);
          setOrganizations([]);
          selectOrganization(null);
          setIsLoading(false);
          isRefreshing.current = false;
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribes once; the current refreshProfile is read through refreshProfileRef
  }, []);

  // Real-time listener for profile and membership changes
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    const supabase = createClient();
    
    if (import.meta.env.DEV) console.log(`[TRACE] AuthContext: Setting up real-time subscriptions for user ${userId}`);

    const channel = supabase
      .channel(`user-updates-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'users',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          if (import.meta.env.DEV) console.log('[TRACE] AuthContext: Real-time user profile update detected', payload);
          refreshProfileRef.current();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'organization_members',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (import.meta.env.DEV) console.log('[TRACE] AuthContext: Real-time organization membership update detected', payload);
          refreshProfileRef.current();
        }
      )
      .subscribe((status) => {
        if (import.meta.env.DEV) console.log(`[TRACE] AuthContext: Real-time subscription status for user ${userId}: ${status}`);
      });

    return () => {
      if (import.meta.env.DEV) console.log(`[TRACE] AuthContext: Cleaning up real-time subscriptions for user ${userId}`);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const login = (userData: User, userOrgs: OrganizationMembership[]) => {
    setUser(userData);
    setOrganizations(userOrgs);
    if (userOrgs.length === 1) {
      selectOrganization(userOrgs[0].organization);
    }
  };

  const logout = async () => {
    const supabase = createClient();
    await quietly(releaseOfflineStore());
    await supabase.auth.signOut();
    setMustChangePassword(false);
    setTwoFactorPending(false);
    setTwoFactorSetupRequired(false);
    setTwoFactorReminderUntil(null);
    setUser(null);
    setOrganizations([]);
    selectOrganization(null);
    // Clear persisted navigation state
    localStorage.removeItem('currentRoute');
    localStorage.removeItem('selectedGigId');
    localStorage.removeItem('selectedAssetId');
    localStorage.removeItem('selectedKitId');
    localStorage.removeItem('selectedMemberId');
  };

  const value = {
    user,
    organizations,
    selectedOrganization,
    isLoading,
    profileLoadError,
    userRole,
    login,
    logout,
    selectOrganization,
    refreshProfile,
    setOrganizations,
    setUser,
    mustChangePassword,
    passwordChanged: () => setMustChangePassword(false),
    twoFactorPending,
    twoFactorSetupRequired,
    twoFactorReminderUntil,
    // The code is in: the client's session is now aal2 (challengeAndVerify stores it), so
    // refreshProfile reads it and loads what this session couldn't before.
    twoFactorVerified: () => {
      setTwoFactorPending(false);
      setTwoFactorSetupRequired(false);
      void refreshProfile();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

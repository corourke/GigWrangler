import { lazy, useEffect, useState } from 'react';
import { Navigate, Outlet, useNavigate, useLocation } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { useAppShell } from './appShell';
import { prefetchLandingScreen } from './prefetch';
import LoginScreen from '../components/LoginScreen';
import TwoFactorReminder from '../components/security/TwoFactorReminder';
import InvitationErrorScreen from '../components/InvitationErrorScreen';
import { Button } from '../components/ui/button';
import { canManage } from '../utils/permissions';
import type { User } from '../utils/supabase/types';

// Screens most sessions never see (first sign-in, a temporary password, two-factor, a reset link,
// an invitation, the calendar callback) load on demand, keeping them out of the entry chunk (A21).
// The route table's Suspense and ChunkLoadBoundary cover them. LoginScreen stays eager.
const UserProfileCompletionScreen = lazy(() => import('../components/UserProfileCompletionScreen'));
const TemporaryPasswordScreen = lazy(() => import('../components/TemporaryPasswordScreen'));
const TwoFactorChallengeScreen = lazy(() => import('../components/security/TwoFactorChallengeScreen'));
const TwoFactorSetupRequiredScreen = lazy(() => import('../components/security/TwoFactorSetupRequiredScreen'));
const AcceptInvitationScreen = lazy(() => import('../components/AcceptInvitationScreen'));
const ResetPasswordScreen = lazy(() => import('../components/ResetPasswordScreen'));
const CalendarAuthCallback = lazy(() => import('../components/CalendarAuthCallback'));

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
  );
}

/**
 * Shown when the signed-in user's account couldn't be loaded (#94), so a
 * network blip reads as an error with a retry, not as a new user with no
 * organizations.
 */
function ProfileLoadErrorScreen({ onRetry }: { onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4 text-center">
      <h1 className="text-lg font-semibold">We couldn't load your account</h1>
      <p className="text-sm text-muted-foreground max-w-sm">
        Check your connection and try again.
      </p>
      <div className="flex gap-2">
        <Button
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await onRetry();
            } finally {
              setRetrying(false);
            }
          }}
        >
          {retrying ? 'Trying again…' : 'Try again'}
        </Button>
        <Button variant="outline" onClick={() => { window.location.href = '/logout'; }}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

function profileIncomplete(user: User): boolean {
  return !user.first_name?.trim() || !user.last_name?.trim();
}

/**
 * Requires an authenticated user with a complete profile. Login and
 * profile-completion render in place (no dedicated URL) so deep links survive
 * an auth round-trip: after signing in, the originally requested route renders.
 */
export function RequireAuth() {
  const {
    isLoading, user, setUser, profileLoadError, refreshProfile, mustChangePassword, passwordChanged,
    twoFactorPending, twoFactorSetupRequired, twoFactorReminderUntil, twoFactorVerified, logout,
  } = useAuth();
  const signedIn = !!user;

  // Fetch the landing screen's code while the org is being picked, so it is
  // ready when the first navigation happens.
  useEffect(() => {
    if (signedIn) prefetchLandingScreen();
  }, [signedIn]);

  if (isLoading) return <LoadingSpinner />;

  // Two-factor sign-in (#361) comes before anything else: the session reads nothing until it's done.
  if (twoFactorPending) {
    return <TwoFactorChallengeScreen onVerified={twoFactorVerified} onSignOut={() => { void logout(); }} />;
  }
  if (twoFactorSetupRequired) {
    return <TwoFactorSetupRequiredScreen onDone={twoFactorVerified} onSignOut={() => { void logout(); }} />;
  }

  if (!user && profileLoadError) return <ProfileLoadErrorScreen onRetry={() => refreshProfile()} />;
  if (!user) return <LoginScreen />;

  // An account an Admin created with a password: its owner chooses their own before anything else.
  if (mustChangePassword) return <TemporaryPasswordScreen onComplete={passwordChanged} />;

  if (profileIncomplete(user)) {
    return (
      <UserProfileCompletionScreen
        user={user}
        onProfileCompleted={(updatedUser) => {
          // Stay on the requested URL: the deep link renders once the profile is complete.
          setUser(updatedUser);
        }}
      />
    );
  }

  return (
    <>
      {twoFactorReminderUntil && <TwoFactorReminder requiredAfter={twoFactorReminderUntil} />}
      <Outlet />
    </>
  );
}

/**
 * Requires a selected organization. Auto-selects when the user belongs to
 * exactly one org; otherwise sends them to the picker.
 */
export function RequireOrg() {
  const { organizations, selectedOrganization, selectOrganization } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!selectedOrganization && organizations.length === 1) {
      selectOrganization(organizations[0].organization);
    }
  }, [selectedOrganization, organizations, selectOrganization]);

  if (selectedOrganization) return <Outlet />;
  if (organizations.length === 1) return <LoadingSpinner />; // auto-selecting
  // Remember where they were going, so picking an org continues there.
  return <Navigate to="/org-selection" replace state={{ from: `${location.pathname}${location.search}` }} />;
}

/**
 * Admin/Manager-only routes (#226). Staff and Viewer opening one by URL are
 * sent to their landing page, the same `canManage` rule the menus use, before
 * the screen renders.
 */
export function RequireManager() {
  const { userRole } = useAuth();
  if (!canManage(userRole)) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Root landing: role- and device-aware. */
export function LandingRedirect() {
  const { isMobile } = useAppShell();
  const { userRole } = useAuth();
  if (isMobile) {
    // Today is the phone's home screen for Staff, Admin and Manager (#445).
    if (userRole === 'Viewer') return <Navigate to="/gigs" replace />;
    return <Navigate to="/today" replace />;
  }
  if (userRole === 'Viewer') return <Navigate to="/gigs" replace />;
  return <Navigate to="/dashboard" replace />;
}

/**
 * Signs the user out and returns to `/`. Registered outside `RequireAuth` so
 * it works even when the app is otherwise stuck (invalid session, a route
 * guard bounce loop, etc.) — the one URL guaranteed to always recover.
 */
export function LogoutRoute() {
  const { logout } = useAuth();
  const [ranOnce, setRanOnce] = useState(false);

  useEffect(() => {
    if (ranOnce) return;
    setRanOnce(true);
    logout()
      .catch(() => {
        // Still recover home even if the sign-out call itself failed —
        // this route exists specifically to get an unresponsive session
        // out of wherever it's stuck.
      })
      .finally(() => {
        // A hard reload, not a client-side navigate: on a direct visit to
        // /logout, AuthProvider mounts fresh and immediately re-checks for
        // a persisted session at the same time this logout() call is tearing
        // it down. A client-side navigate() lets that race resolve either
        // way — if the stale session check wins, RequireAuth/RequireOrg/
        // LandingRedirect route the "logged out" user right back into the
        // app (observed: landing on /dashboard with a now-invalid session).
        // Reloading fully guarantees AuthProvider only ever boots after
        // signOut() has actually finished.
        window.location.href = '/';
      });
  }, [ranOnce, logout]);

  return <LoadingSpinner />;
}

export function ResetPasswordRoute() {
  const navigate = useNavigate();
  return (
    <ResetPasswordScreen
      onComplete={() => {
        window.history.replaceState({}, '', '/');
        navigate('/');
      }}
    />
  );
}

/**
 * Invitation acceptance. Mirrors the old App.tsx flow: wait briefly for the
 * implicit-flow session; force profile completion first if needed; otherwise
 * show the acceptance screen. Surface a clear error if no session establishes.
 */
export function AcceptInvitationRoute() {
  const { isLoading, user, organizations, setUser } = useAuth();
  const navigate = useNavigate();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (user) {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(timer);
  }, [user]);

  if (isLoading) return <LoadingSpinner />;

  if (user) {
    if (profileIncomplete(user)) {
      return (
        <UserProfileCompletionScreen
          user={user}
          onProfileCompleted={(updatedUser) => setUser(updatedUser)}
        />
      );
    }
    return (
      <AcceptInvitationScreen
        user={user}
        organizations={organizations}
        onContinue={() => navigate('/')}
      />
    );
  }

  if (timedOut) {
    return (
      <InvitationErrorScreen
        error="We couldn't verify your invitation"
        errorDescription="The invite link may have expired, or this app's URL isn't allow-listed in the authentication settings. Ask an admin to resend the invitation."
        onBackToLogin={() => {
          window.history.replaceState({}, '', '/');
          navigate('/');
        }}
      />
    );
  }

  return <LoadingSpinner />;
}

export function CalendarCallbackRoute() {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (!user) return <LoadingSpinner />;
  return (
    <CalendarAuthCallback
      userId={user.id}
      onAuthComplete={() => navigate('/settings')}
      onBack={() => navigate('/settings')}
    />
  );
}

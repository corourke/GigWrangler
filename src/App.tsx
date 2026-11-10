import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { BrowserRouter, useNavigate } from 'react-router';
import { Toaster } from './components/ui/sonner';
import { NavigationProvider } from './contexts/NavigationProvider';
import { useAuth } from './contexts/AuthContext';
import { useMobileLock } from './hooks/useMobileLock';
import { useAppUpdateNotice } from './hooks/useAppUpdateNotice';
import MobileLockScreen from './components/mobile/MobileLockScreen';
import InvitationErrorScreen from './components/InvitationErrorScreen';
import { AppShellProvider } from './routes/appShell';
import { AppRoutes } from './routes/screens';
import { usePushOpen } from './hooks/usePushOpen';
import { useNav } from './routes/useNav';
import { ChunkLoadBoundary } from './routes/ChunkLoadBoundary';

// Loaded the first time the profile dialog opens, not at start-up (A21).
const EditUserProfileDialog = lazy(() => import('./components/EditUserProfileDialog'));

interface InvitationError {
  error: string;
  description?: string;
}

// Auth redirect errors arrive in the URL hash (e.g. expired invite link).
function parseInvitationError(): InvitationError | null {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#')) {
    const params = new URLSearchParams(hash.substring(1));
    const error = params.get('error');
    if (error) {
      return {
        error,
        description: params.get('error_description')?.replace(/\+/g, ' ') || undefined,
      };
    }
  }
  return null;
}

function AppContent() {
  useAppUpdateNotice();
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { user, selectedOrganization, setUser } = useAuth();
  const { isLocked, lock, unlock } = useMobileLock(user?.email ?? undefined, isMobile, user?.id);
  const navigate = useNavigate();
  const nav = useNav();
  // A tapped push notification opens its screen and clears it from the bell.
  usePushOpen(user?.id);

  const [showEditProfileDialog, setShowEditProfileDialog] = useState(false);
  // Mounted from the first time it opens, so it keeps its close animation after that.
  const profileDialogUsed = useRef(false);
  if (showEditProfileDialog) profileDialogUsed.current = true;
  const mobileGigListScrollTop = useRef(0);
  const [invitationError, setInvitationError] = useState<InvitationError | null>(
    parseInvitationError,
  );

  // Supabase's implicit flow encodes the entry type in the URL hash/query while
  // the path may still be '/'. Redirect to the matching route once on mount so
  // deep-linked recovery/invite/calendar-callback flows resolve.
  useEffect(() => {
    const { pathname, hash, search } = window.location;
    if (hash.includes('type=recovery') && pathname !== '/reset-password') {
      navigate('/reset-password', { replace: true });
    } else if (hash.includes('type=invite') && pathname !== '/accept-invitation') {
      navigate('/accept-invitation', { replace: true });
    } else if (search.includes('code=') && pathname !== '/auth/google-calendar/callback') {
      navigate('/auth/google-calendar/callback', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (invitationError) {
    return (
      <InvitationErrorScreen
        error={invitationError.error}
        errorDescription={invitationError.description}
        onBackToLogin={() => {
          setInvitationError(null);
          window.location.hash = '';
          navigate('/');
        }}
      />
    );
  }

  return (
    <AppShellProvider
      value={{
        isMobile,
        openEditProfile: () => setShowEditProfileDialog(true),
        lockMobile: lock,
        mobileGigListScrollTop,
      }}
    >
      <NavigationProvider
        onNavigateToDashboard={nav.toDashboard}
        onNavigateToGigs={nav.toGigs}
        onNavigateToTeam={nav.toTeam}
        onNavigateToAssets={nav.toAssets}
        onNavigateToFinancials={() => nav.toFinancials()}
        onNavigateToPurchase={(purchaseId, returnGigId) =>
          nav.toFinancials({ highlightPurchaseId: purchaseId, returnGigId })
        }
        onNavigateToGigDetail={(gigId) => nav.viewGig(gigId)}
        onEditProfile={() => setShowEditProfileDialog(true)}
        onNavigateToSettings={nav.toSettings}
      >
        <AppRoutes />

        <Toaster />

        {isMobile && isLocked && user && selectedOrganization && (
          <MobileLockScreen onUnlock={unlock} onLogout={nav.logoutAndHome} />
        )}

        {/* Edit Profile Dialog — available on all screens */}
        {user && profileDialogUsed.current && (
          <ChunkLoadBoundary>
            <Suspense fallback={null}>
              <EditUserProfileDialog
                user={user}
                open={showEditProfileDialog}
                onOpenChange={setShowEditProfileDialog}
                onProfileUpdated={setUser}
              />
            </Suspense>
          </ChunkLoadBoundary>
        )}
      </NavigationProvider>
    </AppShellProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;

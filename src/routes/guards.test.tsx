import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import { Suspense } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { LandingRedirect, LogoutRoute, RequireAuth, RequireOrg } from './guards';
import { useLocation } from 'react-router';

const mockUseAppShell = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('./appShell', () => ({
  useAppShell: () => mockUseAppShell(),
}));

vi.mock('./prefetch', () => ({ prefetchLandingScreen: vi.fn() }));
vi.mock('../components/TemporaryPasswordScreen', () => ({
  default: ({ onComplete }: any) => <button type="button" onClick={onComplete}>Temporary password screen</button>,
}));

vi.mock('../components/security/TwoFactorSetupRequiredScreen', () => ({
  default: ({ onDone }: any) => <button type="button" onClick={onDone}>Two-factor setup screen</button>,
}));
vi.mock('../components/security/TwoFactorReminder', () => ({
  default: ({ requiredAfter }: any) => <div>Reminder until {requiredAfter}</div>,
}));

vi.mock('../components/security/TwoFactorChallengeScreen', () => ({
  default: ({ onVerified }: any) => <button type="button" onClick={onVerified}>Two-factor code screen</button>,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

function renderWithRouter() {
  let navigatedTo = '';
  function Capture({ path }: { path: string }) {
    navigatedTo = path;
    return <div data-testid={`at-${path.replace('/', '')}`} />;
  }
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingRedirect />} />
        <Route path="/dashboard" element={<Capture path="/dashboard" />} />
        <Route path="/gigs" element={<Capture path="/gigs" />} />
        <Route path="/today" element={<Capture path="/today" />} />
      </Routes>
    </MemoryRouter>
  );
  return navigatedTo;
}

describe('LandingRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // #445: on the phone, Today is the home screen for Staff, Admin and Manager.
  it('redirects mobile Staff to /today (Home)', () => {
    mockUseAppShell.mockReturnValue({ isMobile: true });
    mockUseAuth.mockReturnValue({ userRole: 'Staff' });
    const result = renderWithRouter();
    expect(result).toBe('/today');
  });

  it('redirects mobile Admin to /today', () => {
    mockUseAppShell.mockReturnValue({ isMobile: true });
    mockUseAuth.mockReturnValue({ userRole: 'Admin' });
    const result = renderWithRouter();
    expect(result).toBe('/today');
  });

  it('redirects mobile Manager to /today', () => {
    mockUseAppShell.mockReturnValue({ isMobile: true });
    mockUseAuth.mockReturnValue({ userRole: 'Manager' });
    const result = renderWithRouter();
    expect(result).toBe('/today');
  });

  it('redirects mobile Viewer to /gigs', () => {
    mockUseAppShell.mockReturnValue({ isMobile: true });
    mockUseAuth.mockReturnValue({ userRole: 'Viewer' });
    const result = renderWithRouter();
    expect(result).toBe('/gigs');
  });

  it('redirects desktop Admin to /dashboard', () => {
    mockUseAppShell.mockReturnValue({ isMobile: false });
    mockUseAuth.mockReturnValue({ userRole: 'Admin' });
    const result = renderWithRouter();
    expect(result).toBe('/dashboard');
  });

  it('redirects desktop Viewer to /gigs', () => {
    mockUseAppShell.mockReturnValue({ isMobile: false });
    mockUseAuth.mockReturnValue({ userRole: 'Viewer' });
    const result = renderWithRouter();
    expect(result).toBe('/gigs');
  });

  it('redirects desktop Manager to /dashboard', () => {
    mockUseAppShell.mockReturnValue({ isMobile: false });
    mockUseAuth.mockReturnValue({ userRole: 'Manager' });
    const result = renderWithRouter();
    expect(result).toBe('/dashboard');
  });

  it('redirects desktop Staff to /dashboard', () => {
    mockUseAppShell.mockReturnValue({ isMobile: false });
    mockUseAuth.mockReturnValue({ userRole: 'Staff' });
    const result = renderWithRouter();
    expect(result).toBe('/dashboard');
  });

  it('redirects mobile Viewer to /gigs (not /dashboard)', () => {
    mockUseAppShell.mockReturnValue({ isMobile: true });
    mockUseAuth.mockReturnValue({ userRole: 'Viewer' });
    const result = renderWithRouter();
    expect(result).toBe('/gigs');
  });
});

describe('LogoutRoute (#18)', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    // A real browser navigation, not a client-side route change — see the
    // comment on LogoutRoute for why. Stub window.location so we can assert
    // on it without jsdom attempting (and failing) a real navigation.
    // @ts-expect-error - deliberately reassigning window.location for the test
    delete window.location;
    (window as any).location = { ...originalLocation, href: '' };
  });

  afterEach(() => {
    (window as any).location = originalLocation;
  });

  function renderLogoutRoute() {
    render(
      <MemoryRouter initialEntries={['/logout']}>
        <Routes>
          <Route path="/logout" element={<LogoutRoute />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('signs the user out and hard-navigates to / — a working /logout URL', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ logout });

    renderLogoutRoute();

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.href).toBe('/'));
  });

  it('still hard-navigates to / if logout() rejects, so a broken session is never a dead end', async () => {
    const logout = vi.fn().mockRejectedValue(new Error('network error'));
    mockUseAuth.mockReturnValue({ logout });

    renderLogoutRoute();

    await waitFor(() => expect(window.location.href).toBe('/'));
  });
});

vi.mock('../components/LoginScreen', () => ({
  default: () => <div data-testid="login-screen" />,
}));

describe('RequireAuth after a failed profile load (#94)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderRequireAuth() {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<div data-testid="app" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  }

  it('shows an error with a retry instead of the login screen', async () => {
    const refreshProfile = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ isLoading: false, user: null, profileLoadError: 'Failed to fetch', refreshProfile });

    renderRequireAuth();

    expect(screen.queryByTestId('login-screen')).toBeNull();
    expect(screen.getByText(/couldn.t load your account/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(refreshProfile).toHaveBeenCalledTimes(1));
  });

  it('shows the login screen when there is no user and no error', () => {
    mockUseAuth.mockReturnValue({ isLoading: false, user: null, profileLoadError: null, refreshProfile: vi.fn() });
    renderRequireAuth();
    expect(screen.getByTestId('login-screen')).toBeTruthy();
  });
});

describe('RequireOrg', () => {
  it('sends a deep link to the org picker remembering where it was going', () => {
    mockUseAuth.mockReturnValue({ organizations: [{}, {}], selectedOrganization: null, selectOrganization: vi.fn() });
    let from: string | undefined;
    function Picker() {
      from = (useLocation().state as { from?: string } | null)?.from;
      return <div data-testid="picker" />;
    }
    render(
      <MemoryRouter initialEntries={['/financials/gig-accounting?x=1']}>
        <Routes>
          <Route element={<RequireOrg />}>
            <Route path="/financials/:tab?" element={<div />} />
          </Route>
          <Route path="/org-selection" element={<Picker />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('picker')).toBeInTheDocument();
    expect(from).toBe('/financials/gig-accounting?x=1');
  });
});

// An account an Admin created with a password must choose its own before anything else.
describe('RequireAuth: a temporary password', () => {
  const user = { id: 'u1', first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com' };
  function renderGuard() {
    render(
      <Suspense fallback={null}>
      <MemoryRouter initialEntries={['/gigs']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/gigs" element={<div>Gigs</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
      </Suspense>
    );
  }

  it('shows the password screen instead of the app', async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, user, mustChangePassword: true, passwordChanged: vi.fn() });
    renderGuard();
    expect(await screen.findByRole('button', { name: 'Temporary password screen' })).toBeInTheDocument();
    expect(screen.queryByText('Gigs')).not.toBeInTheDocument();
  });

  it('goes on once it is set', async () => {
    const passwordChanged = vi.fn();
    mockUseAuth.mockReturnValue({ isLoading: false, user, mustChangePassword: true, passwordChanged });
    renderGuard();
    fireEvent.click(await screen.findByRole('button', { name: 'Temporary password screen' }));
    expect(passwordChanged).toHaveBeenCalled();
  });

  it('shows the app when no change is needed', () => {
    mockUseAuth.mockReturnValue({ isLoading: false, user, mustChangePassword: false });
    renderGuard();
    expect(screen.getByText('Gigs')).toBeInTheDocument();
  });
});

describe('RequireAuth: two-factor sign-in (#361)', () => {
  const user = { id: 'user-1', first_name: 'Pat', last_name: 'Lee', email: 'pat@example.com' };
  const renderGuard = () => render(
    <Suspense fallback={null}>
      <MemoryRouter initialEntries={['/gigs']}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/gigs" element={<div>Gigs</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
      </Suspense>
  );

  it('asks for the code before the app when the session still needs it', async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, user, mustChangePassword: false, twoFactorPending: true, twoFactorVerified: vi.fn() });
    renderGuard();
    expect(await screen.findByRole('button', { name: 'Two-factor code screen' })).toBeInTheDocument();
    expect(screen.queryByText('Gigs')).not.toBeInTheDocument();
  });

  it('goes on once the code is entered', async () => {
    const twoFactorVerified = vi.fn();
    mockUseAuth.mockReturnValue({ isLoading: false, user, mustChangePassword: false, twoFactorPending: true, twoFactorVerified });
    renderGuard();
    fireEvent.click(await screen.findByRole('button', { name: 'Two-factor code screen' }));
    expect(twoFactorVerified).toHaveBeenCalled();
  });

  it('asks an Admin past the grace period to set it up before the app, even before the profile loads', async () => {
    const twoFactorVerified = vi.fn();
    mockUseAuth.mockReturnValue({ isLoading: false, user: null, mustChangePassword: false, twoFactorPending: false, twoFactorSetupRequired: true, twoFactorVerified });
    renderGuard();
    fireEvent.click(await screen.findByRole('button', { name: 'Two-factor setup screen' }));
    expect(twoFactorVerified).toHaveBeenCalled();
    expect(screen.queryByText('Gigs')).not.toBeInTheDocument();
  });

  it('asks for the code before the profile loads too', async () => {
    mockUseAuth.mockReturnValue({ isLoading: false, user: null, mustChangePassword: false, twoFactorPending: true, twoFactorVerified: vi.fn() });
    renderGuard();
    expect(await screen.findByRole('button', { name: 'Two-factor code screen' })).toBeInTheDocument();
  });

  it('reminds an Admin in the grace period, above the app', () => {
    mockUseAuth.mockReturnValue({ isLoading: false, user, mustChangePassword: false, twoFactorPending: false, twoFactorReminderUntil: '2026-12-01T00:00:00Z' });
    renderGuard();
    expect(screen.getByText('Reminder until 2026-12-01T00:00:00Z')).toBeInTheDocument();
    expect(screen.getByText('Gigs')).toBeInTheDocument();
  });
});

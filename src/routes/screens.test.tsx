import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from './screens';

const mockUseAuth = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('./appShell', () => ({
  useAppShell: () => ({
    isMobile: false,
    openEditProfile: vi.fn(),
    lockMobile: vi.fn(),
    mobileGigListScrollTop: { current: 0 },
  }),
}));

// Keep the sign-in landing prefetch out of the way
vi.mock('./prefetch', () => ({ prefetchLandingScreen: vi.fn() }));

vi.mock('../components/OrganizationSelectionScreen', () => ({
  default: () => <div>OrganizationSelectionScreen stub</div>,
}));
vi.mock('../components/Dashboard', () => ({
  default: () => <div>Dashboard stub</div>,
}));
vi.mock('../components/GigListScreen', () => ({
  default: () => <div>GigListScreen stub</div>,
}));

vi.mock('../components/AssetScreen', () => ({
  default: () => <div>AssetScreen stub</div>,
}));
vi.mock('../components/FinancialsScreen', () => ({
  default: () => <div>FinancialsScreen stub</div>,
}));

// The screen fails with a chunk-load error, as a lazy screen whose chunk failed to fetch does when
// React renders it. (A module whose default export throws on read no longer works: React 19 also
// reads it for its dev tools, outside render, and that error goes unhandled.)
vi.mock('../components/TeamScreen', () => ({
  default: (): never => {
    throw new TypeError('Failed to fetch dynamically imported module: /assets/TeamScreen-x.js');
  },
}));

const org = { id: 'org-1', name: 'Org' };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('AppRoutes lazy screens', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      user: { id: 'u1', first_name: 'A', last_name: 'B', email: 'a@b.c' },
      organizations: [{ organization: org, role: 'Admin' }],
      selectedOrganization: org,
      userRole: 'Admin',
      selectOrganization: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
      setOrganizations: vi.fn(),
      refreshProfile: vi.fn(),
    });
  });

  it('shows the loading fallback first, then the screen once its chunk loads', async () => {
    renderAt('/dashboard');
    // Lazy: the screen is not in the first paint, the Suspense fallback is
    expect(screen.queryByText('Dashboard stub')).not.toBeInTheDocument();
    expect(await screen.findByText('Dashboard stub')).toBeInTheDocument();
  });

  // A17: the organization picker (and the app header it brings) stays out of the entry chunk.
  it('lazy-loads the organization picker the same way', async () => {
    renderAt('/org-selection');
    expect(screen.queryByText('OrganizationSelectionScreen stub')).not.toBeInTheDocument();
    expect(await screen.findByText('OrganizationSelectionScreen stub')).toBeInTheDocument();
  });

  it('lazy-loads the gig list the same way', async () => {
    renderAt('/gigs');
    expect(screen.queryByText('GigListScreen stub')).not.toBeInTheDocument();
    expect(await screen.findByText('GigListScreen stub')).toBeInTheDocument();
  });

  it('repairs and reloads once, then offers a reload, when a screen chunk fails to load', async () => {
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalLocation = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } });
    try {
      const first = renderAt('/team');
      expect(await screen.findByText('Updating the app…')).toBeInTheDocument();
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      first.unmount();

      // Still failing after that reload: no second automatic reload
      renderAt('/team');
      expect(await screen.findByRole('button', { name: 'Reload' })).toBeInTheDocument();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
      consoleError.mockRestore();
      window.removeEventListener('error', swallow);
    }
  });
});

// #226 item 8: Staff and Viewer opening a manage-only URL are sent to their
// landing page (the same canManage rule the menus use), never shown the form.
describe('AppRoutes manage-only URLs', () => {
  const paths: [string, string][] = [
    ['/assets/new', 'AssetScreen stub'],
    ['/assets/a1/edit', 'AssetScreen stub'],
    ['/financials', 'FinancialsScreen stub'],
  ];
  const landing: Record<string, string> = { Staff: 'Dashboard stub', Viewer: 'GigListScreen stub' };

  function signInAs(role: string) {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      user: { id: 'u1', first_name: 'A', last_name: 'B', email: 'a@b.c' },
      organizations: [{ organization: org, role }],
      selectedOrganization: org,
      userRole: role,
      selectOrganization: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
      setOrganizations: vi.fn(),
      refreshProfile: vi.fn(),
    });
  }

  for (const [path, stub] of paths) {
    for (const role of ['Staff', 'Viewer']) {
      it(`sends ${role} away from ${path} to their landing page`, async () => {
        signInAs(role);
        renderAt(path);
        expect(await screen.findByText(landing[role])).toBeInTheDocument();
        expect(screen.queryByText(stub)).not.toBeInTheDocument();
      });
    }
    for (const role of ['Admin', 'Manager']) {
      it(`lets ${role} open ${path}`, async () => {
        signInAs(role);
        renderAt(path);
        expect(await screen.findByText(stub)).toBeInTheDocument();
      });
    }
  }
});

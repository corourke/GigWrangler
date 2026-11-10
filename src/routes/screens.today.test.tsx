import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { AppRoutes } from './screens';

const mockUseAuth = vi.fn();
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

let isMobile = true;
vi.mock('./appShell', () => ({
  useAppShell: () => ({ isMobile, openEditProfile: vi.fn(), lockMobile: vi.fn(), mobileGigListScrollTop: { current: 0 } }),
}));
vi.mock('./prefetch', () => ({ prefetchLandingScreen: vi.fn() }));

const saveAhead = vi.fn();
vi.mock('../components/mobile/useDayOfShowData', () => ({
  useSaveTodaySheetsAhead: (args: any) => saveAhead(args),
  hasTodayTab: (role: string) => ['Staff', 'Admin', 'Manager'].includes(role),
}));
vi.mock('../components/mobile/MobileLayout', () => ({
  default: ({ children, currentRoute, onNavigate }: any) => (
    <div>
      <span>tab:{currentRoute}</span>
      <button onClick={() => onNavigate('mobile-today')}>go-today</button>
      {children}
    </div>
  ),
}));
vi.mock('../components/mobile/MobileToday', () => ({
  default: ({ gigId, onChooseGig }: any) => (
    <div>
      MobileToday stub gig={gigId ?? 'auto'}
      <button onClick={() => onChooseGig('g2')}>choose</button>
    </div>
  ),
}));
vi.mock('../components/mobile/MobileGigList', () => ({ default: () => <div>MobileGigList stub</div> }));
vi.mock('../components/Dashboard', () => ({ default: () => <div>Dashboard stub</div> }));
vi.mock('../components/GigListScreen', () => ({ default: () => <div>GigListScreen stub</div> }));

const org = { id: 'org-1', name: 'Org' };
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

function Where() {
  const l = useLocation();
  return <span>at:{l.pathname}{l.search}</span>;
}
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  );

describe('/today (day-of-show sheet, §3e)', () => {
  beforeEach(() => {
    isMobile = true;
    saveAhead.mockClear();
  });

  for (const role of ['Staff', 'Admin', 'Manager']) {
    it(`opens the Today tab on the phone for ${role}`, async () => {
      signInAs(role);
      renderAt('/today');
      expect(await screen.findByText('MobileToday stub gig=auto')).toBeInTheDocument();
      expect(screen.getByText('tab:mobile-today')).toBeInTheDocument();
    });
  }

  it('opens a gig chosen from several, and keeps the choice in the address', async () => {
    signInAs('Staff');
    renderAt('/today?gig=g1');
    expect(await screen.findByText('MobileToday stub gig=g1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('choose'));
    expect(await screen.findByText('MobileToday stub gig=g2')).toBeInTheDocument();
    expect(screen.getByText('at:/today?gig=g2')).toBeInTheDocument();
  });

  it('sends a Viewer to the gig list', async () => {
    signInAs('Viewer');
    renderAt('/today');
    expect(await screen.findByText('MobileGigList stub')).toBeInTheDocument();
  });

  it('sends desktop to the dashboard', async () => {
    isMobile = false;
    signInAs('Manager');
    renderAt('/today');
    expect(await screen.findByText('Dashboard stub')).toBeInTheDocument();
  });

  it('the Today tab goes to /today from any phone screen', async () => {
    signInAs('Manager');
    renderAt('/gigs');
    await screen.findByText('MobileGigList stub');
    fireEvent.click(screen.getByText('go-today'));
    expect(await screen.findByText('MobileToday stub gig=auto')).toBeInTheDocument();
  });

  it("saves today's sheets ahead from every phone screen", async () => {
    signInAs('Staff');
    renderAt('/gigs');
    await screen.findByText('MobileGigList stub');
    expect(saveAhead).toHaveBeenCalledWith({ userId: 'u1', orgId: 'org-1', role: 'Staff' });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
vi.mock('../components/mobile/SaveTodaySheetsAhead', () => ({
  default: (props: any) => {
    saveAhead(props);
    return null;
  },
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
  default: ({ onOpenDaySheet }: any) => (
    <div>
      MobileToday stub
      <button onClick={() => onOpenDaySheet('g2')}>choose</button>
    </div>
  ),
}));
vi.mock('../components/mobile/MobileGigList', () => ({ default: () => <div>MobileGigList stub</div> }));
vi.mock('../components/mobile/MobileDaySheet', () => ({
  default: ({ gigId, onBack }: any) => (
    <div>
      MobileDaySheet stub gig={gigId}
      <button onClick={onBack}>back</button>
    </div>
  ),
}));
vi.mock('../components/gig/GigPage', () => ({ default: ({ gigId }: any) => <div>GigPage stub {gigId}</div> }));
vi.mock('../components/Dashboard', () => ({ default: () => <div>Dashboard stub</div> }));
vi.mock('../components/mobile/MobileDashboard', () => ({ default: () => <div>MobileDashboard stub</div> }));
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
      expect(await screen.findByText('MobileToday stub')).toBeInTheDocument();
      expect(screen.getByText('tab:mobile-today')).toBeInTheDocument();
    });
  }

  // #445: Today is a home screen; a gig's sheet is its own screen. Old /today?gig= links still work.
  it("opens a gig's day sheet from Today, and old /today?gig= links go to it", async () => {
    signInAs('Staff');
    renderAt('/today');
    fireEvent.click(await screen.findByText('choose'));
    expect(await screen.findByText('at:/gigs/g2/day-sheet')).toBeInTheDocument();
  });

  it('sends an old /today?gig= link to that gig\'s day sheet', async () => {
    signInAs('Staff');
    renderAt('/today?gig=g1');
    expect(await screen.findByText('MobileDaySheet stub gig=g1')).toBeInTheDocument();
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
    expect(await screen.findByText('MobileToday stub')).toBeInTheDocument();
  });

  it("saves today's sheets ahead from every phone screen", async () => {
    signInAs('Staff');
    renderAt('/gigs');
    await screen.findByText('MobileGigList stub');
    await waitFor(() => expect(saveAhead).toHaveBeenCalledWith({ userId: 'u1', orgId: 'org-1', role: 'Staff' }));
  });

  it('saves nothing ahead for a Viewer', async () => {
    signInAs('Viewer');
    renderAt('/gigs');
    await screen.findByText('MobileGigList stub');
    expect(saveAhead).not.toHaveBeenCalled();
  });
});

// Plan #445 (A1): the day sheet for any gig.
describe('/gigs/:id/day-sheet', () => {
  beforeEach(() => {
    isMobile = true;
  });

  for (const role of ['Staff', 'Admin', 'Manager']) {
    it(`opens the gig's day sheet on the phone for ${role}`, async () => {
      signInAs(role);
      renderAt('/gigs/g7/day-sheet');
      expect(await screen.findByText('MobileDaySheet stub gig=g7')).toBeInTheDocument();
    });
  }

  it('sends a Viewer to the gig list', async () => {
    signInAs('Viewer');
    renderAt('/gigs/g7/day-sheet');
    expect(await screen.findByText('MobileGigList stub')).toBeInTheDocument();
  });

  it('opens the gig page on desktop', async () => {
    isMobile = false;
    signInAs('Manager');
    renderAt('/gigs/g7/day-sheet');
    expect(await screen.findByText('at:/gigs/g7')).toBeInTheDocument();
  });

  it('goes back to the page it came from', async () => {
    signInAs('Staff');
    render(
      <MemoryRouter initialEntries={['/today', '/gigs/g7/day-sheet']} initialIndex={1}>
        <AppRoutes />
        <Where />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText('back'));
    expect(await screen.findByText('at:/today')).toBeInTheDocument();
  });
});

// #445: Today is the phone's home; Staff's old Dashboard (My Schedule) is part of it.
describe('the old phone Dashboard', () => {
  beforeEach(() => {
    isMobile = true;
  });

  for (const role of ['Staff', 'Admin', 'Manager']) {
    it(`goes to Today (Home) on the phone for ${role}`, async () => {
      signInAs(role);
      renderAt('/dashboard');
      expect(await screen.findByText('MobileToday stub')).toBeInTheDocument();
      expect(screen.getByText('at:/today')).toBeInTheDocument();
    });
  }

  it('is still the dashboard on desktop', async () => {
    isMobile = false;
    signInAs('Staff');
    renderAt('/dashboard');
    expect(await screen.findByText('Dashboard stub')).toBeInTheDocument();
  });
});

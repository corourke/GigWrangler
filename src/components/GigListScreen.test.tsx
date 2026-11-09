import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GigListScreen from './GigListScreen';
import { renderWithQuery } from '../test/renderWithQuery';

// Mock localStorage. Whether jsdom / the JS engine backs localStorage with a
// real implementation varies (it is absent under the CI runner), so provide a
// deterministic stand-in the way the other list-screen tests do.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    length: 0,
    key: vi.fn((_index: number) => null),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

const now = Date.now();
const futureGig = {
  id: 'gig-future',
  owner_organization_id: 'org-1',
  title: 'Upcoming Show',
  status: 'Booked',
  start: new Date(now + 86400000).toISOString(),
  end: new Date(now + 90000000).toISOString(),
  timezone: 'America/New_York',
  tags: [],
  notes: '',
  venue: null,
  act: null,
};
const pastGig = {
  id: 'gig-past',
  owner_organization_id: 'org-1',
  title: 'Old Show',
  status: 'Completed',
  start: new Date(now - 172800000).toISOString(),
  end: new Date(now - 168000000).toISOString(),
  timezone: 'America/New_York',
  tags: [],
  notes: '',
  venue: null,
  act: null,
};

vi.mock('../services/gig.service', () => ({
  getGigsForOrganization: vi.fn(),
  updateGig: vi.fn(),
  duplicateGig: vi.fn(),
  deleteGig: vi.fn(),
  getGigExportAggregates: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../utils/gigExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/gigExport')>()),
  downloadGigCsv: vi.fn(),
}));

vi.mock('../services/conflictDetection.service', () => ({
  checkAllConflictsForGigs: vi.fn().mockResolvedValue([]),
}));

import { getGigsForOrganization } from '../services/gig.service';
import { downloadGigCsv } from '../utils/gigExport';
import { checkAllConflictsForGigs } from '../services/conflictDetection.service';

const organization = { id: 'org-1', name: 'Test Org' } as any;
const user = { id: 'user-1', name: 'Test User' } as any;

const noop = () => {};

describe('GigListScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(getGigsForOrganization).mockResolvedValue([futureGig, pastGig]);
  });

  describe('a gig that started earlier today (#74)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('stays in Upcoming until its day is over', async () => {
      // 15:00 in New York; the gig ran 10:00-12:00 there the same day.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-25T19:00:00.000Z'));
      vi.mocked(getGigsForOrganization).mockResolvedValue([
        { ...futureGig, id: 'gig-today', title: 'Today Show', start: '2026-09-25T14:00:00.000Z', end: '2026-09-25T16:00:00.000Z' },
      ]);
      renderWithQuery(
        <GigListScreen
          organization={organization}
          user={user}
          userRole="Admin"
          onBack={noop}
          onCreateGig={noop}
          onViewGig={noop}
          onEditGig={noop}
          onNavigateToDashboard={noop}
          onNavigateToGigs={noop}
          onNavigateToAssets={noop}
          onSwitchOrganization={noop}
          onLogout={noop}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Today Show')).toBeInTheDocument();
      });
      expect(screen.getByText('Upcoming (1)')).toBeInTheDocument();
      expect(screen.getByText('Past (0)')).toBeInTheDocument();
    });
  });

  it('shows Upcoming gigs by default and hides Past gigs', async () => {
    renderWithQuery(
      <GigListScreen
        organization={organization}
        user={user}
        userRole="Admin"
        onBack={noop}
        onCreateGig={noop}
        onViewGig={noop}
        onEditGig={noop}
        onNavigateToDashboard={noop}
        onNavigateToGigs={noop}
        onNavigateToAssets={noop}
        onSwitchOrganization={noop}
        onLogout={noop}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Upcoming Show')).toBeInTheDocument();
    });
    expect(screen.queryByText('Old Show')).not.toBeInTheDocument();
  });

  it('shows Past gigs and hides Upcoming gigs when the Past tab is selected', async () => {
    const ue = userEvent.setup();
    renderWithQuery(
      <GigListScreen
        organization={organization}
        user={user}
        userRole="Admin"
        onBack={noop}
        onCreateGig={noop}
        onViewGig={noop}
        onEditGig={noop}
        onNavigateToDashboard={noop}
        onNavigateToGigs={noop}
        onNavigateToAssets={noop}
        onSwitchOrganization={noop}
        onLogout={noop}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Upcoming Show')).toBeInTheDocument();
    });

    await ue.click(screen.getByText('Past (1)'));

    await waitFor(() => {
      expect(screen.getByText('Old Show')).toBeInTheDocument();
    });
    expect(screen.queryByText('Upcoming Show')).not.toBeInTheDocument();
  });

  it('labels the tabs with the count of gigs in each timeframe', async () => {
    renderWithQuery(
      <GigListScreen
        organization={organization}
        user={user}
        userRole="Admin"
        onBack={noop}
        onCreateGig={noop}
        onViewGig={noop}
        onEditGig={noop}
        onNavigateToDashboard={noop}
        onNavigateToGigs={noop}
        onNavigateToAssets={noop}
        onSwitchOrganization={noop}
        onLogout={noop}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Upcoming (1)')).toBeInTheDocument();
    });
    expect(screen.getByText('Past (1)')).toBeInTheDocument();
  });

  it('opens the gig when the title cell is clicked (#27)', async () => {
    const ue = userEvent.setup();
    const onViewGig = vi.fn();
    renderWithQuery(
      <GigListScreen
        organization={organization}
        user={user}
        userRole="Admin"
        onBack={noop}
        onCreateGig={noop}
        onViewGig={onViewGig}
        onEditGig={noop}
        onNavigateToDashboard={noop}
        onNavigateToGigs={noop}
        onNavigateToAssets={noop}
        onSwitchOrganization={noop}
        onLogout={noop}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Upcoming Show')).toBeInTheDocument();
    });

    await ue.click(screen.getByText('Upcoming Show'));

    expect(onViewGig).toHaveBeenCalledWith('gig-future');
  });

  // Issue #168: money columns are Admin/Manager only (gig_financials RLS, and
  // Staff/Viewers can't see pay), so they aren't offered or exported to others.
  describe('financial columns (#168)', () => {
    const moneyColumns = ['Cost of Staff', 'Revenue', 'Expenses', 'Profit'];

    const renderAs = (userRole: 'Admin' | 'Manager' | 'Staff' | 'Viewer') =>
      renderWithQuery(
        <GigListScreen
          organization={organization}
          user={user}
          userRole={userRole}
          onBack={noop}
          onCreateGig={noop}
          onViewGig={noop}
          onEditGig={noop}
          onNavigateToDashboard={noop}
          onNavigateToGigs={noop}
          onNavigateToAssets={noop}
          onSwitchOrganization={noop}
          onLogout={noop}
        />
      );

    it.each(['Admin', 'Manager'] as const)('offers the money columns to %s', async (role) => {
      const ue = userEvent.setup();
      renderAs(role);
      await screen.findByText('Upcoming Show');

      await ue.click(screen.getByRole('button', { name: /columns/i }));

      expect(screen.getByRole('menuitemcheckbox', { name: 'Number of Staff' })).toBeInTheDocument();
      for (const name of moneyColumns) {
        expect(screen.getByRole('menuitemcheckbox', { name })).toBeInTheDocument();
      }
    });

    it.each(['Staff', 'Viewer'] as const)('does not offer the money columns to %s', async (role) => {
      const ue = userEvent.setup();
      renderAs(role);
      await screen.findByText('Upcoming Show');

      await ue.click(screen.getByRole('button', { name: /columns/i }));

      expect(screen.getByRole('menuitemcheckbox', { name: 'Number of Staff' })).toBeInTheDocument();
      for (const name of moneyColumns) {
        expect(screen.queryByRole('menuitemcheckbox', { name })).not.toBeInTheDocument();
      }
    });

    it('does not export money columns for Staff, even if they were turned on in this browser', async () => {
      const ue = userEvent.setup();
      localStorage.setItem('table-state-gig-list', JSON.stringify({
        columnVisibility: { staffCount: true, costOfStaff: true, revenue: true, expenses: true, profit: true },
      }));
      renderAs('Staff');
      await screen.findByText('Upcoming Show');

      await ue.click(screen.getByRole('button', { name: /export/i }));
      await ue.click(await screen.findByRole('button', { name: 'Continue' }));

      expect(downloadGigCsv).toHaveBeenCalledTimes(1);
      const headerRow = vi.mocked(downloadGigCsv).mock.calls[0][0].split(/\r?\n/)[0];
      expect(headerRow).toContain('Number of Staff');
      for (const name of moneyColumns) {
        expect(headerRow).not.toContain(name);
      }
    });
  });

  // #175: deleting a gig is Admin-only on the server, so the row menu only offers it to Admins.
  describe('the row menu Delete action (#175)', () => {
    const openRowMenu = async (userRole: 'Admin' | 'Manager') => {
      const ue = userEvent.setup();
      renderWithQuery(
        <GigListScreen
          organization={organization}
          user={user}
          userRole={userRole}
          onBack={noop}
          onCreateGig={noop}
          onViewGig={noop}
          onEditGig={noop}
          onNavigateToDashboard={noop}
          onNavigateToGigs={noop}
          onNavigateToAssets={noop}
          onSwitchOrganization={noop}
          onLogout={noop}
        />
      );
      await screen.findByText('Upcoming Show');
      const trigger = screen.getAllByRole('button').find((b) => b.querySelector('.lucide-ellipsis'));
      expect(trigger).toBeDefined();
      await ue.click(trigger!);
      await screen.findByRole('menuitem', { name: 'Edit' });
    };

    it('is offered to Admins', async () => {
      await openRowMenu('Admin');
      expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    // #175: only the gig owner's Admins and Managers duplicate it.
    it("doesn't offer Duplicate on a gig another organization owns", async () => {
      vi.mocked(getGigsForOrganization).mockResolvedValue([{ ...futureGig, owner_organization_id: 'org-other' }, pastGig]);
      await openRowMenu('Admin');
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).not.toBeInTheDocument();
    });

    // #175 (Cameron 10-13): Delete is disabled with its reason, not hidden, when it would be refused.
    it("is disabled on a gig another organization owns, with the reason shown on selecting it", async () => {
      vi.mocked(getGigsForOrganization).mockResolvedValue([{ ...futureGig, owner_organization_id: 'org-other' }, pastGig]);
      await openRowMenu('Admin');
      const item = screen.getByRole('menuitem', { name: 'Delete' });
      expect(item).toHaveAttribute('aria-disabled', 'true');
      await userEvent.setup().click(item);
      expect(await screen.findByText("Only an Admin of the gig's owner organization can delete it.")).toBeInTheDocument();
    });

    it('is disabled when another claimed organization is on the gig (already loaded with the row)', async () => {
      vi.mocked(getGigsForOrganization).mockResolvedValue([{
        ...futureGig,
        participants: [
          { organization_id: 'org-1', role: 'Production', organization: { id: 'org-1', name: 'Test Org', claimed: true } },
          { organization_id: 'org-2', role: 'Sound', organization: { id: 'org-2', name: 'Sound Co', claimed: true } },
        ],
      }, pastGig]);
      await openRowMenu('Admin');
      const item = screen.getByRole('menuitem', { name: 'Delete' });
      expect(item).toHaveAttribute('aria-disabled', 'true');
      await userEvent.setup().click(item);
      expect(await screen.findByText(/other claimed organizations participating/)).toBeInTheDocument();
    });

    it('is not offered to Managers, who can still edit and duplicate', async () => {
      await openRowMenu('Manager');
      expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    });
  });

  describe('the conflict banner View button (#170)', () => {
    const conflict = {
      level: 'conflict' as const, type: 'staff' as const,
      gig_id: 'gig-future', gig_title: 'Upcoming Show',
      start: futureGig.start, end: futureGig.end,
      details: { conflicting_staff: [{ user_id: 'u-1', name: 'Sam Whitfield' }] },
    };

    const renderScreen = (viewMode: 'list' | 'calendar', onViewGig: (id: string, fromCalendar?: boolean) => void) =>
      renderWithQuery(
        <GigListScreen
          organization={organization}
          user={user}
          userRole="Admin"
          viewMode={viewMode}
          onBack={noop}
          onCreateGig={noop}
          onViewGig={onViewGig}
          onEditGig={noop}
          onNavigateToDashboard={noop}
          onNavigateToGigs={noop}
          onNavigateToAssets={noop}
          onSwitchOrganization={noop}
          onLogout={noop}
        />
      );

    beforeEach(() => {
      vi.mocked(checkAllConflictsForGigs).mockResolvedValue([conflict]);
    });

    it('from the list, opens the gig with Back to Gigs', async () => {
      const ue = userEvent.setup();
      const onViewGig = vi.fn();
      renderScreen('list', onViewGig);

      await ue.click(await screen.findByRole('button', { name: 'View' }));

      expect(onViewGig).toHaveBeenCalledWith('gig-future');
      expect(onViewGig.mock.calls[0][1]).toBeFalsy();
    });

    it('from the calendar, opens the gig with Back to Calendar', async () => {
      const ue = userEvent.setup();
      const onViewGig = vi.fn();
      renderScreen('calendar', onViewGig);

      await ue.click(await screen.findByRole('button', { name: 'View' }));

      expect(onViewGig).toHaveBeenCalledWith('gig-future', true);
    });
  });

  // #175: a gig the organization is Inactive on is tagged in the list.
  it('tags a gig the organization is Inactive on', async () => {
    vi.mocked(getGigsForOrganization).mockResolvedValue([{
      ...futureGig,
      owner_organization_id: 'org-other',
      participants: [{ organization_id: 'org-1', role: 'Sound', inactive: true, organization: { id: 'org-1', name: 'Test Org' } }],
    }, pastGig]);
    renderWithQuery(
      <GigListScreen organization={organization} user={user} userRole="Admin" onBack={noop} onCreateGig={noop}
        onViewGig={noop} onEditGig={noop} onNavigateToDashboard={noop} onNavigateToGigs={noop}
        onNavigateToAssets={noop} onSwitchOrganization={noop} onLogout={noop} />
    );
    const titles = await screen.findAllByText('Upcoming Show');
    const row = titles.map((t) => t.closest('tr')).find(Boolean) as HTMLElement;
    expect(within(row).getByText('Inactive')).toBeInTheDocument();
  });
});

// A10: how the list loads, fails, follows the organization and refreshes after a change. These
// hold before and after the move to react-query.
describe('GigListScreen: data loading (A10)', () => {
  const props = {
    user, userRole: 'Admin' as const, onBack: noop, onCreateGig: noop, onViewGig: noop, onEditGig: noop,
    onNavigateToDashboard: noop, onNavigateToGigs: noop, onNavigateToAssets: noop, onSwitchOrganization: noop, onLogout: noop,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(getGigsForOrganization).mockResolvedValue([futureGig, pastGig]);
    vi.mocked(checkAllConflictsForGigs).mockResolvedValue([]);
  });

  it('shows a load error, and Try Again loads the list', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getGigsForOrganization).mockRejectedValueOnce(new Error('Network down'));
    renderWithQuery(<GigListScreen organization={organization} {...props} />);
    expect(await screen.findByText('Error loading gigs')).toBeInTheDocument();
    expect(screen.getByText('Network down')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('Upcoming Show')).toBeInTheDocument();
  });

  it("shows the other organization's gigs after a switch", async () => {
    vi.mocked(getGigsForOrganization).mockImplementation(async (orgId: string) =>
      orgId === 'org-2' ? [{ ...futureGig, id: 'gig-b', owner_organization_id: 'org-2', title: 'Org B Show' }] : [futureGig]);
    const { rerender } = renderWithQuery(<GigListScreen organization={organization} {...props} />);
    await screen.findByText('Upcoming Show');
    rerender(<GigListScreen organization={{ id: 'org-2', name: 'Org B' } as any} {...props} />);
    expect(await screen.findByText('Org B Show')).toBeInTheDocument();
    expect(screen.queryByText('Upcoming Show')).not.toBeInTheDocument();
    expect(getGigsForOrganization).toHaveBeenCalledWith('org-2');
  });

  const openMenu = async () => {
    const ue = userEvent.setup();
    await screen.findByText('Upcoming Show');
    const trigger = screen.getAllByRole('button').find((b) => b.querySelector('.lucide-ellipsis'));
    await ue.click(trigger!);
    return ue;
  };

  it('reloads the list after duplicating a gig', async () => {
    const { duplicateGig } = await import('../services/gig.service');
    vi.mocked(duplicateGig).mockResolvedValue({ id: 'gig-copy' } as any);
    renderWithQuery(<GigListScreen organization={organization} {...props} />);
    const ue = await openMenu();
    vi.mocked(getGigsForOrganization).mockResolvedValue([futureGig, { ...futureGig, id: 'gig-copy', title: 'Upcoming Show (Copy)' }, pastGig]);
    await ue.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(await screen.findByText('Upcoming Show (Copy)')).toBeInTheDocument();
  });

  it('puts the gig back when a delete fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { deleteGig } = await import('../services/gig.service');
    vi.mocked(deleteGig).mockRejectedValue(new Error('Not allowed'));
    renderWithQuery(<GigListScreen organization={organization} {...props} />);
    const ue = await openMenu();
    await ue.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(deleteGig).toHaveBeenCalledWith('gig-future'));
    expect(await screen.findByText('Upcoming Show')).toBeInTheDocument();
  });
});

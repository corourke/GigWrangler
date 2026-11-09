import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery as render } from '../test/renderWithQuery';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import FinancialsScreen from './FinancialsScreen';
import { makeOrganization } from '../test/factories';
import { getAllGigAccountingSummaries } from '../services/gig.service';

// A10 characterization: the Gig Accounting tab inside the screen, as a tester clicks through it.
vi.mock('./AppHeader', () => ({ default: () => null }));
vi.mock('./financials/purchases/PurchasesSection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./financials/purchases/PurchasesSection')>();
  return { PurchasesActions: actual.PurchasesActions, default: () => <div data-testid="purchases" /> };
});
vi.mock('./financials/purchases/useScanQueue', () => ({
  useScanQueue: () => ({ counts: { ready: 0, scanning: 0, queued: 0, failed: 0 } }),
}));
vi.mock('./financials/GigAccountingRowDetail', () => ({ default: () => null }));
vi.mock('../services/gig.service', () => ({ getAllGigAccountingSummaries: vi.fn() }));

const summary = (gigTitle: string) => ({
  gigId: gigTitle, gigTitle, gigStatus: 'Completed', gigStart: new Date().toISOString(), gigEnd: new Date().toISOString(),
  contractAmount: 100, received: 0, outstandingRevenue: 100, dueRevenue: 100, actualCosts: 0, expectedStaffCosts: 0,
  expectedSubContractCosts: 0, totalCosts: 0, paymentsToMake: 0, paymentsDue: 0, profit: 100, margin: 100,
  paymentHealth: 'revenue-outstanding', moneyInBadge: { label: 'Payment due', tone: 'attention' },
});

const base = {
  user: { id: 'u' } as any,
  userRole: 'Admin' as const,
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
  onNavigateToGigs: vi.fn(),
  onNavigate: vi.fn(),
};

describe('FinancialsScreen: Gig Accounting data (A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllGigAccountingSummaries).mockImplementation(async (orgId: string) =>
      [summary(orgId === 'o2' ? 'Second org gig' : 'First org gig')] as any);
  });

  it('going back to the tab reads the gigs again and shows them', async () => {
    const org = makeOrganization({ id: 'o1', name: 'One' });
    const { rerender } = render(<FinancialsScreen {...base} organization={org} tab="gig-accounting" />);
    fireEvent.click(await screen.findByRole('button', { name: 'All time' }));
    expect(screen.getByText('First org gig')).toBeInTheDocument();
    rerender(<FinancialsScreen {...base} organization={org} tab="purchases" />);
    expect(screen.getByTestId('purchases')).toBeInTheDocument();
    rerender(<FinancialsScreen {...base} organization={org} tab="gig-accounting" />);
    await waitFor(() => expect(getAllGigAccountingSummaries).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'All time' }));
    expect(await screen.findByText('First org gig')).toBeInTheDocument();
  });

  it('switching organization shows the other organization\'s gigs', async () => {
    const { rerender } = render(<FinancialsScreen {...base} organization={makeOrganization({ id: 'o1', name: 'One' })} tab="gig-accounting" />);
    fireEvent.click(await screen.findByRole('button', { name: 'All time' }));
    expect(screen.getByText('First org gig')).toBeInTheDocument();
    rerender(<FinancialsScreen {...base} organization={makeOrganization({ id: 'o2', name: 'Two' })} tab="gig-accounting" />);
    expect(await screen.findByText('Second org gig')).toBeInTheDocument();
    expect(getAllGigAccountingSummaries).toHaveBeenLastCalledWith('o2');
  });
});

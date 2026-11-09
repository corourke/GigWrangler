import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery as render } from '../../test/renderWithQuery';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import GigAccountingTab from './GigAccountingTab';
import * as gigService from '../../services/gig.service';
import { GigAccountingSummary } from '../../utils/supabase/types';
import { makeOrganization } from '../../test/factories';

vi.mock('../../services/gig.service', () => ({
  getAllGigAccountingSummaries: vi.fn(),
  getGigFinancials: vi.fn().mockResolvedValue([]),
}));

vi.mock('./GigAccountingRowDetail', () => ({
  default: () => <tr><td>Detail</td></tr>,
}));

const makeOrg = (id = 'org-1') => makeOrganization({ id, name: 'Test Org' });

const now = new Date();
const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
const pastDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

const makeSummary = (overrides: Partial<GigAccountingSummary> = {}): GigAccountingSummary => ({
  gigId: 'gig-1',
  gigTitle: 'Test Gig',
  gigStatus: 'Completed',
  gigStart: pastDate,
  gigEnd: pastDate,
  contractAmount: 5000,
  received: 3000,
  outstandingRevenue: 2000,
  dueRevenue: 2000,
  actualCosts: 1000,
  expectedStaffCosts: 500,
  expectedSubContractCosts: 0,
  totalCosts: 1500,
  paymentsToMake: 0,
  paymentsDue: 0,
  profit: 3500,
  margin: 70,
  paymentHealth: 'revenue-outstanding',
  moneyInBadge: { label: 'Payment due', tone: 'attention' },
  ...overrides,
});

// One gig per section, plus a cancelled gig where nothing moved (left out).
const defaultSummaries: GigAccountingSummary[] = [
  makeSummary({
    gigId: 'gig-due',
    gigTitle: 'Played, unpaid',
    gigStatus: 'Completed',
    outstandingRevenue: 2000,
    dueRevenue: 2000,
  }),
  makeSummary({
    gigId: 'gig-invoiced',
    gigTitle: 'Invoiced, not yet due',
    gigStatus: 'Completed',
    outstandingRevenue: 750,
    dueRevenue: 0,
    moneyInBadge: { label: 'Invoiced, due Oct 26', tone: 'pending' },
  }),
  makeSummary({
    gigId: 'gig-upcoming',
    gigTitle: 'Booked ahead',
    gigStatus: 'Booked',
    gigStart: futureDate,
    gigEnd: futureDate,
    outstandingRevenue: 1000,
    dueRevenue: 0,
    moneyInBadge: { label: 'Accepted', tone: 'pending' },
  }),
  makeSummary({
    gigId: 'gig-settled',
    gigTitle: 'All paid',
    gigStatus: 'Settled',
    received: 5000,
    outstandingRevenue: 0,
    dueRevenue: 0,
    paymentHealth: 'all-clear',
    moneyInBadge: { label: 'Paid', tone: 'done' },
  }),
  makeSummary({
    gigId: 'gig-cancelled',
    gigTitle: 'Cancelled, nothing moved',
    gigStatus: 'Cancelled',
    contractAmount: 0,
    received: 0,
    outstandingRevenue: 0,
    dueRevenue: 0,
    actualCosts: 0,
    expectedStaffCosts: 0,
    totalCosts: 0,
    profit: 0,
    moneyInBadge: null,
  }),
];

const renderTab = (onNavigateToGigDetail = vi.fn()) =>
  render(<GigAccountingTab organization={makeOrg()} userRole="Admin" onNavigateToGigDetail={onNavigateToGigDetail} />);

// The default timeframe is this year; tests that don't test timeframes look at all time.
const showAllTime = async () => fireEvent.click(await screen.findByRole('button', { name: 'All time' }));


describe('GigAccountingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows access-denied alert for non-Admin userRole', async () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockResolvedValue([]);
    render(<GigAccountingTab organization={makeOrg()} userRole="Staff" onNavigateToGigDetail={vi.fn()} />);
    expect(screen.getByText('Financial data is restricted to Admins.')).toBeInTheDocument();
  });

  it('shows access-denied alert when userRole is undefined', () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockResolvedValue([]);
    render(<GigAccountingTab organization={makeOrg()} onNavigateToGigDetail={vi.fn()} />);
    expect(screen.getByText('Financial data is restricted to Admins.')).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching', () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockReturnValue(new Promise(() => {}));
    renderTab();
    const skeletons = document.querySelectorAll('[class*="skeleton"], [data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('puts each gig in exactly one section; Settled starts off; nothing-moved cancellations drop out', async () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockResolvedValue(defaultSummaries);
    renderTab();
    await showAllTime();

    expect(screen.getByRole('button', { name: 'Needs attention · 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Upcoming · 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Settled · off' })).toHaveAttribute('aria-pressed', 'false');

    expect(screen.getByText('Played, unpaid')).toBeInTheDocument();
    expect(screen.getByText('Payment due')).toBeInTheDocument();
    expect(screen.getByText('Invoiced, not yet due')).toBeInTheDocument();
    expect(screen.getByText('Booked ahead')).toBeInTheDocument();
    expect(screen.queryByText('All paid')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancelled, nothing moved')).not.toBeInTheDocument();
  });

  it('turns sections on and off', async () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockResolvedValue(defaultSummaries);
    renderTab();
    await showAllTime();

    fireEvent.click(screen.getByRole('button', { name: 'Settled · off' }));
    expect(await screen.findByText('All paid')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Upcoming · 2' }));
    expect(screen.queryByText('Booked ahead')).not.toBeInTheDocument();
    expect(screen.getByText('Played, unpaid')).toBeInTheDocument();
  });

  it('filters by gig date with the timeframe presets', async () => {
    const lastYear = new Date().getFullYear() - 1;
    vi.mocked(gigService.getAllGigAccountingSummaries).mockResolvedValue([
      ...defaultSummaries,
      makeSummary({
        gigId: 'gig-old',
        gigTitle: 'Last year, still unpaid',
        gigStart: `${lastYear}-06-15T19:00:00`,
        gigEnd: `${lastYear}-06-15T23:00:00`,
      }),
    ]);
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Last year' }));
    expect(await screen.findByText('Last year, still unpaid')).toBeInTheDocument();
    expect(screen.queryByText('Played, unpaid')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: `${lastYear}-06-01` } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: `${lastYear}-06-30` } });
    expect(screen.getByText('Last year, still unpaid')).toBeInTheDocument();
  });

  it('summary bar totals the gigs in the sections that are on', async () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockResolvedValue([
      makeSummary({
        gigId: 'gig-1',
        gigTitle: 'Solo Gig',
        contractAmount: 10000,
        received: 6000,
        outstandingRevenue: 4000,
        dueRevenue: 4000,
        totalCosts: 3000,
        paymentsToMake: 500,
        profit: 7000,
      }),
    ]);
    renderTab();
    await showAllTime();
    expect(await screen.findByText('Solo Gig')).toBeInTheDocument();
    expect(screen.getAllByText('$10,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$7,000').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: 'Needs attention · 1' }));
    expect(screen.queryAllByText('$10,000')).toHaveLength(0);
  });

  it("shows nothing owed on a gig that hasn't been completed yet (Cameron, 10-08)", async () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockResolvedValue(defaultSummaries);
    renderTab();
    await showAllTime();
    const row = (await screen.findByText('Booked ahead')).closest('tr')!;
    expect(row).toHaveTextContent('Received $3,000 · Owed $0');
    expect((screen.getByText('Played, unpaid')).closest('tr')!).toHaveTextContent('Received $3,000 · Owed $2,000');
  });

  it('clicking a row calls onNavigateToGigDetail with correct gigId', async () => {
    const onNavigateToGigDetail = vi.fn();
    vi.mocked(gigService.getAllGigAccountingSummaries).mockResolvedValue([
      makeSummary({ gigId: 'gig-nav-test', gigTitle: 'Navigation Test Gig' }),
    ]);
    renderTab(onNavigateToGigDetail);
    await showAllTime();

    fireEvent.click((await screen.findByText('Navigation Test Gig')).closest('tr')!);
    expect(onNavigateToGigDetail).toHaveBeenCalledWith('gig-nav-test');
  });

  it('shows empty state when org has no gigs', async () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('No gigs found.')).toBeInTheDocument();
  });

  it('shows error state when service fails', async () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockRejectedValue(new Error('Network error'));
    renderTab();
    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });
});

// A10 characterization: loading, a failed load, and another organization's gigs.
describe('GigAccountingTab: loading (A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gigService.getAllGigAccountingSummaries).mockReset().mockResolvedValue([]);
  });

  it('shows the skeleton, then the gigs', async () => {
    let resolve!: (v: GigAccountingSummary[]) => void;
    vi.mocked(gigService.getAllGigAccountingSummaries).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    renderTab();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    resolve(defaultSummaries);
    await showAllTime();
    expect(screen.getByText('Played, unpaid')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
    expect(gigService.getAllGigAccountingSummaries).toHaveBeenCalledWith('org-1');
  });

  it('shows why the gigs failed to load, and loads them when opened again', async () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockRejectedValueOnce(new Error('Could not read the gigs'));
    const first = renderTab();
    expect(await screen.findByText('Could not read the gigs')).toBeInTheDocument();
    vi.mocked(gigService.getAllGigAccountingSummaries).mockResolvedValue(defaultSummaries);
    // Opened again (a remount), against the same cache.
    first.rerender(<GigAccountingTab key="again" organization={makeOrg()} userRole="Admin" onNavigateToGigDetail={vi.fn()} />);
    await showAllTime();
    expect(screen.getByText('Played, unpaid')).toBeInTheDocument();
    expect(screen.queryByText('Could not read the gigs')).not.toBeInTheDocument();
  });

  it('switching organization shows that organization\'s gigs', async () => {
    vi.mocked(gigService.getAllGigAccountingSummaries).mockImplementation(async (orgId: string) =>
      orgId === 'org-2' ? [makeSummary({ gigId: 'g2', gigTitle: 'Second org gig' })] : [makeSummary({ gigId: 'g1', gigTitle: 'First org gig' })]);
    const { rerender } = renderTab();
    await showAllTime();
    expect(screen.getByText('First org gig')).toBeInTheDocument();
    rerender(<GigAccountingTab organization={makeOrg('org-2')} userRole="Admin" onNavigateToGigDetail={vi.fn()} />);
    expect(await screen.findByText('Second org gig')).toBeInTheDocument();
    expect(screen.queryByText('First org gig')).not.toBeInTheDocument();
  });
});

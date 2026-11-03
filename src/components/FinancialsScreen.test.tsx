import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import FinancialsScreen from './FinancialsScreen';
import { makeOrganization } from '../test/factories';
import { getBackInHeaderSlot } from '../test/pageFrame';

vi.mock('./AppHeader', () => ({ default: () => null }));
vi.mock('./financials/GigAccountingTab', () => ({ default: () => <div data-testid="gig-accounting" /> }));
vi.mock('./financials/TaxYearsCard', () => ({ default: () => <div data-testid="tax-years" /> }));
vi.mock('./financials/purchases/PurchasesSection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./financials/purchases/PurchasesSection')>();
  return {
    PurchasesActions: actual.PurchasesActions,
    default: ({ view, onViewChange }: any) => (
      <button data-testid="purchases" data-view={view} onClick={() => onViewChange?.('scan')}>purchases</button>
    ),
  };
});
vi.mock('./financials/purchases/useScanQueue', () => ({
  useScanQueue: () => ({ counts: { ready: 2, scanning: 0, queued: 0, failed: 0 } }),
}));

const base = {
  organization: makeOrganization({ id: 'o', name: 'Act4Audio' }),
  user: { id: 'u' } as any,
  userRole: 'Admin' as const,
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
  onNavigateToGigs: vi.fn(),
};

describe('FinancialsScreen tabs follow the URL', () => {
  it('shows the tab the URL names', () => {
    render(<FinancialsScreen {...base} tab="gig-accounting" onNavigate={vi.fn()} />);
    expect(screen.getByTestId('gig-accounting')).toBeInTheDocument();
  });

  it('asks the URL to change instead of switching on its own', () => {
    const onNavigate = vi.fn();
    render(<FinancialsScreen {...base} tab="purchases" purchasesView="report" onNavigate={onNavigate} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Gig Accounting/ }));
    expect(onNavigate).toHaveBeenCalledWith('gig-accounting');
    fireEvent.click(screen.getByTestId('purchases'));
    expect(onNavigate).toHaveBeenCalledWith('purchases', 'scan');
  });

  it('passes the Purchases sub-tab through', () => {
    render(<FinancialsScreen {...base} tab="purchases" purchasesView="manual" onNavigate={vi.fn()} />);
    expect(screen.getByTestId('purchases').dataset.view).toBe('manual');
  });
});

describe('Financials › Purchases: one row of tabs, Add and Scan in the title row (#39)', () => {
  it('puts Scan invoices (with its ready count) and Add purchase in the title row, and no sub-tabs', () => {
    const onNavigate = vi.fn();
    render(<FinancialsScreen {...base} tab="purchases" purchasesView="report" onNavigate={onNavigate} />);
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    const row = screen.getByTestId('page-header-title-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Scan invoices, 2 to review' }));
    expect(onNavigate).toHaveBeenCalledWith('purchases', 'scan');
    fireEvent.click(within(row).getByRole('button', { name: 'Add purchase' }));
    expect(onNavigate).toHaveBeenCalledWith('purchases', 'manual');
  });

  it.each([
    ['manual', 'Add purchase'],
    ['scan', 'Scan invoices'],
  ] as const)('%s opens its own screen, titled "%s", with Back to Purchases in the slot', (view, title) => {
    const onNavigate = vi.fn();
    render(<FinancialsScreen {...base} tab="purchases" purchasesView={view} onNavigate={onNavigate} />);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    fireEvent.click(getBackInHeaderSlot('Back to Purchases'));
    expect(onNavigate).toHaveBeenCalledWith('purchases', 'report');
  });

  it('keeps Back to Gig in the slot on the report when opened from a gig', () => {
    const onNavigateToGigDetail = vi.fn();
    render(
      <FinancialsScreen {...base} tab="purchases" purchasesView="report" onNavigate={vi.fn()} returnGigId="g1" onNavigateToGigDetail={onNavigateToGigDetail} />,
    );
    fireEvent.click(getBackInHeaderSlot('Back to Gig'));
    expect(onNavigateToGigDetail).toHaveBeenCalledWith('g1');
  });
});

describe('Filed tax years (Cameron, 11-03)', () => {
  it('is not added under the Reporting tab as a whole: the Schedule C report shows it', () => {
    render(<FinancialsScreen {...base} tab="reporting" onNavigate={vi.fn()} />);
    expect(screen.queryByTestId('tax-years')).not.toBeInTheDocument();
  });
});

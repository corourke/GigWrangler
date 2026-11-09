import { renderWithQuery as render } from '../../test/renderWithQuery';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import MobileGigFinancials from './MobileGigFinancials';
import * as gigService from '../../services/gig.service';

vi.mock('../../services/gig.service', () => ({
  getGigFinancials: vi.fn(),
  getGigProfitabilitySummary: vi.fn(),
}));

// Mock QuickActionButtons to simplify testing
vi.mock('../gig/QuickActionButtons', () => ({
  default: ({ onSuccess, financials }: any) => (
    <div data-testid="quick-actions" data-financials={(financials ?? []).map((f: any) => f.id).join(',')}>
      <button onClick={onSuccess}>Add Mock Record</button>
    </div>
  ),
}));

describe('MobileGigFinancials', () => {
  const defaultProps = {
    gigId: 'test-gig-id',
    organizationId: 'test-org-id',
    userRole: 'Admin' as const,
    isEditing: false,
    gigStartDate: '2026-01-01',
  };

  const mockFinancials = [
    {
      id: 'fin-1',
      date: '2026-01-01',
      amount: 100,
      amount_settled: null,
      direction: 'in',
      stage: 'contracted',
      description: 'Test Agreement',
    },
  ];

  const mockSummary = {
    expectedIn: 1000,
    receivedIn: 100,
    totalCosts: 50,
    profit: 950,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Resolve after a delay, like a real request: the transactions button is
    // disabled until the data arrives, so tests must wait for it, not just for
    // the static tile labels (this raced on slow CI runners).
    (gigService.getGigFinancials as any).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockFinancials), 50)),
    );
    (gigService.getGigProfitabilitySummary as any).mockResolvedValue(mockSummary);
  });

  // Click "View 1 Transaction" once loading has finished and it's enabled.
  const openTransactions = async () => {
    const button = await screen.findByRole('button', { name: /View 1 Transaction/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
  };

  it('renders nothing if user is not Admin or Manager', () => {
    render(<MobileGigFinancials {...defaultProps} userRole="Staff" />);
    expect(screen.queryByText('Contract')).not.toBeInTheDocument();
  });

  it('renders summary tiles for Admin', async () => {
    render(<MobileGigFinancials {...defaultProps} />);
    
    await waitFor(() => {
      expect(screen.getByText('Revenue')).toBeInTheDocument();
      expect(screen.getByText('$1,000.00')).toBeInTheDocument();
      expect(screen.getByText('Costs')).toBeInTheDocument();
      expect(screen.getByText('$50.00')).toBeInTheDocument();
      expect(screen.getByText('Profit')).toBeInTheDocument();
      expect(screen.getByText('$950.00')).toBeInTheDocument();
    });
  });

  it('renders summary tiles for Manager', async () => {
    render(<MobileGigFinancials {...defaultProps} userRole="Manager" />);
    
    await waitFor(() => {
      expect(screen.getByText('Revenue')).toBeInTheDocument();
    });
  });

  it('shows quick action buttons only when isEditing is true', async () => {
    const { rerender } = render(<MobileGigFinancials {...defaultProps} isEditing={false} />);
    expect(screen.queryByTestId('quick-actions')).not.toBeInTheDocument();

    rerender(<MobileGigFinancials {...defaultProps} isEditing={true} />);
    expect(screen.getByTestId('quick-actions')).toBeInTheDocument();
  });

  it("gives the quick actions the gig's rows, so Payment received can pay off a booking", async () => {
    render(<MobileGigFinancials {...defaultProps} isEditing={true} />);
    await waitFor(() => {
      expect(screen.getByTestId('quick-actions')).toHaveAttribute('data-financials', 'fin-1');
    });
  });

  it('names and stages rows the way the desktop Financials tab does', async () => {
    (gigService.getGigFinancials as any).mockResolvedValue([
      { id: 'fin-b', date: '2026-01-06', amount: 250, amount_settled: null, direction: 'in', stage: 'accepted', description: null, due_date: null },
      { id: 'fin-p', date: '2026-10-09', amount: 100, amount_settled: 100, direction: 'in', stage: 'paid', description: '', paid_at: '2026-10-11T00:00:00+00:00' },
      { id: 'fin-e', date: '2026-10-09', amount: 20, amount_settled: null, direction: 'out', stage: 'invoiced', description: null },
    ]);
    render(<MobileGigFinancials {...defaultProps} gigEnd="2026-10-10T06:00:00Z" />);
    const button = await screen.findByRole('button', { name: /View 3 Transactions/ });
    fireEvent.click(button);

    expect(await screen.findByText(/Accepted, payment due/)).toBeInTheDocument();
    expect(screen.getAllByText('Booking')).toHaveLength(2);
    expect(screen.getByText('Expense')).toBeInTheDocument();
    expect(screen.getByText(/Paid Oct 11/)).toBeInTheDocument();
    expect(screen.queryByText('Money in')).not.toBeInTheDocument();
  });

  it('opens transactions modal when tiles are clicked', async () => {
    render(<MobileGigFinancials {...defaultProps} />);
    
    await openTransactions();

    expect(await screen.findByText(/Transactions \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Test Agreement')).toBeInTheDocument();
  });

  it('shows transaction detail when a transaction is clicked', async () => {
    render(<MobileGigFinancials {...defaultProps} />);

    await openTransactions();

    expect(await screen.findByText('Test Agreement')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Test Agreement'));

    await waitFor(() => {
      expect(screen.getByText('Transaction Detail')).toBeInTheDocument();
      expect(screen.getByText('Money in')).toBeInTheDocument();
      expect(screen.getByText('Contracted')).toBeInTheDocument();
    });
  });
});

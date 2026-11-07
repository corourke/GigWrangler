import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import QuickActionButtons from './QuickActionButtons';
import * as gigService from '../../services/gig.service';
import * as attachmentService from '../../services/attachment.service';

vi.mock('../../services/gig.service', () => ({
  createGigFinancial: vi.fn(),
  recordGigFinancialPayment: vi.fn(),
}));

vi.mock('../../services/attachment.service', () => ({
  uploadAttachment: vi.fn(),
  linkAttachmentToEntity: vi.fn(),
}));

describe('QuickActionButtons', () => {
  const defaultProps = {
    gigId: 'test-gig-id',
    organizationId: 'test-org-id',
    onSuccess: vi.fn(),
    onOther: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all action buttons', () => {
    render(<QuickActionButtons {...defaultProps} />);
    expect(screen.getByText('Booking')).toBeInTheDocument();
    expect(screen.getByText('Payment received')).toBeInTheDocument();
    expect(screen.getByText('Expense / Mileage')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('records a fee as money in at the chosen stage', async () => {
    vi.mocked(gigService.createGigFinancial).mockResolvedValue({ id: 'fin-new' } as any);
    render(<QuickActionButtons {...defaultProps} gigStartDate="2026-10-03" />);
    fireEvent.click(screen.getByText('Booking'));
    expect(screen.getByText('Add a booking')).toBeInTheDocument();
    // a verbal / informal agreement is the default stage
    expect(screen.getAllByText('Accepted (incl. verbal / informal)').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('Save Booking'));

    await waitFor(() => {
      expect(gigService.createGigFinancial).toHaveBeenCalledWith(expect.objectContaining({
        direction: 'in',
        stage: 'accepted',
        amount: 1000,
        date: '2026-10-03',
        description: 'Income',
        due_date: null,
      }));
    });
  });

  it('records a payment received as paid money in', async () => {
    vi.mocked(gigService.createGigFinancial).mockResolvedValue({ id: 'fin-new' } as any);
    render(<QuickActionButtons {...defaultProps} gigStartDate="2026-10-03" />);
    fireEvent.click(screen.getByText('Payment received'));
    expect(screen.getByText('Date received')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '450' } });
    fireEvent.click(screen.getByText('Save Payment'));

    await waitFor(() => {
      expect(gigService.createGigFinancial).toHaveBeenCalledWith(expect.objectContaining({
        direction: 'in',
        stage: 'paid',
        amount: 450,
        amount_settled: 450,
        paid_at: '2026-10-03',
      }));
    });
  });

  describe('Payment received on a gig with an open booking', () => {
    const booking = {
      id: 'fin-booking', gig_id: 'test-gig-id', organization_id: 'test-org-id',
      direction: 'in', stage: 'accepted', amount: 250, amount_settled: null,
      date: '2026-10-09', due_date: null, description: null, currency: 'USD',
    } as any;
    const paidMileage = {
      id: 'fin-miles', direction: 'out', stage: 'paid', amount: 31.92, amount_settled: 31.92, date: '2026-10-09',
    } as any;

    it('pays off the booking instead of adding a second paid row', async () => {
      vi.mocked(gigService.recordGigFinancialPayment).mockResolvedValue({ paid: booking, remainder: null } as any);
      render(<QuickActionButtons {...defaultProps} gigStartDate="2026-10-09" financials={[booking, paidMileage]} />);
      fireEvent.click(screen.getByText('Payment received'));
      // the open booking is chosen, and its amount filled in
      expect(screen.getByLabelText('Apply to')).toHaveTextContent('Booking · Accepted · $250.00');
      expect(screen.getByLabelText('Amount')).toHaveValue('250');
      fireEvent.click(screen.getByText('Save Payment'));

      await waitFor(() => {
        expect(gigService.recordGigFinancialPayment).toHaveBeenCalledWith(booking, expect.objectContaining({
          amount: 250,
          paid_at: '2026-10-09',
          remainder: 'split',
        }));
      });
      expect(gigService.createGigFinancial).not.toHaveBeenCalled();
      expect(defaultProps.onSuccess).toHaveBeenCalled();
    });

    it('asks what the rest is when less than the booking arrives', async () => {
      vi.mocked(gigService.recordGigFinancialPayment).mockResolvedValue({ paid: booking, remainder: null } as any);
      render(<QuickActionButtons {...defaultProps} gigStartDate="2026-10-09" financials={[booking]} />);
      fireEvent.click(screen.getByText('Payment received'));
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '200' } });
      fireEvent.click(screen.getByLabelText(/Not coming: settle for \$200\.00/));
      fireEvent.click(screen.getByText('Save Payment'));

      await waitFor(() => {
        expect(gigService.recordGigFinancialPayment).toHaveBeenCalledWith(booking, expect.objectContaining({
          amount: 200,
          remainder: 'settle',
        }));
      });
    });

    it('can still record a separate payment', async () => {
      vi.mocked(gigService.createGigFinancial).mockResolvedValue({ id: 'fin-new' } as any);
      render(<QuickActionButtons {...defaultProps} gigStartDate="2026-10-09" financials={[booking]} />);
      fireEvent.click(screen.getByText('Payment received'));
      fireEvent.click(screen.getByLabelText('Apply to'));
      fireEvent.click(await screen.findByRole('option', { name: 'Separate payment (no booking)' }));
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '40' } });
      fireEvent.click(screen.getByText('Save Payment'));

      await waitFor(() => {
        expect(gigService.createGigFinancial).toHaveBeenCalledWith(expect.objectContaining({
          direction: 'in', stage: 'paid', amount: 40, amount_settled: 40,
        }));
      });
      expect(gigService.recordGigFinancialPayment).not.toHaveBeenCalled();
    });

    it('offers no booking when the booking is already paid', () => {
      render(<QuickActionButtons {...defaultProps} financials={[{ ...booking, stage: 'paid', amount_settled: 250 }]} />);
      fireEvent.click(screen.getByText('Payment received'));
      expect(screen.queryByLabelText('Apply to')).not.toBeInTheDocument();
    });
  });

  it('opens expense/mileage choice modal when Expense / Mileage is clicked', async () => {
    render(<QuickActionButtons {...defaultProps} />);
    fireEvent.click(screen.getByText('Expense / Mileage'));
    expect(screen.getByText('Expense or Mileage?')).toBeInTheDocument();
  });

  it('calls onOther when Other is clicked', () => {
    render(<QuickActionButtons {...defaultProps} />);
    fireEvent.click(screen.getByText('Other'));
    expect(defaultProps.onOther).toHaveBeenCalled();
  });

  async function openMileage(gigStartDate: string) {
    render(<QuickActionButtons {...defaultProps} gigStartDate={gigStartDate} />);
    fireEvent.click(screen.getByText('Expense / Mileage'));
    await waitFor(() => {
      expect(screen.getByText('Mileage', { selector: 'div.font-semibold' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Mileage', { selector: 'div.font-semibold' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Miles Driven/)).toBeInTheDocument();
    });
  }

  it.each([
    ['2026-06-30', 72.5, '$0.725', '100 miles @ $0.725/mile'],
    ['2026-07-01', 76, '$0.76', '100 miles @ $0.76/mile'],
  ])('prices mileage on %s by the rate for that date', async (date, amount, shownRate, notes) => {
    vi.mocked(gigService.createGigFinancial).mockResolvedValue({ id: 'fin-new' } as any);
    await openMileage(date);
    fireEvent.change(screen.getByLabelText(/Miles Driven/), { target: { value: '100' } });
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === `@ ${shownRate}/mi = $${amount.toFixed(2)}`)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save Mileage'));

    await waitFor(() => {
      expect(gigService.createGigFinancial).toHaveBeenCalledWith(expect.objectContaining({
        mileage: 100,
        amount,
        date,
        notes,
      }));
    });
  });

  it('updates the shown rate when the travel date changes', async () => {
    await openMileage('2026-07-01');
    fireEvent.change(screen.getByLabelText(/Miles Driven/), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Date of Travel'), { target: { value: '2026-06-30' } });
    await waitFor(() => {
      expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '@ $0.725/mi = $72.50')).toBeInTheDocument();
    });
  });

  it('calculates mileage correctly from distance', async () => {
    render(<QuickActionButtons {...defaultProps} gigStartDate="2025-03-01" />);
    
    // Open choice modal
    fireEvent.click(screen.getByText('Expense / Mileage'));
    
    // Click Mileage
    await waitFor(() => {
      expect(screen.getByText('Mileage', { selector: 'div.font-semibold' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Mileage', { selector: 'div.font-semibold' }));
    
    // Fill form
    await waitFor(() => {
      expect(screen.getByLabelText(/Miles Driven/)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/Miles Driven/), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Test travel' } });
    
    // Submit
    fireEvent.click(screen.getByText('Save Mileage'));
    
    await waitFor(() => {
      expect(gigService.createGigFinancial).toHaveBeenCalledWith(expect.objectContaining({
        mileage: 100,
        amount: 70, // 100 * 0.70 (2025 rate)
        direction: 'out',
        stage: 'paid',
        category: 'Car and truck expenses'
      }));
    });
  });

  it('uses the mileage rate for the entered calendar year, not a day earlier in timezones behind UTC', async () => {
    // Regression test for #25: the mileage rate year was computed with
    // `new Date(dateOnlyString).getFullYear()`, which parses the date as
    // UTC midnight. West of UTC that rolls the date (and year, at a
    // year boundary) back by one day, picking the wrong IRS rate.
    const originalTZ = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      render(<QuickActionButtons {...defaultProps} gigStartDate="2025-01-01" />);

      fireEvent.click(screen.getByText('Expense / Mileage'));

      await waitFor(() => {
        expect(screen.getByText('Mileage', { selector: 'div.font-semibold' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Mileage', { selector: 'div.font-semibold' }));

      await waitFor(() => {
        expect(screen.getByLabelText(/Miles Driven/)).toBeInTheDocument();
      });
      fireEvent.change(screen.getByLabelText(/Miles Driven/), { target: { value: '100' } });
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Test travel' } });

      fireEvent.click(screen.getByText('Save Mileage'));

      await waitFor(() => {
        expect(gigService.createGigFinancial).toHaveBeenCalledWith(expect.objectContaining({
          mileage: 100,
          amount: 70, // 2025 rate (0.70/mi). The pre-fix bug computed year 2024 (0.67/mi -> 67).
        }));
      });
    } finally {
      process.env.TZ = originalTZ;
    }
  });

  it('calculates mileage correctly from odometer readings', async () => {
    render(<QuickActionButtons {...defaultProps} gigStartDate="2025-03-01" />);
    
    fireEvent.click(screen.getByText('Expense / Mileage'));
    
    await waitFor(() => {
      expect(screen.getByText('Mileage', { selector: 'div.font-semibold' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Mileage', { selector: 'div.font-semibold' }));
    
    await waitFor(() => {
      expect(screen.getByLabelText('Start')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '1050' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Test travel' } });
    
    fireEvent.click(screen.getByText('Save Mileage'));
    
    await waitFor(() => {
      expect(gigService.createGigFinancial).toHaveBeenCalledWith(expect.objectContaining({
        mileage: 50,
        amount: 35, // 50 * 0.70 (2025 rate)
      }));
    });
  });

  async function openSimpleExpense() {
    fireEvent.click(screen.getByText('Expense / Mileage'));
    fireEvent.click(await screen.findByText('Simple Expense'));
    await screen.findByText('Record Simple Expense');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Van rental' } });
  }

  it('records a simple expense as paid when "Already paid" is toggled on', async () => {
    vi.mocked(gigService.createGigFinancial).mockResolvedValue({ id: 'fin-new' } as any);
    render(<QuickActionButtons {...defaultProps} />);

    await openSimpleExpense();
    fireEvent.click(screen.getByLabelText('Already paid'));
    fireEvent.click(screen.getByText('Save Expense'));

    await waitFor(() => {
      expect(gigService.createGigFinancial).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'out', stage: 'paid', amount: 40, paid_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      );
    });
    expect(attachmentService.uploadAttachment).not.toHaveBeenCalled();
  });

  it('records an unpaid expense as owed when "Already paid" is off', async () => {
    vi.mocked(gigService.createGigFinancial).mockResolvedValue({ id: 'fin-new' } as any);
    render(<QuickActionButtons {...defaultProps} />);

    await openSimpleExpense();
    fireEvent.click(screen.getByText('Save Expense'));

    await waitFor(() => {
      expect(gigService.createGigFinancial).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'out', stage: 'invoiced', amount: 40, paid_at: undefined }),
      );
    });
  });

  it('uploads and links the receipt to the new expense row', async () => {
    vi.mocked(gigService.createGigFinancial).mockResolvedValue({ id: 'fin-new' } as any);
    vi.mocked(attachmentService.uploadAttachment).mockResolvedValue({ id: 'att-1' } as any);
    render(<QuickActionButtons {...defaultProps} />);

    await openSimpleExpense();
    const file = new File(['x'], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Receipt (optional)'), { target: { files: [file] } });
    fireEvent.click(screen.getByText('Save Expense'));

    await waitFor(() => {
      expect(attachmentService.uploadAttachment).toHaveBeenCalledWith('test-org-id', file);
    });
    expect(attachmentService.linkAttachmentToEntity).toHaveBeenCalledWith('att-1', 'gig_financial', 'fin-new');
  });
});

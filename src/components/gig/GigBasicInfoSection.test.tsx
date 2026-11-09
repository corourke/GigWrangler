import { renderWithQuery as render } from '../../test/renderWithQuery';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GigBasicInfoSection from './GigBasicInfoSection';
import * as gigService from '../../services/gig.service';

vi.mock('../../services/gig.service');

describe('GigBasicInfoSection', () => {
  const mockGigId = 'gig-123';
  const mockGigData = {
    id: mockGigId,
    title: 'Test Gig',
    start: '2024-01-15T10:00:00Z',
    end: '2024-01-15T18:00:00Z',
    timezone: 'America/Los_Angeles',
    status: 'Booked',
    tags: ['Concert', 'Live Music'],
    notes: 'Test notes',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gigService.getGig).mockResolvedValue(mockGigData as any);
    vi.mocked(gigService.updateGig).mockResolvedValue(mockGigData as any);
  });

  it('renders loading state initially', () => {
    render(<GigBasicInfoSection gigId={mockGigId} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('loads and displays gig data', async () => {
    render(<GigBasicInfoSection gigId={mockGigId} />);

    await waitFor(() => {
      expect(gigService.getGig).toHaveBeenCalledWith(mockGigId);
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Gig')).toBeInTheDocument();
    });
  });

  it('renders all form fields', async () => {
    render(<GigBasicInfoSection gigId={mockGigId} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Gig')).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText('Enter gig title')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Add notes about this gig/i)).toBeInTheDocument();
  });

  it('shows validation error for empty title', async () => {
    const user = userEvent.setup();
    render(<GigBasicInfoSection gigId={mockGigId} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Gig')).toBeInTheDocument();
    });

    const titleInput = screen.getByPlaceholderText('Enter gig title');
    await user.clear(titleInput);
    
    await waitFor(() => {
      expect(screen.getByText(/Title is required/i)).toBeInTheDocument();
    });

    expect(gigService.updateGig).not.toHaveBeenCalled();
  });

  it('calls updateGig on form change', async () => {
    const user = userEvent.setup();
    render(<GigBasicInfoSection gigId={mockGigId} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Gig')).toBeInTheDocument();
    });

    const titleInput = screen.getByPlaceholderText('Enter gig title');
    await user.type(titleInput, ' Updated');

    await waitFor(() => {
      expect(gigService.updateGig).toHaveBeenCalledWith(
        mockGigId,
        expect.objectContaining({
          title: 'Test Gig Updated',
        })
      );
    }, { timeout: 5000 });
  });

  it('shows All day checkbox', async () => {
    render(<GigBasicInfoSection gigId={mockGigId} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Gig')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('All day')).toBeInTheDocument();
  });

  it('detects all-day gigs from noon UTC sentinel', async () => {
    vi.mocked(gigService.getGig).mockResolvedValue({
      ...mockGigData,
      start: '2024-01-15T12:00:00.000Z',
      end: '2024-01-15T12:00:00.000Z',
    } as any);

    render(<GigBasicInfoSection gigId={mockGigId} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Gig')).toBeInTheDocument();
    });

    const checkbox = screen.getByLabelText('All day') as HTMLButtonElement;
    expect(checkbox.getAttribute('data-state')).toBe('checked');
  });

  describe('create mode', () => {
    it('commits uncommitted tag text on submit instead of discarding it (#23)', async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const { container } = render(<GigBasicInfoSection onCreate={onCreate} />);

      await user.type(screen.getByPlaceholderText('Enter gig title'), 'My Gig');
      // All-day avoids also having to fill in hour/minute selects.
      await user.click(screen.getByLabelText('All day'));
      fireEvent.change(screen.getByLabelText(/Start Date/i), {
        target: { value: '2024-06-01' },
      });

      // Type tag text but never press Enter/Tab to commit it.
      await user.type(
        screen.getByPlaceholderText('Add tags to categorize this gig...'),
        'festival, main-stage'
      );

      const form = container.querySelector('#gig-basic-info-form') as HTMLFormElement;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalled();
      });
      expect(onCreate.mock.calls[0][0]).toEqual(
        expect.objectContaining({ tags: ['festival', 'main-stage'] })
      );
    });
  });
});

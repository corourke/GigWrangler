import { renderWithQuery as render } from '../../test/renderWithQuery';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/inventoryManagement.service', () => ({
  getLocationSuggestions: vi.fn(),
}));

vi.mock('../ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { getLocationSuggestions } from '../../services/inventoryManagement.service';
import { LocationCombobox } from './LocationCombobox';

describe('LocationCombobox', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getLocationSuggestions as any).mockResolvedValue(['Staging Area', 'Truck', 'Venue Area', 'Warehouse']);
  });

  it('renders the input with the provided value', () => {
    render(
      <LocationCombobox
        value="Truck"
        onChange={mockOnChange}
        organizationId="org-1"
      />
    );

    expect(screen.getByRole('textbox')).toHaveValue('Truck');
  });

  it('calls onChange with typed value on free-text entry', async () => {
    const user = userEvent.setup();
    render(
      <LocationCombobox
        value=""
        onChange={mockOnChange}
        organizationId="org-1"
      />
    );

    const input = screen.getByRole('textbox');
    await user.type(input, 'Custom');

    expect(mockOnChange).toHaveBeenCalledWith('C');
    expect(mockOnChange).toHaveBeenCalledTimes(6);
  });

  it('fetches suggestions when the input is focused', async () => {
    const user = userEvent.setup();
    render(
      <LocationCombobox
        value=""
        onChange={mockOnChange}
        organizationId="org-1"
      />
    );

    const input = screen.getByRole('textbox');
    await user.click(input);

    await waitFor(() => {
      expect(getLocationSuggestions).toHaveBeenCalledWith('org-1');
    });
  });

  it('renders suggestion items after opening', async () => {
    const user = userEvent.setup();
    render(
      <LocationCombobox
        value=""
        onChange={mockOnChange}
        organizationId="org-1"
      />
    );

    const input = screen.getByRole('textbox');
    await user.click(input);

    await waitFor(() => {
      expect(screen.getByText('Staging Area')).toBeInTheDocument();
      expect(screen.getByText('Truck')).toBeInTheDocument();
      expect(screen.getByText('Venue Area')).toBeInTheDocument();
      expect(screen.getByText('Warehouse')).toBeInTheDocument();
    });
  });

  it('calls onChange with suggestion value when a suggestion is selected', async () => {
    const user = userEvent.setup();
    render(
      <LocationCombobox
        value=""
        onChange={mockOnChange}
        organizationId="org-1"
      />
    );

    const input = screen.getByRole('textbox');
    await user.click(input);

    await waitFor(() => {
      expect(screen.getByText('Truck')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Truck'));

    expect(mockOnChange).toHaveBeenCalledWith('Truck');
  });

  it('does not fetch suggestions more than once on repeated opens', async () => {
    const user = userEvent.setup();
    render(
      <LocationCombobox
        value=""
        onChange={mockOnChange}
        organizationId="org-1"
      />
    );

    const input = screen.getByRole('textbox');
    await user.click(input);

    await waitFor(() => {
      expect(getLocationSuggestions).toHaveBeenCalledTimes(1);
    });

    await user.click(input);
    await user.click(input);

    await waitFor(() => {
      expect(getLocationSuggestions).toHaveBeenCalledTimes(1);
    });
  });

  it('uses the provided placeholder', () => {
    render(
      <LocationCombobox
        value=""
        onChange={mockOnChange}
        organizationId="org-1"
        placeholder="Choose a spot"
      />
    );

    expect(screen.getByPlaceholderText('Choose a spot')).toBeInTheDocument();
  });
});

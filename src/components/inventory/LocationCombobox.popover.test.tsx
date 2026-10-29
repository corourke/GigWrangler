import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The real Popover, unlike LocationCombobox.test.tsx: opening and closing is what's tested (#327).
vi.mock('../../services/inventoryManagement.service', () => ({
  getLocationSuggestions: vi.fn(),
}));

import { getLocationSuggestions } from '../../services/inventoryManagement.service';
import { LocationCombobox } from './LocationCombobox';

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <button type="button">Elsewhere</button>
      <LocationCombobox value={value} onChange={setValue} organizationId="org-1" />
    </>
  );
}

const option = (name: string) => screen.queryByRole('option', { name });

describe('LocationCombobox — opening and closing (#327)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLocationSuggestions).mockResolvedValue(['Truck', 'Warehouse']);
  });

  it('clicking the box shows the suggestions', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('textbox'));
    await waitFor(() => expect(option('Truck')).toBeInTheDocument());
    expect(option('Warehouse')).toBeInTheDocument();
  });

  it('a second click leaves them showing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('textbox'));
    await waitFor(() => expect(option('Truck')).toBeInTheDocument());
    await user.click(screen.getByRole('textbox'));
    expect(option('Truck')).toBeInTheDocument();
  });

  it('tabbing into the box shows them too', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('Elsewhere'));
    await user.tab();
    await waitFor(() => expect(option('Truck')).toBeInTheDocument());
  });

  it('typing filters them', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'war');
    await waitFor(() => expect(option('Warehouse')).toBeInTheDocument());
    expect(option('Truck')).not.toBeInTheDocument();
  });

  it('picking one fills the box and closes the list', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('textbox'));
    await waitFor(() => expect(option('Truck')).toBeInTheDocument());
    await user.click(option('Truck')!);
    expect(screen.getByRole('textbox')).toHaveValue('Truck');
    await waitFor(() => expect(option('Warehouse')).not.toBeInTheDocument());
  });

  it('Escape closes the list', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('textbox'));
    await waitFor(() => expect(option('Truck')).toBeInTheDocument());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(option('Truck')).not.toBeInTheDocument());
  });

  it('clicking elsewhere closes the list', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('textbox'));
    await waitFor(() => expect(option('Truck')).toBeInTheDocument());
    await user.click(screen.getByText('Elsewhere'));
    await waitFor(() => expect(option('Truck')).not.toBeInTheDocument());
  });
});

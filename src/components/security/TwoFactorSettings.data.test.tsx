/** Characterization tests (A10): two-factor status load and its failure. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery as render } from '../../test/renderWithQuery';
import TwoFactorSettings from './TwoFactorSettings';

const getTwoFactorStatus = vi.fn();
vi.mock('../../services/twoFactor.service', () => ({
  getTwoFactorStatus: () => getTwoFactorStatus(),
  startTwoFactorSetup: vi.fn(),
  confirmTwoFactorSetup: vi.fn(),
  removeTwoFactor: vi.fn(),
}));


beforeEach(() => vi.clearAllMocks());

describe('TwoFactorSettings: loading', () => {
  it('shows a spinner, then the status', async () => {
    getTwoFactorStatus.mockResolvedValue({ factors: [{ id: 'f1', friendly_name: 'Phone' }], needsCode: false, signedInWithGoogle: false });
    const { container } = render(<TwoFactorSettings />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(await screen.findByText(/two-factor sign-in is on \(Phone\)/i)).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });

  it('says it could not load, without a spinner', async () => {
    getTwoFactorStatus.mockRejectedValue(new Error('offline'));
    const { container } = render(<TwoFactorSettings />);
    expect(await screen.findByText('Could not load your two-factor settings')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set up two-factor/i })).not.toBeInTheDocument();
  });
});

/** Characterization tests (A10): two-factor status load and its failure. */
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TwoFactorSettings from './TwoFactorSettings';

const getTwoFactorStatus = vi.fn();
vi.mock('../../services/twoFactor.service', () => ({
  getTwoFactorStatus: () => getTwoFactorStatus(),
  startTwoFactorSetup: vi.fn(),
  confirmTwoFactorSetup: vi.fn(),
  removeTwoFactor: vi.fn(),
}));

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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

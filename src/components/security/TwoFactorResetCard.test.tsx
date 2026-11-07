import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TwoFactorResetCard from './TwoFactorResetCard';

const resetTwoFactorForAccount = vi.fn();
vi.mock('../../services/twoFactor.service', () => ({ resetTwoFactorForAccount: (...a: unknown[]) => resetTwoFactorForAccount(...a) }));
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe('TwoFactorResetCard', () => {
  it('resets an account by email after confirming, and says so', async () => {
    resetTwoFactorForAccount.mockResolvedValue(undefined);
    render(<TwoFactorResetCard />);
    fireEvent.change(screen.getByLabelText(/account email/i), { target: { value: 'pat@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /reset two-factor sign-in/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, reset/i }));
    await waitFor(() => expect(resetTwoFactorForAccount).toHaveBeenCalledWith('pat@example.com'));
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/pat@example.com/));
  });

  it('shows why it failed', async () => {
    resetTwoFactorForAccount.mockRejectedValue(new Error('No account with that email'));
    render(<TwoFactorResetCard />);
    fireEvent.change(screen.getByLabelText(/account email/i), { target: { value: 'nobody@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /reset two-factor sign-in/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, reset/i }));
    expect(await screen.findByText('No account with that email')).toBeInTheDocument();
  });
});

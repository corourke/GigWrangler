import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TwoFactorChallengeScreen from './TwoFactorChallengeScreen';

const verifyTwoFactorCode = vi.fn();
vi.mock('../../services/twoFactor.service', () => ({ verifyTwoFactorCode: (...a: unknown[]) => verifyTwoFactorCode(...a) }));

beforeEach(() => vi.clearAllMocks());

describe('TwoFactorChallengeScreen', () => {
  it('asks for the code and continues once it is right', async () => {
    verifyTwoFactorCode.mockResolvedValue(undefined);
    const onVerified = vi.fn();
    render(<TwoFactorChallengeScreen onVerified={onVerified} onSignOut={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(verifyTwoFactorCode).toHaveBeenCalledWith('123456');
  });

  it('shows the problem and stays when the code is wrong', async () => {
    verifyTwoFactorCode.mockRejectedValue(new Error("That code didn't work."));
    const onVerified = vi.fn();
    render(<TwoFactorChallengeScreen onVerified={onVerified} onSignOut={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    expect(await screen.findByText("That code didn't work.")).toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('lets you sign out instead', () => {
    const onSignOut = vi.fn();
    render(<TwoFactorChallengeScreen onVerified={vi.fn()} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TwoFactorSettings from './TwoFactorSettings';

const svc = {
  getTwoFactorStatus: vi.fn(),
  startTwoFactorSetup: vi.fn(),
  confirmTwoFactorSetup: vi.fn(),
  removeTwoFactor: vi.fn(),
};
vi.mock('../../services/twoFactor.service', () => ({
  getTwoFactorStatus: (...a: unknown[]) => svc.getTwoFactorStatus(...a),
  startTwoFactorSetup: (...a: unknown[]) => svc.startTwoFactorSetup(...a),
  confirmTwoFactorSetup: (...a: unknown[]) => svc.confirmTwoFactorSetup(...a),
  removeTwoFactor: (...a: unknown[]) => svc.removeTwoFactor(...a),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe('TwoFactorSettings', () => {
  it('sets up an authenticator: QR code, key, then a code to confirm', async () => {
    svc.getTwoFactorStatus.mockResolvedValueOnce({ factors: [], needsCode: false, signedInWithGoogle: false })
      .mockResolvedValueOnce({ factors: [{ id: 'f2', friendly_name: 'Authenticator app' }], needsCode: false, signedInWithGoogle: false });
    svc.startTwoFactorSetup.mockResolvedValue({ factorId: 'f2', qrCode: 'data:image/svg+xml;utf8,<svg/>', secret: 'ABCDEF' });
    svc.confirmTwoFactorSetup.mockResolvedValue(undefined);
    render(<TwoFactorSettings />);

    fireEvent.click(await screen.findByRole('button', { name: /set up two-factor sign-in/i }));
    expect(await screen.findByAltText(/qr code/i)).toHaveAttribute('src', 'data:image/svg+xml;utf8,<svg/>');
    expect(screen.getByText('ABCDEF')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(svc.confirmTwoFactorSetup).toHaveBeenCalledWith('f2', '123456'));
    expect(await screen.findByText(/two-factor sign-in is on/i)).toBeInTheDocument();
  });

  it('removes it', async () => {
    svc.getTwoFactorStatus.mockResolvedValueOnce({ factors: [{ id: 'f1', friendly_name: 'Phone' }], needsCode: false, signedInWithGoogle: false })
      .mockResolvedValueOnce({ factors: [], needsCode: false, signedInWithGoogle: false });
    svc.removeTwoFactor.mockResolvedValue(undefined);
    render(<TwoFactorSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /turn off/i }));
    await waitFor(() => expect(svc.removeTwoFactor).toHaveBeenCalledWith('f1'));
    expect(await screen.findByRole('button', { name: /set up two-factor sign-in/i })).toBeInTheDocument();
  });
});

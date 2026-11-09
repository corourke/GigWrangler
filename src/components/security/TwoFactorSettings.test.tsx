import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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


// Screens read through react-query (A10), so each render gets its own QueryClient.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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

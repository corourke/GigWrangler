import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const replaceTemporaryPassword = vi.fn();
vi.mock('../services/user.service', () => ({ replaceTemporaryPassword: (pw: string) => replaceTemporaryPassword(pw) }));

import TemporaryPasswordScreen from './TemporaryPasswordScreen';

// An account an Admin created with a password: its owner chooses their own at first sign-in.
describe('TemporaryPasswordScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); replaceTemporaryPassword.mockResolvedValue(undefined); });

  const fill = (pw: string, confirm = pw) => {
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: pw } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
    fireEvent.click(screen.getByRole('button', { name: 'Set my password' }));
  };

  it('asks for a new password before going on', () => {
    render(<TemporaryPasswordScreen onComplete={vi.fn()} />);
    expect(screen.getByText(/Choose your own password/)).toBeInTheDocument();
  });

  it('refuses a short password or one that doesn\'t match', async () => {
    render(<TemporaryPasswordScreen onComplete={vi.fn()} />);
    fill('short');
    expect(await screen.findByText('Password must be at least 10 characters')).toBeInTheDocument();
    fill('a'.repeat(10), 'b'.repeat(10));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(replaceTemporaryPassword).not.toHaveBeenCalled();
  });

  it('sets it, then goes on', async () => {
    const onComplete = vi.fn();
    render(<TemporaryPasswordScreen onComplete={onComplete} />);
    fill('a-new-password');
    await waitFor(() => expect(replaceTemporaryPassword).toHaveBeenCalledWith('a-new-password'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('says what went wrong and stays', async () => {
    replaceTemporaryPassword.mockRejectedValueOnce(new Error('Could not set the password'));
    const onComplete = vi.fn();
    render(<TemporaryPasswordScreen onComplete={onComplete} />);
    fill('a-new-password');
    expect(await screen.findByText('Could not set the password')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TwoFactorSetupRequiredScreen from './TwoFactorSetupRequiredScreen';

vi.mock('./TwoFactorSettings', () => ({
  default: ({ onEnabled }: any) => <button type="button" onClick={onEnabled}>Settings card</button>,
}));

describe('TwoFactorSetupRequiredScreen', () => {
  it('explains why, offers the setup, and continues once it is on', () => {
    const onDone = vi.fn();
    render(<TwoFactorSetupRequiredScreen onDone={onDone} onSignOut={vi.fn()} />);
    expect(screen.getByText(/admins must use two-factor sign-in/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings card' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('lets you sign out instead', () => {
    const onSignOut = vi.fn();
    render(<TwoFactorSetupRequiredScreen onDone={vi.fn()} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });
});

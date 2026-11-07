import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import TwoFactorReminder, { daysLeft } from './TwoFactorReminder';

afterEach(() => vi.useRealTimers());

describe('TwoFactorReminder', () => {
  it('counts whole days left, never below zero', () => {
    const now = new Date('2026-11-07T12:00:00Z');
    expect(daysLeft('2026-11-21T12:00:00Z', now)).toBe(14);
    expect(daysLeft('2026-11-08T01:00:00Z', now)).toBe(1);
    expect(daysLeft('2026-11-01T00:00:00Z', now)).toBe(0);
  });

  it('tells an Admin how long they have and links to set it up', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
    render(<MemoryRouter><TwoFactorReminder requiredAfter="2026-11-17T12:00:00Z" /></MemoryRouter>);
    expect(screen.getByText(/two-factor sign-in will be required for Admins in 10 days/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /set it up/i })).toHaveAttribute('href', '/settings/security');
  });
});

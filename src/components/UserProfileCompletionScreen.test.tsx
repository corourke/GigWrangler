import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import UserProfileCompletionScreen from './UserProfileCompletionScreen';
import type { User } from '../utils/supabase/types';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ refreshProfile: vi.fn() }) }));

const user = (email: string | null) => ({ id: 'u-1', first_name: 'Sam', last_name: 'Roadie', email }) as unknown as User;

describe('UserProfileCompletionScreen — read-only email (#325)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the email', () => {
    render(<UserProfileCompletionScreen user={user('sam@example.com')} onProfileCompleted={vi.fn()} />);
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com');
  });

  it('shows a blank field, without a React warning, when there is no email', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<UserProfileCompletionScreen user={user(null)} onProfileCompleted={vi.fn()} />);
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(consoleError).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from 'vitest';
import { newPasswordError, MIN_PASSWORD_LENGTH } from './password';

describe('newPasswordError', () => {
  it('accepts a password of at least the minimum length', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(newPasswordError('a'.repeat(10))).toBeNull();
  });

  it('refuses a missing, short or non-text password', () => {
    expect(newPasswordError(undefined)).toBe('Password is required');
    expect(newPasswordError('')).toBe('Password is required');
    expect(newPasswordError('short')).toBe('Password must be at least 10 characters');
    expect(newPasswordError(1234567890)).toBe('Password is required');
  });
});

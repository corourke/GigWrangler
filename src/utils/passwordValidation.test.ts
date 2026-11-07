import { describe, it, expect } from 'vitest';
import { validatePassword, getPasswordStrength, MIN_PASSWORD_LENGTH } from './passwordValidation';

describe('validatePassword', () => {
  it('returns null for a valid, matching password', () => {
    expect(validatePassword('hunter2222', 'hunter2222')).toBeNull();
  });

  it('requires a password', () => {
    expect(validatePassword('', '')).toBe('Password is required');
  });

  it('enforces a 10-character minimum', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(validatePassword('abc', 'abc')).toBe('Password must be at least 10 characters');
    expect(validatePassword('hunter222', 'hunter222')).toBe('Password must be at least 10 characters');
  });

  it('requires the confirmation to match', () => {
    expect(validatePassword('hunter2222', 'hunter3333')).toBe('Passwords do not match');
  });
});

describe('getPasswordStrength', () => {
  it('returns null for an empty password', () => {
    expect(getPasswordStrength('')).toBeNull();
  });

  it('rates short passwords as weak, even with variety', () => {
    expect(getPasswordStrength('aB3!')).toBe('weak');
    expect(getPasswordStrength('aB3!xY7')).toBe('weak');
  });

  it('rates long passwords with a single character class as weak', () => {
    expect(getPasswordStrength('abcdefghijklmnop')).toBe('weak');
  });

  it('rates 8+ characters with two character classes as fair', () => {
    expect(getPasswordStrength('abcdefg1')).toBe('fair');
  });

  it('keeps 12+ characters with only two classes at fair', () => {
    expect(getPasswordStrength('abcdefghijk1')).toBe('fair');
  });

  it('keeps under 12 characters at fair, even with three classes', () => {
    expect(getPasswordStrength('abcDefgh1!')).toBe('fair');
  });

  it('rates 12+ characters with three or more classes as strong', () => {
    expect(getPasswordStrength('abcdefghiJK1')).toBe('strong');
    expect(getPasswordStrength('correct Horse 9')).toBe('strong');
  });
});

import { describe, it, expect } from 'vitest';
import { sessionClaims, twoFactorSatisfied, TWO_FACTOR_REQUIRED } from './twoFactor';

const token = (payload: object) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

describe('sessionClaims', () => {
  it('reads how the session signed in from its (already verified) access token', () => {
    expect(sessionClaims(token({ aal: 'aal2', amr: [{ method: 'password' }, { method: 'totp' }] })))
      .toEqual({ aal: 'aal2', methods: ['password', 'totp'] });
  });
  it('treats anything unreadable as a first-step-only session', () => {
    expect(sessionClaims('not-a-token')).toEqual({ aal: 'aal1', methods: [] });
    expect(sessionClaims(null)).toEqual({ aal: 'aal1', methods: [] });
  });
});

describe('twoFactorSatisfied', () => {
  it('is satisfied when the person isn\'t required to use it', () => {
    expect(twoFactorSatisfied({ aal: 'aal1', methods: ['password'] }, false)).toBe(true);
  });
  it('when required, needs the code, or a Google sign-in', () => {
    expect(twoFactorSatisfied({ aal: 'aal1', methods: ['password'] }, true)).toBe(false);
    expect(twoFactorSatisfied({ aal: 'aal2', methods: ['password', 'totp'] }, true)).toBe(true);
    expect(twoFactorSatisfied({ aal: 'aal1', methods: ['oauth'] }, true)).toBe(true);
  });
  it('says what to do', () => {
    expect(TWO_FACTOR_REQUIRED).toBe('Two-factor sign-in required. Enter the code from your authenticator app.');
  });
});

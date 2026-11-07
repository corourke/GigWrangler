import { describe, it, expect } from 'vitest';
import { unlockEmail, UNLOCK_FAILED } from './webauthnUnlock';

describe('device unlock', () => {
  it('reads the email from the request, trimmed and lower-cased', () => {
    expect(unlockEmail('  Pat@Example.COM ')).toBe('pat@example.com');
  });

  it('refuses a missing or malformed email', () => {
    expect(unlockEmail(undefined)).toBeNull();
    expect(unlockEmail('')).toBeNull();
    expect(unlockEmail('   ')).toBeNull();
    expect(unlockEmail('not-an-email')).toBeNull();
    expect(unlockEmail(42)).toBeNull();
    expect(unlockEmail('a'.repeat(250) + '@example.com')).toBeNull();
  });

  it('has one message for every way an unlock can fail', () => {
    expect(UNLOCK_FAILED).toBe("Couldn't unlock with this device. Sign in again instead.");
  });
});

// Device unlock (WebAuthn) helpers, free of Deno imports so Vitest can test them.

/** The one answer for every way an unlock can fail, so it says nothing about the account. */
export const UNLOCK_FAILED = "Couldn't unlock with this device. Sign in again instead.";

/** The email an unlock request names, trimmed and lower-cased, or null if it isn't one. */
export function unlockEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

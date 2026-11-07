/** The shortest password an account may have. Supabase Auth's minimum_password_length is set to the same. */
export const MIN_PASSWORD_LENGTH = 10;

/** Why a new password is too short, or null. */
export function passwordLengthError(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters` : null;
}

/**
 * Validate a new-password + confirmation pair. Returns an error message, or
 * null when valid. Shared by the reset-password and profile-completion flows.
 */
export function validatePassword(password: string, confirmPassword: string): string | null {
  if (!password) return 'Password is required';
  const lengthError = passwordLengthError(password);
  if (lengthError) return lengthError;
  if (password !== confirmPassword) return 'Passwords do not match';
  return null;
}

export type PasswordStrength = 'weak' | 'fair' | 'strong';

/**
 * Rough, advisory strength rating from length and character variety
 * (lowercase, uppercase, digits, symbols). It never blocks submission; the
 * only hard rule is the MIN_PASSWORD_LENGTH minimum, which Supabase Auth also enforces.
 * Returns null for an empty password.
 */
export function getPasswordStrength(password: string): PasswordStrength | null {
  if (!password) return null;
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 12 && variety >= 3) return 'strong';
  if (password.length >= 8 && variety >= 2) return 'fair';
  return 'weak';
}

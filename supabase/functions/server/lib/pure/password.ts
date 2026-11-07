/** The shortest password an account may have (Supabase Auth is set to the same). */
export const MIN_PASSWORD_LENGTH = 10;

/** Why a new password can't be used, or null if it can. */
export function newPasswordError(password: unknown): string | null {
  if (typeof password !== 'string' || password === '') return 'Password is required';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  return null;
}

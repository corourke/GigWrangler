import { createClient } from '../utils/supabase/client';
import { unwrapFunctionsError } from '../utils/api-error-utils';

/**
 * Two-factor sign-in with an authenticator app (#361): Supabase Auth's TOTP factors. A session
 * that signed in with a password or a link and has a verified authenticator still needs the
 * code (aal1 → aal2). A Google sign-in doesn't: Cameron decided to trust Google's own sign-in.
 */

export interface TwoFactorFactor {
  id: string;
  friendly_name?: string | null;
}

export interface TwoFactorStatus {
  factors: TwoFactorFactor[];
  /** This session still needs the code from the authenticator. */
  needsCode: boolean;
  signedInWithGoogle: boolean;
  /** An Admin: two-factor sign-in is required of them (after requiredAfter). */
  required: boolean;
  requiredAfter: string | null;
  /** Required now but no authenticator yet: they must set one up before anything else. */
  setupRequired: boolean;
}

const WRONG_CODE = "That code didn't work. Check the time on your phone and try the newest code.";

const digits = (code: string) => code.replace(/\s+/g, '');

async function verifiedFactors(): Promise<TwoFactorFactor[]> {
  const { data, error } = await createClient().auth.mfa.listFactors();
  if (error) throw error;
  return (data?.totp ?? []).filter((f: any) => f.status === 'verified');
}

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  const client = createClient();
  const [factors, aal, requirement] = await Promise.all([
    verifiedFactors(),
    client.auth.mfa.getAuthenticatorAssuranceLevel(),
    // The database's own answer (public.two_factor_requirement), readable before the code is entered.
    client.rpc('two_factor_requirement'),
  ]);
  if (aal.error) throw aal.error;
  if (requirement.error) throw requirement.error;
  const methods = (aal.data?.currentAuthenticationMethods ?? []) as { method: string }[];
  const signedInWithGoogle = methods.some((m) => m.method === 'oauth');
  const needsCode = aal.data?.nextLevel === 'aal2' && aal.data?.currentLevel !== 'aal2' && !signedInWithGoogle;
  const req = (requirement.data ?? {}) as { required?: boolean; required_after?: string | null; satisfied?: boolean };
  return {
    factors,
    needsCode,
    signedInWithGoogle,
    required: req.required === true,
    requiredAfter: req.required_after ?? null,
    setupRequired: req.satisfied === false && factors.length === 0,
  };
}

/**
 * Until when to show the setup reminder, or null for none: while the grace period still runs, for
 * a required account with no authenticator. A Google sign-in already counts, so it gets none.
 */
export function reminderUntil(status: TwoFactorStatus, now: Date = new Date()): string | null {
  if (!status.required || status.factors.length > 0 || status.setupRequired || status.signedInWithGoogle) return null;
  if (!status.requiredAfter || new Date(status.requiredAfter).getTime() <= now.getTime()) return null;
  return status.requiredAfter;
}

/** Starts setting up an authenticator: the QR code to scan and the key to type instead. */
export async function startTwoFactorSetup(): Promise<{ factorId: string; qrCode: string; secret: string }> {
  const mfa = createClient().auth.mfa;
  // A setup left unfinished blocks a new one; clear it (never a verified authenticator).
  const { data: existing } = await mfa.listFactors();
  for (const f of (existing?.totp ?? []) as any[]) {
    if (f.status !== 'verified') await mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator app ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) throw error ?? new Error('Could not start two-factor setup');
  return { factorId: data.id, qrCode: (data as any).totp.qr_code, secret: (data as any).totp.secret };
}

async function verify(factorId: string, code: string): Promise<void> {
  const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: digits(code) });
  if (error) throw new Error(WRONG_CODE);
}

/** Confirms a new authenticator with a code from it; this also completes the session's second step. */
export async function confirmTwoFactorSetup(factorId: string, code: string): Promise<void> {
  await verify(factorId, code);
}

/** The sign-in step: checks the code against the account's authenticator. */
export async function verifyTwoFactorCode(code: string): Promise<void> {
  const [factor] = await verifiedFactors();
  if (!factor) throw new Error('No authenticator is set up for this account');
  await verify(factor.id, code);
}

export async function removeTwoFactor(factorId: string): Promise<void> {
  const { error } = await createClient().auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/** A lost device: a platform moderator removes an account's authenticators (logged by the server). */
export async function resetTwoFactorForAccount(email: string): Promise<void> {
  const { data, error } = await createClient().functions.invoke('server/moderator/two-factor/reset', {
    method: 'POST',
    body: { email: email.trim() },
  });
  if (error) throw await unwrapFunctionsError(error);
  if (data?.error) throw new Error(data.error);
}

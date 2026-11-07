import { createClient } from '../utils/supabase/client';

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
  needsCode: boolean;
  signedInWithGoogle: boolean;
}

const WRONG_CODE = "That code didn't work. Check the time on your phone and try the newest code.";

const digits = (code: string) => code.replace(/\s+/g, '');

async function verifiedFactors(): Promise<TwoFactorFactor[]> {
  const { data, error } = await createClient().auth.mfa.listFactors();
  if (error) throw error;
  return (data?.totp ?? []).filter((f: any) => f.status === 'verified');
}

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  const auth = createClient().auth;
  const [factors, aal] = await Promise.all([verifiedFactors(), auth.mfa.getAuthenticatorAssuranceLevel()]);
  if (aal.error) throw aal.error;
  const methods = (aal.data?.currentAuthenticationMethods ?? []) as { method: string }[];
  const signedInWithGoogle = methods.some((m) => m.method === 'oauth');
  const needsCode = aal.data?.nextLevel === 'aal2' && aal.data?.currentLevel !== 'aal2' && !signedInWithGoogle;
  return { factors, needsCode, signedInWithGoogle };
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

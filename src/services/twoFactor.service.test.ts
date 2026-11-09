import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../utils/supabase/client';
import {
  getTwoFactorStatus,
  startTwoFactorSetup,
  confirmTwoFactorSetup,
  verifyTwoFactorCode,
  removeTwoFactor,
  resetTwoFactorForAccount,
} from './twoFactor.service';

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));

let mfa: any;
let rpc: any;
const invoke = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mfa = {
    listFactors: vi.fn(),
    getAuthenticatorAssuranceLevel: vi.fn(),
    enroll: vi.fn(),
    challengeAndVerify: vi.fn(),
    unenroll: vi.fn(),
  };
  rpc = vi.fn().mockResolvedValue({ data: { required: false, required_after: null, satisfied: true }, error: null });
  (createClient as any).mockReturnValue({ auth: { mfa }, rpc, functions: { invoke } });
});

const verified = { id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Phone' };
const unverified = { id: 'f0', factor_type: 'totp', status: 'unverified' };

describe('getTwoFactorStatus', () => {
  it('reports the verified authenticator and whether this session still needs the code', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [unverified, verified] }, error: null });
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [{ method: 'password' }] }, error: null,
    });
    expect(await getTwoFactorStatus()).toEqual({
      factors: [verified], needsCode: true, signedInWithGoogle: false, required: false, requiredAfter: null, setupRequired: false,
    });
  });

  it('does not ask for the code after a Google sign-in (Cameron: trust Google)', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [verified] }, error: null });
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [{ method: 'oauth' }] }, error: null,
    });
    expect(await getTwoFactorStatus()).toMatchObject({ needsCode: false, signedInWithGoogle: true });
  });

  it('needs no code once it has been entered, or without an authenticator', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [verified] }, error: null });
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null });
    expect((await getTwoFactorStatus()).needsCode).toBe(false);
    mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] }, error: null });
    expect((await getTwoFactorStatus()).needsCode).toBe(false);
  });
});

describe('the Admin requirement', () => {
  it('asks an Admin past the grace date with no authenticator to set one up', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [{ method: 'password' }] }, error: null });
    rpc.mockResolvedValue({ data: { required: true, required_after: '2026-11-01T00:00:00Z', satisfied: false }, error: null });
    expect(await getTwoFactorStatus()).toMatchObject({ required: true, requiredAfter: '2026-11-01T00:00:00Z', setupRequired: true, needsCode: false });
    expect(rpc).toHaveBeenCalledWith('two_factor_requirement');
  });

  it('gives an Admin in the grace period the date, without making them set it up yet', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] }, error: null });
    rpc.mockResolvedValue({ data: { required: true, required_after: '2026-12-01T00:00:00Z', satisfied: true }, error: null });
    expect(await getTwoFactorStatus()).toMatchObject({ required: true, requiredAfter: '2026-12-01T00:00:00Z', setupRequired: false });
  });
});

describe('setting up', () => {
  it('starts with a QR code and a key, clearing any setup left unfinished', async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [unverified, verified], totp: [unverified, verified] }, error: null });
    mfa.unenroll.mockResolvedValue({ error: null });
    mfa.enroll.mockResolvedValue({ data: { id: 'f2', totp: { qr_code: 'data:image/svg+xml;utf8,<svg/>', secret: 'ABC' } }, error: null });
    expect(await startTwoFactorSetup()).toEqual({ factorId: 'f2', qrCode: 'data:image/svg+xml;utf8,<svg/>', secret: 'ABC' });
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f0' });
    expect(mfa.unenroll).not.toHaveBeenCalledWith({ factorId: 'f1' });
    expect(mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }));
  });

  it('confirms with a code from the app', async () => {
    mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    await confirmTwoFactorSetup('f2', ' 123 456 ');
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f2', code: '123456' });
  });

  it('says so when the code is wrong', async () => {
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'Invalid TOTP code entered' } });
    await expect(confirmTwoFactorSetup('f2', '000000')).rejects.toThrow("That code didn't work. Check the time on your phone and try the newest code.");
  });
});

describe('signing in', () => {
  it('verifies the code against the verified authenticator', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [unverified, verified] }, error: null });
    mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    await verifyTwoFactorCode('654321');
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '654321' });
  });
});

describe('removing', () => {
  it('removes an authenticator', async () => {
    mfa.unenroll.mockResolvedValue({ error: null });
    await removeTwoFactor('f1');
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f1' });
  });
});

describe('a lost device', () => {
  it('a platform moderator resets an account by its email, through the server', async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    await resetTwoFactorForAccount(' pat@example.com ');
    expect(invoke).toHaveBeenCalledWith('server/moderator/two-factor/reset', { method: 'POST', body: { email: 'pat@example.com' } });
  });

  it("shows the server's reason when the reset is refused (B22)", async () => {
    const response = new Response(JSON.stringify({ error: 'No account with that email' }), { status: 404 });
    const err: any = new Error('Edge Function returned a non-2xx status code');
    err.name = 'FunctionsHttpError';
    err.context = response;
    invoke.mockResolvedValue({ data: null, error: err });
    await expect(resetTwoFactorForAccount('nobody@example.com')).rejects.toThrow('No account with that email');
  });
});

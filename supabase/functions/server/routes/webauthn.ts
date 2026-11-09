import type { App } from '../lib/types.ts';
import { WebAuthnServer } from '../deps.ts';
import { requireUser } from '../lib/auth.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import * as kv from '../kv_store.ts';
import {
  RP_NAME, RP_ID, ORIGIN, base64urlEncode, base64urlDecode, reportWebauthnConfigFallback,
} from '../lib/webauthnConfig.ts';
import { unlockEmail, UNLOCK_FAILED } from '../lib/pure/webauthnUnlock.ts';

/** The account an unlock request's email belongs to, or null. */
async function accountForEmail(value: unknown): Promise<string | null> {
  const email = unlockEmail(value);
  if (!email) return null;
  const { data, error } = await supabaseAdmin.rpc('auth_user_id_by_email', { p_email: email });
  if (error) {
    console.error('Error looking up an account for unlock:', error);
    return null;
  }
  return (data as string | null) ?? null;
}

// WebAuthn device enrollment + unlock. register/* require auth (enrolling the
// caller's device); authenticate/* are public by design (Q-E — the unlock flow,
// gating only the cosmetic mobile lock, not data access).
export function registerWebauthn(app: App) {
  app.post('/webauthn/register/options', requireUser, async (c) => {
    reportWebauthnConfigFallback();
    const user = c.get('user');

    const { data: devices } = await supabaseAdmin
      .from('user_devices').select('credential_id').eq('user_id', user.id);

    const options = await WebAuthnServer.generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new TextEncoder().encode(user.id),
      // An account without an email (none today) is named by its id.
      userName: user.email ?? user.id,
      attestationType: 'none',
      excludeCredentials: devices?.map((d: any) => ({ id: d.credential_id })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });

    await kv.set(`webauthn:registration:challenge:${user.id}`, { challenge: options.challenge, timestamp: Date.now() });
    return c.json(options);
  });

  app.post('/webauthn/register/verify', requireUser, async (c) => {
    reportWebauthnConfigFallback();
    const user = c.get('user');
    const { registrationResponse, deviceName } = await c.req.json();

    const stored = await kv.get(`webauthn:registration:challenge:${user.id}`);
    if (!stored || Date.now() - stored.timestamp > 300000) {
      return c.json({ error: 'Challenge expired or not found' }, 400);
    }

    let verification;
    try {
      verification = await WebAuthnServer.verifyRegistrationResponse({
        response: registrationResponse,
        expectedChallenge: stored.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
      });
    } catch (error) {
      console.error('Registration verification failed:', error);
      return c.json({ error: 'Verification failed' }, 400);
    }

    const { verified, registrationInfo } = verification;
    if (!verified || !registrationInfo) {
      return c.json({ error: 'Verification failed' }, 400);
    }

    // v13: registrationInfo.credential.id is already a base64url string; publicKey is raw bytes.
    const { credential } = registrationInfo;
    const publicKeyBase64url = base64urlEncode(credential.publicKey);
    const credentialIDBase64url = credential.id;

    const { error: dbError } = await supabaseAdmin.from('user_devices').insert({
      user_id: user.id,
      credential_id: credentialIDBase64url,
      public_key: publicKeyBase64url,
      device_name: deviceName || 'Unknown Device',
      sign_count: credential.counter ?? 0,
    });
    if (dbError) {
      console.error('DB Error storing device:', dbError);
      return c.json({ error: 'Failed to store device' }, 500);
    }

    await kv.del(`webauthn:registration:challenge:${user.id}`);
    return c.json({ success: true });
  });

  // Public (Q-E): unlock flow identifies the user by email. Every failure on these two routes
  // gives the same answer (UNLOCK_FAILED), so they say nothing about which emails have accounts.
  app.post('/webauthn/authenticate/options', async (c) => {
    reportWebauthnConfigFallback();
    const body = await c.req.json().catch(() => ({}));
    const userId = await accountForEmail(body?.email);
    if (!userId) {
      return c.json({ error: UNLOCK_FAILED }, 400);
    }

    const { data: devices } = await supabaseAdmin
      .from('user_devices').select('credential_id').eq('user_id', userId);
    if (!devices || devices.length === 0) {
      return c.json({ error: UNLOCK_FAILED }, 400);
    }

    const options = await WebAuthnServer.generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: devices.map((d: any) => ({ id: d.credential_id })),
      userVerification: 'preferred',
    });

    await kv.set(`webauthn:authentication:challenge:${userId}`, { challenge: options.challenge, timestamp: Date.now() });
    return c.json(options);
  });

  // Public (Q-E).
  app.post('/webauthn/authenticate/verify', async (c) => {
    reportWebauthnConfigFallback();
    const body = await c.req.json().catch(() => ({}));
    const authenticationResponse = body?.authenticationResponse;
    const userId = await accountForEmail(body?.email);
    if (!userId || !authenticationResponse?.id) {
      return c.json({ error: UNLOCK_FAILED }, 400);
    }

    const stored = await kv.get(`webauthn:authentication:challenge:${userId}`);
    if (!stored || Date.now() - stored.timestamp > 300000) {
      return c.json({ error: UNLOCK_FAILED }, 400);
    }

    const { data: device } = await supabaseAdmin
      .from('user_devices').select('*')
      .eq('user_id', userId).eq('credential_id', authenticationResponse.id).maybeSingle();
    if (!device) {
      return c.json({ error: UNLOCK_FAILED }, 400);
    }

    let verification;
    try {
      verification = await WebAuthnServer.verifyAuthenticationResponse({
        response: authenticationResponse,
        expectedChallenge: stored.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        // v13: `authenticator` was renamed to `credential`; id is base64url, publicKey is raw bytes.
        // The stored counter lets the library refuse a response from a copied credential.
        credential: {
          id: device.credential_id,
          publicKey: base64urlDecode(device.public_key),
          counter: Number(device.sign_count ?? 0),
        },
      });
    } catch (error) {
      console.error('Authentication verification failed:', error);
      return c.json({ error: UNLOCK_FAILED }, 400);
    }

    if (!verification.verified) {
      return c.json({ error: UNLOCK_FAILED }, 400);
    }

    await supabaseAdmin.from('user_devices').update({
      last_used_at: new Date().toISOString(),
      sign_count: verification.authenticationInfo.newCounter,
    }).eq('id', device.id);
    await kv.del(`webauthn:authentication:challenge:${userId}`);
    return c.json({ success: true, user_id: userId });
  });
}

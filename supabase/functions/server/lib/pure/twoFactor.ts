// Two-factor sign-in on the server (#361), the same rule as public.mfa_satisfied() in the
// database. Free of Deno imports so Vitest can test it.

export const TWO_FACTOR_REQUIRED = 'Two-factor sign-in required. Enter the code from your authenticator app.';

export interface SessionClaims {
  aal: string;
  methods: string[];
}

/** How a session signed in, read from its access token (verified by Supabase Auth before this). */
export function sessionClaims(token: string | null | undefined): SessionClaims {
  try {
    const payload = token?.split('.')[1];
    if (!payload) return { aal: 'aal1', methods: [] };
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    const methods = Array.isArray(json.amr) ? json.amr.map((m: any) => String(m?.method ?? '')) : [];
    return { aal: typeof json.aal === 'string' ? json.aal : 'aal1', methods };
  } catch {
    return { aal: 'aal1', methods: [] };
  }
}

/**
 * Whether a session may proceed: always when the person isn't required to use two-factor
 * sign-in; otherwise only after the code (aal2) or a Google sign-in (Cameron: trust Google).
 */
export function twoFactorSatisfied(claims: SessionClaims, required: boolean): boolean {
  if (!required) return true;
  return claims.aal === 'aal2' || claims.methods.includes('oauth');
}

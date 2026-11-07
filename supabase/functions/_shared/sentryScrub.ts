// Removes email addresses and tokens from error reports before they are sent to Sentry. Free
// of Deno and browser imports: the app (src/main.tsx) and the edge functions (_shared/sentry.ts)
// both use it as Sentry's beforeSend.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER = /\b(Bearer)\s+[^\s"',]+/gi;
const TOKEN_PARAM = /([?&#](?:access_token|refresh_token|id_token|token|code|apikey|key)=)[^&#\s"']+/gi;

/** The text with email addresses, JWTs, bearer tokens and token-like URL parameters replaced. */
export function scrubText(text: string): string {
  return text
    .replace(JWT, '[token]')
    .replace(BEARER, '$1 [token]')
    .replace(TOKEN_PARAM, '$1[token]')
    .replace(EMAIL, '[email]');
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubValue(v, depth + 1);
  return out;
}

/** Sentry beforeSend: every string in the event scrubbed, and the user's email and IP dropped. */
export function scrubEvent<T>(event: T): T {
  const out = scrubValue(event, 0) as Record<string, unknown>;
  if (out && typeof out.user === 'object' && out.user !== null) {
    const { email: _email, ip_address: _ip, ...rest } = out.user as Record<string, unknown>;
    out.user = rest;
  }
  return out as T;
}

// How often people may do the things that send email, create organizations or cost money per
// call. Kept free of Deno imports so Vitest can test it. The windows are rolling (the last hour,
// the last 24 hours), so the messages never say "today" or "tomorrow".

export type RateLimitAction = 'org_create' | 'places' | 'invitation_email' | 'access_request';

/** Whose events a limit counts: the caller's, the organization's, or everyone's. */
export type RateLimitScope = 'user' | 'org' | 'all';

export interface RateLimitRule {
  scope: RateLimitScope;
  max: number;
  windowHours: number;
  message: string;
}

export const RATE_LIMITS: Record<RateLimitAction, RateLimitRule[]> = {
  org_create: [
    { scope: 'user', max: 5, windowHours: 24, message: 'You can create up to 5 organizations in 24 hours. Try again later.' },
  ],
  // Every proxied call counts (a search, and each result's details).
  places: [
    { scope: 'user', max: 300, windowHours: 1, message: 'Too many place searches (300 an hour). Try again later.' },
    // A ceiling on the API's cost: Places calls carry no organization.
    { scope: 'all', max: 2000, windowHours: 24, message: 'Place search is busy right now. Try again later.' },
  ],
  invitation_email: [
    { scope: 'user', max: 20, windowHours: 1, message: 'You can send up to 20 invitations an hour. Try again later.' },
    { scope: 'org', max: 100, windowHours: 24, message: 'This organization can send up to 100 invitations in 24 hours. Try again later.' },
  ],
  access_request: [
    { scope: 'user', max: 10, windowHours: 24, message: 'You can make up to 10 access requests in 24 hours. Try again later.' },
  ],
};

/** The longest window, so older events can be cleared. */
export const RATE_LIMIT_RETENTION_HOURS = Math.max(
  ...Object.values(RATE_LIMITS).flat().map((r) => r.windowHours),
);

/** Why the action can't happen now (the first limit reached), or null. `counts` are events in each rule's window. */
export function rateLimitError(
  action: RateLimitAction,
  counts: Partial<Record<RateLimitScope, number>>,
): string | null {
  for (const rule of RATE_LIMITS[action]) {
    if ((counts[rule.scope] ?? 0) >= rule.max) return rule.message;
  }
  return null;
}

import type { MiddlewareHandler } from '../deps.ts';
import { supabaseAdmin } from './supabaseAdmin.ts';
import { parseBearer } from './pure/authz.ts';
import { sessionClaims, twoFactorSatisfied, TWO_FACTOR_REQUIRED } from './pure/twoFactor.ts';
import { log } from '../../_shared/log.ts';

/**
 * Validates the Bearer token once and attaches the user to the context.
 * Replaces the ~30 inline `getAuthenticatedUser` blocks.
 */
export const requireUser: MiddlewareHandler = async (c, next) => {
  const token = parseBearer(c.req.header('Authorization'));
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return c.json({ error: error?.message ?? 'Unauthorized' }, 401);
  }

  // Two-factor sign-in (#361): the same rule as the database's restrictive policies. The
  // lookup is skipped for a session that already entered the code or signed in with Google.
  const claims = sessionClaims(token);
  if (!twoFactorSatisfied(claims, true)) {
    const { data: required, error: requiredError } = await supabaseAdmin.rpc('mfa_required_for', { p_user_id: user.id });
    if (requiredError) {
      log('error', 'auth.two_factor_check_failed', { err: requiredError });
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (!twoFactorSatisfied(claims, required === true)) {
      return c.json({ error: TWO_FACTOR_REQUIRED }, 403);
    }
  }

  c.set('user', user);
  await next();
};
